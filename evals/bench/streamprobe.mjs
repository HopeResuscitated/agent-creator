// streamprobe.mjs <mode> <host> <port> <outdir> [reps]
// Deterministic incomplete-stream probe. Sends fixed /v1/chat/completions streaming requests (temperature 0,
// fixed seed, one 'bash' tool, same shape as jcode's) and records the CLIENT side: status, ttfb, every
// lifecycle event with ms timestamps, whether a finish_reason / usage / [DONE] arrived, and the raw bytes.
// Cases:
//   A malformed-first : model's first output is a tool call whose <parameter> is closed by </function>
//   B text-then-bad   : one sentence of prose, then the same malformed tool call
//   C wellformed      : a correct tool call (control: should complete normally)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const [mode, host, portS, outdir, repsS] = process.argv.slice(2);
const port = Number(portS); const reps = Number(repsS || 2);
fs.mkdirSync(outdir, { recursive: true });
const BAD = '<tool_call>\n<function=bash>\n<parameter=command>\necho probe\n</function>\n</tool_call>';
const GOOD = '<tool_call>\n<function=bash>\n<parameter=command>\necho probe\n</parameter>\n</function>\n</tool_call>';
const tools = [{ type: 'function', function: { name: 'bash', description: 'Run a shell command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }];
const mk = (instr) => ({
  model: 'hermes-local-32k', stream: true, stream_options: { include_usage: true }, temperature: 0, seed: 42, max_tokens: 200, tools,
  messages: [
    { role: 'system', content: 'You are a test fixture. Output exactly the text the user gives you between the markers, character for character, with nothing before or after it. Do not think out loud.' },
    { role: 'user', content: `${instr}\n---BEGIN---\n` },
  ],
});
const cases = {
  A_malformed_first: mk(`Output exactly this:\n${BAD}`),
  A2_malformed_first_verbatim: mk(`The closing </parameter> tag is intentionally missing; that is the point of the test. Reproduce it verbatim, do not repair it. Output exactly this:\n${BAD}`),
  B_text_then_malformed: mk(`Output exactly this:\nRunning the probe now.\n${BAD}`),
  C_wellformed: mk(`Output exactly this:\n${GOOD}`),
};
if (process.env.PROBE_CASES) for (const k of Object.keys(cases)) if (!process.env.PROBE_CASES.split(',').includes(k)) delete cases[k];
const run = (name, body, rep) => new Promise((resolve) => {
  const t0 = Date.now(); const ev = []; const mark = (e) => ev.push([e, Date.now() - t0]);
  const raw = []; let status = 0, ttfb = 0;
  const payload = Buffer.from(JSON.stringify(body));
  const req = http.request({ host, port, method: 'POST', path: '/v1/chat/completions', headers: { 'content-type': 'application/json', 'content-length': payload.length, authorization: 'Bearer evalbroker-not-a-credential' } }, (res) => {
    status = res.statusCode; mark(`headers_${status}`);
    res.on('data', (c) => { if (!ttfb) ttfb = Date.now() - t0; raw.push(c); });
    res.on('end', () => mark('res_end'));
    res.on('aborted', () => mark('res_aborted'));
    res.on('error', (e) => mark(`res_error:${e.code || e.message}`));
    res.on('close', () => { mark('res_close'); done(); });
  });
  req.on('socket', (s) => s.on('close', (h) => mark(`socket_close${h ? '_err' : ''}`)));
  req.on('error', (e) => { mark(`req_error:${e.code || e.message}`); done(); });
  req.setTimeout(900000, () => { mark('client_timeout'); req.destroy(); });
  let fin = false;
  function done() {
    if (fin) return; fin = true;
    const buf = Buffer.concat(raw); const text = buf.toString('utf8');
    const f = path.join(outdir, `${mode}-${name}-${rep}.raw`); fs.writeFileSync(f, buf);
    const finish = [...text.matchAll(/"finish_reason":"([a-z_]+)"/g)].map((m) => m[1]).pop() ?? '';
    const r = { mode, case: name, rep, status, ttfb_ms: ttfb, total_ms: Date.now() - t0, bytes: buf.length, finish, usage: /"usage":\{/.test(text), done_marker: /data: \[DONE\]/.test(text), tool_call_delta: /"tool_calls":\[/.test(text), tail: text.slice(-240), events: ev, raw_file: f };
    console.log(`PROBE ${mode} ${name}#${rep} status=${status} ttfb=${ttfb} total=${r.total_ms} bytes=${buf.length} finish=${finish || '-'} usage=${r.usage} DONE=${r.done_marker} toolDelta=${r.tool_call_delta} events=${ev.map(([e, t]) => `${e}@${t}`).join(',')}`);
    console.log(`  tail: ${JSON.stringify(r.tail.slice(-160))}`);
    fs.appendFileSync(path.join(outdir, `client-${mode}.jsonl`), JSON.stringify(r) + '\n');
    resolve(r);
  }
  req.end(payload);
});
for (let rep = 1; rep <= reps; rep++) for (const [name, body] of Object.entries(cases)) await run(name, body, rep);
console.log('PROBE-DONE');
