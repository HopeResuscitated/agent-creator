// Tiny proxy in front of Ollama's OpenAI-compatible API (for jcode + qwen3-coder).
//  - Repairs tool calls the model emitted as text (`<function=name><parameter=k>v</parameter></function>`,
//    with or without the <tool_call> wrapper) into structured `tool_calls`, which Ollama's parser misses
//    when the call follows a prose preamble.
//  - Logs a one-line summary of every request/response to evals/results/proxy.log.
// Usage: node evals/tools/ollama-toolcall-proxy.mjs   (listens on 127.0.0.1:11435 -> 127.0.0.1:11434)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PROXY_PORT ?? 11435);
const UPSTREAM = process.env.OLLAMA_UPSTREAM ?? 'http://127.0.0.1:11434';
const LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results', 'proxy.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (s) => { const l = `[${new Date().toISOString()}] ${s}\n`; fs.appendFileSync(LOG, l); process.stdout.write(l); };

const MARKERS = ['<tool_call>', '<function='];
let seq = 0;
const newId = () => `call_px${Date.now().toString(36)}${(seq++).toString(36)}`;

function coerce(val, schema) {
  const t = schema?.type;
  if (t && t !== 'string') { try { return JSON.parse(val); } catch { /* keep string */ } }
  return val;
}

