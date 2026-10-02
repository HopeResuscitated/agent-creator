// meter.mjs — trusted-side model meter: an HTTP pass-through between the broker (or, in control mode, the agent)
// and Ollama that records one JSON line per request. Byte-for-byte forwarding to one fixed upstream.
//   METER_LOG=<meter.jsonl> [METER_RAW=<dir>] [METER_LISTEN=127.0.0.2:11439] [METER_UPSTREAM=127.0.0.1:11434] node evals/bench/meter.mjs
// (cycle-7 meter7: fixes over the cycle-4 meter)
//   1. StringDecoder instead of per-chunk toString (multi-byte UTF-8 split across TCP chunks no longer corrupts lines)
//   2. leftover buf parsed on upstream 'end' (a final line without trailing \n is no longer dropped)
//   3. lifecycle events with timestamps: upstream response end/aborted/error/close, client req aborted/close,
//      client res close (and whether it happened before the upstream finished), upstream socket close
//   4. raw upstream bytes of every response tee'd to METER_RAW/<id>.raw, request body to <id>.req.json
//   5. record written exactly once on upstream 'close' (fires after 'end' or after 'aborted')
// Extra fields: done_marker ([DONE] seen), last_line, events[], first_closer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
const LOG = process.env.METER_LOG; const RAW = process.env.METER_RAW || '';
if (!LOG) { console.error('METER_LOG is required'); process.exit(2); }
const hp = (v, d) => { const [h, p] = (v || d).split(':'); return { host: h, port: Number(p) }; };
const { host: LISTEN_HOST, port: LISTEN_PORT } = hp(process.env.METER_LISTEN, '127.0.0.2:11439');
const UP = hp(process.env.METER_UPSTREAM, '127.0.0.1:11434');
if (RAW) fs.mkdirSync(RAW, { recursive: true });
let n = 0;
const w = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
http.createServer((req, res) => {
  const id = ++n; const t0 = Date.now(); const reqBody = [];
  const ev = []; const mark = (e) => ev.push([e, Date.now() - t0]);
  let upDone = false, clientGone = false;
  req.on('aborted', () => mark('client_req_aborted'));
  req.on('close', () => mark('client_req_close'));
  res.on('close', () => mark(upDone ? 'client_res_close' : 'client_res_close_BEFORE_upstream_done'));
  res.on('finish', () => mark('client_res_finish'));
  req.on('data', (c) => reqBody.push(c));
  req.on('end', () => {
    const body = Buffer.concat(reqBody);
    if (RAW) fs.writeFileSync(path.join(RAW, `${id}.req.json`), body);
    let model = '', stream = null, nMsgs = 0, nTools = 0;
    try { const j = JSON.parse(body.toString('utf8')); model = j.model; stream = j.stream ?? null; nMsgs = j.messages?.length ?? 0; nTools = j.tools?.length ?? 0; } catch { /* non-json */ }
    const rawFd = RAW ? fs.openSync(path.join(RAW, `${id}.raw`), 'w') : null;
    const up = http.request({ ...UP, method: req.method, path: req.url, headers: { ...req.headers, host: `${UP.host}:${UP.port}` } }, (ur) => {
      mark(`upstream_headers_${ur.statusCode}`);
      res.writeHead(ur.statusCode, ur.headers);
      const dec = new StringDecoder('utf8');
      let ttfb = 0, bytes = 0, chunks = 0, toolDeltas = 0, content = '', finish = '', usage = null, buf = '', done = false, lastLine = '', written = false;
      const toolNames = new Set();
      const eat = (line) => {
        line = line.trim(); if (!line) return; lastLine = line.slice(-300);
        const data = line.startsWith('data: ') ? line.slice(6) : line;
        if (data === '[DONE]') { done = true; return; }
        if (!data.startsWith('{')) return;
        try {
          const j = JSON.parse(data); chunks++;
          const ch = j.choices?.[0];
          if (ch?.delta?.content) content += ch.delta.content;
          if (ch?.message?.content) content += ch.message.content;
          for (const tc of ch?.delta?.tool_calls ?? ch?.message?.tool_calls ?? []) { toolDeltas++; if (tc.function?.name) toolNames.add(tc.function.name); }
          if (ch?.finish_reason) finish = ch.finish_reason;
          if (j.usage) usage = j.usage;
        } catch { /* not a complete JSON line */ }
      };
      ur.on('data', (c) => {
        if (!ttfb) ttfb = Date.now() - t0; bytes += c.length; res.write(c);
        if (rawFd !== null) fs.writeSync(rawFd, c);
        buf += dec.write(c); let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); eat(line); }
      });
      const finalize = () => {
        if (written) return; written = true;
        buf += dec.end(); if (buf.trim()) eat(buf); buf = '';
        if (rawFd !== null) fs.closeSync(rawFd);
        // Who closed first: the client if it aborted / closed its response before upstream finished; otherwise
        // upstream, normal (clean 'end') or abnormal ('aborted'/'error'). client_req_close is NOT a signal: Node
        // emits it as soon as the request body has been consumed.
        const at = (re) => ev.find(([e]) => re.test(e))?.[1];
        const tEnd = at(/^upstream_(end|aborted|error)/), tCli = at(/^client_(req_aborted|res_close_BEFORE)/);
        const firstCloser = tCli !== undefined && (tEnd === undefined || tCli < tEnd) ? 'client'
          : ev.some(([e]) => /^upstream_(aborted|error)/.test(e)) ? 'upstream(abnormal)' : 'upstream(clean end)';
        w({ id, t: new Date(t0).toISOString(), path: req.url, model, stream, msgs: nMsgs, tools: nTools, status: ur.statusCode, ttfb_ms: ttfb, total_ms: Date.now() - t0, bytes, chunks, tool_call_deltas: toolDeltas, tool_names: [...toolNames], text_toolcall: /<function=|<tool_call>/.test(content), content_chars: content.length, finish, usage, done_marker: done, last_line: lastLine, first_closer: firstCloser, ...(clientGone ? { client_gone: true } : {}), events: ev });
      };
      ur.on('end', () => { upDone = true; mark('upstream_end'); res.end(); });
      ur.on('aborted', () => { upDone = true; mark('upstream_aborted'); try { res.end(); } catch { /* */ } });
      ur.on('error', (e) => { mark(`upstream_error:${e.code || e.message}`); });
      ur.on('close', () => { mark('upstream_close'); finalize(); });
    });
    // The client went away before the upstream finished (agent killed at its task timeout, relay/broker torn
    // down): abort the upstream request too. Without this the meter, unlike a direct broker->Ollama connection,
    // kept Ollama generating for a dead client and the NEXT task queued behind it (cycle-8 R-C: 709 s of dead
    // compute after T08's timeout, 641 s of it billed to T13's first turn). Records get client_gone: true.
    res.on('close', () => { if (upDone) return; clientGone = true; mark('meter_aborted_upstream'); up.destroy(); });
    up.on('socket', (s) => s.on('close', (hadErr) => mark(`upstream_socket_close${hadErr ? '_err' : ''}`)));
    up.on('error', (e) => {
      upDone = true; mark(`upstream_req_error:${e.code || e.message}`);
      // aborted by us before the upstream headers: not an upstream error, and there is no client to answer
      if (clientGone) { w({ id, t: new Date(t0).toISOString(), path: req.url, model, stream, msgs: nMsgs, tools: nTools, client_gone: true, total_ms: Date.now() - t0, events: ev }); if (rawFd !== null) try { fs.closeSync(rawFd); } catch { /* */ } return; }
      w({ id, t: new Date(t0).toISOString(), path: req.url, error: e.message, total_ms: Date.now() - t0, events: ev }); if (rawFd !== null) try { fs.closeSync(rawFd); } catch { /* */ } try { res.writeHead(502); res.end(); } catch { /* */ }
    });
    up.end(body);
  });
}).listen(LISTEN_PORT, LISTEN_HOST, () => w({ start: new Date().toISOString(), listen: `${LISTEN_HOST}:${LISTEN_PORT}`, upstream: `${UP.host}:${UP.port}`, raw: RAW, meter: 'meter7' }));