// Returns [{name, arguments}] parsed from text, or [].
export function parseTextCalls(text, tools = []) {
  const byName = Object.fromEntries(tools.map((t) => [t.function?.name, t.function?.parameters?.properties ?? {}]));
  const calls = [];
  const fnRe = /<function=([^>\s]+)>([\s\S]*?)(?:<\/function>|$)/g;
  for (const m of text.matchAll(fnRe)) {
    const name = m[1].trim();
    const props = byName[name] ?? {};
    const args = {};
    for (const p of m[2].matchAll(/<parameter=([^>\s]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/g)) {
      let v = p[2];
      if (v.startsWith('\n')) v = v.slice(1);
      if (v.endsWith('\n')) v = v.slice(0, -1);
      args[p[1].trim()] = coerce(v, props[p[1].trim()]);
    }
    if (tools.length && !(name in byName)) continue;
    calls.push({ name, arguments: JSON.stringify(args) });
  }
  // JSON form: <tool_call>{"name":..., "arguments":{...}}</tool_call>
  if (!calls.length) {
    for (const m of text.matchAll(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g)) {
      try { const o = JSON.parse(m[1]); if (o.name) calls.push({ name: o.name, arguments: JSON.stringify(o.arguments ?? {}) }); } catch { /* ignore */ }
    }
  }
  return calls;
}

function holdIndex(s) {
  // index from which s might be the start of a marker (so we must hold it back)
  for (let i = Math.max(0, s.length - 12); i < s.length; i++) {
    if (s[i] !== '<') continue;
    const tail = s.slice(i);
    if (MARKERS.some((mk) => mk.startsWith(tail))) return i;
  }
  return -1;
}

function summarizeReq(body) {
  const msgs = (body.messages ?? []).map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) return `A[${m.tool_calls.map((c) => `${c.function?.name}#${c.id}`).join(',')}]`;
    if (m.role === 'tool') return `T(${m.tool_call_id})`;
    return m.role[0].toUpperCase();
  });
  return `model=${body.model} stream=${!!body.stream} tools=${body.tools?.length ?? 0} msgs=${msgs.join(' ')}`;
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const id = (seq++).toString(36);
  let body = null;
  if (req.method === 'POST' && req.url.includes('/chat/completions')) { try { body = JSON.parse(raw.toString('utf8')); } catch { /* passthrough */ } }

  const headers = { ...req.headers }; delete headers.host; delete headers['content-length']; delete headers['accept-encoding'];
  let up;
  try {
    up = await fetch(UPSTREAM + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw, duplex: 'half' });
  } catch (e) { log(`#${id} upstream error ${e.message}`); res.writeHead(502); return res.end(String(e)); }

  if (!body) { // plain passthrough
    const h = Object.fromEntries(up.headers); delete h['content-length']; delete h['content-encoding'];
    res.writeHead(up.status, h);
    if (up.body) for await (const c of up.body) res.write(c);
    return res.end();
  }
  log(`#${id} REQ ${summarizeReq(body)}`);
  const tools = body.tools ?? [];

  if (!body.stream) {
    const j = await up.json().catch(() => null);
    const msg = j?.choices?.[0]?.message;
    let note = msg?.tool_calls?.length ? `structured x${msg.tool_calls.length}` : 'text';
    if (msg && !msg.tool_calls?.length && typeof msg.content === 'string' && MARKERS.some((m) => msg.content.includes(m))) {
      const calls = parseTextCalls(msg.content, tools);
      if (calls.length) {
        const cut = Math.min(...MARKERS.map((m) => msg.content.indexOf(m)).filter((i) => i >= 0));
        msg.content = msg.content.slice(0, cut).trim();
        msg.tool_calls = calls.map((c) => ({ id: newId(), type: 'function', function: c }));
        j.choices[0].finish_reason = 'tool_calls';
        note = `REPAIRED x${calls.length}`;
      }
    }
    log(`#${id} RES ${up.status} ${note}`);
    res.writeHead(up.status, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(j));
  }

  res.writeHead(up.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  let pending = '', captured = null, structured = 0, template = null, buf = '', finished = false, contentLen = 0;
  const flushText = (text, tpl) => { if (text) { contentLen += text.length; send({ ...tpl, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }); } };

  const handleFinish = (chunk) => {
    let note = structured ? `structured x${structured}` : 'text';
    if (captured !== null) {
      const calls = parseTextCalls(captured, tools);
      if (calls.length) {
        send({ ...template, choices: [{ index: 0, delta: { tool_calls: calls.map((c, i) => ({ index: structured + i, id: newId(), type: 'function', function: c })) }, finish_reason: null }] });
        chunk.choices[0].finish_reason = 'tool_calls';
        note = `REPAIRED x${calls.length}${structured ? ` +structured x${structured}` : ''}`;
      } else { flushText(captured, template); note += ' (marker but unparsable)'; }
    } else if (pending) flushText(pending, template);
    pending = ''; captured = null; finished = true;
    log(`#${id} RES ${up.status} ${note} content_chars=${contentLen} finish=${chunk.choices[0].finish_reason}`);
  };

  const onData = (data) => {
    if (data === '[DONE]') { res.write('data: [DONE]\n\n'); return; }
    let chunk; try { chunk = JSON.parse(data); } catch { res.write(`data: ${data}\n\n`); return; }
    const ch = chunk.choices?.[0];
    if (!ch) { send(chunk); return; }
    template ??= { id: chunk.id, object: chunk.object, created: chunk.created, model: chunk.model, system_fingerprint: chunk.system_fingerprint };
    const d = ch.delta ?? {};
    if (d.tool_calls?.length) structured += d.tool_calls.filter((t) => t.id).length || 0;
    const text = typeof d.content === 'string' ? d.content : '';
    if (text) {
      if (captured !== null) captured += text;
      else {
        pending += text;
        const hits = MARKERS.map((m) => pending.indexOf(m)).filter((i) => i >= 0);
        if (hits.length) { const cut = Math.min(...hits); flushText(pending.slice(0, cut), template); captured = pending.slice(cut); pending = ''; }
        else { const h = holdIndex(pending); const out = h >= 0 ? pending.slice(0, h) : pending; pending = h >= 0 ? pending.slice(h) : ''; flushText(out, template); }
      }
      d.content = '';
    }
    const rest = { ...d }; if (rest.content === '') delete rest.content;
    if (ch.finish_reason && !finished) {
      if (Object.keys(rest).length && !(Object.keys(rest).length === 1 && rest.role)) send({ ...chunk, choices: [{ ...ch, delta: rest, finish_reason: null }] });
      const fin = { ...chunk, choices: [{ ...ch, delta: {} }] };
      handleFinish(fin); send(fin); return;
    }
    if (Object.keys(rest).length) send({ ...chunk, choices: [{ ...ch, delta: rest }] });
    else if (ch.finish_reason === null && !text && chunk.usage) send(chunk);
  };

  const dec = new TextDecoder();
  for await (const c of up.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
  if (!finished && template) { const fin = { ...template, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }; handleFinish(fin); send(fin); }
  res.end();
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  server.listen(PORT, '127.0.0.1', () => log(`proxy listening on 127.0.0.1:${PORT} -> ${UPSTREAM}`));
}
