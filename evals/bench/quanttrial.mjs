// quanttrial.mjs - model-server measurement for the H quant trial (PLAN.yaml H_hardware.quant_trial) and for
// post-hardware throughput validation. Replays REAL captured eval requests (meter raw/*.req.json) against one
// Ollama model and classifies every response. Talks to Ollama directly (like probe.sh): run it alone, on AC,
// with nothing else using Ollama (attrmon.ps1 can prove that).
//
//   "$NODE_BIN" evals/bench/quanttrial.mjs --model <ollama model> --requests <dir> [--requests <dir>]...
//        --out <results.jsonl> [--reps 2] [--limit N] [--upstream 127.0.0.1:11434] [--timeout-s 900]
//
// Requests: every *.req.json under the --requests dirs, de-duplicated by body sha256 and ordered by that hash, so
// the same archive always gives the same request list in the same order. `model` is replaced by --model; nothing
// else in the body is changed (messages, tools, tool_choice, stream options are the agent's own).
// Each request is sent --reps times (sampling is stochastic). Classes:
//   complete           200, finish_reason present and [DONE]           (sub: tool_calls / stop / length)
//   eof_no_finish      200 ending without finish_reason and [DONE]     (Ollama rejected a malformed tool call; the A2 case)   MALFORMED
//   http_500_parse     HTTP 500 whose body is a tool-call parse error  (malformed-first case)                               MALFORMED
//   tool_xml_in_text   complete, but the text contains <function= / <tool_call> (tool call leaked into prose)               MALFORMED
//   bad_tool_args      complete tool_calls whose arguments are not a JSON object                                          MALFORMED
//   http_other / error / timeout                                                                                          (reported, not MALFORMED)
// Informational: edits_as_string = an edit tool call whose `edits` is a string (the A3 shape).
// Summary (stdout + <out>.summary.json): counts, malformed rate with a Wilson 95% interval, median first-token
// latency, median and aggregate decode tok/s (completion_tokens / (total - ttfb)), prompt-token range.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import crypto from 'node:crypto';
const a = process.argv.slice(2); const opt = { requests: [], reps: 2, upstream: '127.0.0.1:11434', timeoutS: 900, limit: 0 };
for (let i = 0; i < a.length; i++) {
  const k = a[i], v = a[i + 1];
  if (k === '--model') { opt.model = v; i++; } else if (k === '--requests') { opt.requests.push(v); i++; } else if (k === '--out') { opt.out = v; i++; }
  else if (k === '--reps') { opt.reps = +v; i++; } else if (k === '--limit') { opt.limit = +v; i++; } else if (k === '--upstream') { opt.upstream = v; i++; }
  else if (k === '--timeout-s') { opt.timeoutS = +v; i++; } else { console.error('unknown arg', k); process.exit(3); }
}
if (!opt.model || !opt.requests.length || !opt.out) { console.error('usage: quanttrial.mjs --model <m> --requests <dir>... --out <file.jsonl> [--reps 2] [--limit N]'); process.exit(3); }
const [HOST, PORT] = opt.upstream.split(':');
const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.req.json')) files.push(p); } };
for (const d of opt.requests) walk(d);
const byHash = new Map();
for (const f of files) { const raw = fs.readFileSync(f, 'utf8'); const h = crypto.createHash('sha256').update(raw).digest('hex'); if (!byHash.has(h)) byHash.set(h, { h, f }); }
let list = [...byHash.values()].sort((x, y) => (x.h < y.h ? -1 : 1));
if (opt.limit) list = list.slice(0, opt.limit);
console.log(`requests: ${files.length} files, ${byHash.size} unique, using ${list.length} x ${opt.reps} reps, model ${opt.model}`);

function send(body) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let ttfb = 0, buf = '', status = 0, done = false;
    const q = http.request({ host: HOST, port: +PORT, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      status = res.statusCode; res.setEncoding('utf8');
      res.on('data', (c) => { if (!ttfb) ttfb = Date.now() - t0; buf += c; });
      res.on('end', () => { if (!done) { done = true; clearTimeout(timer); resolve({ status, buf, ttfb, total: Date.now() - t0 }); } });
      res.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ status, buf, ttfb, total: Date.now() - t0, error: String(e) }); } });
    });
    const timer = setTimeout(() => { if (!done) { done = true; q.destroy(); resolve({ status, buf, ttfb, total: Date.now() - t0, timeout: true }); } }, opt.timeoutS * 1000);
    q.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ status, buf, ttfb, total: Date.now() - t0, error: String(e) }); } });
    q.end(body);
  });
}
function classify(r) {
  const out = { status: r.status, ttfb_ms: r.ttfb, total_ms: r.total };
  if (r.timeout) return { ...out, cls: 'timeout' };
  if (r.error && !r.status) return { ...out, cls: 'error', detail: r.error };
  if (r.status !== 200) {
    const parse = /XML syntax error|tool call|parse|unexpected|closed by/i.test(r.buf);
    return { ...out, cls: r.status === 500 && parse ? 'http_500_parse' : 'http_other', detail: r.buf.slice(0, 200) };
  }
  let finish = null, sawDone = false, text = '', usage = null; const calls = {};
  for (const line of r.buf.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue; const d = line.slice(5).trim();
    if (d === '[DONE]') { sawDone = true; continue; }
    let j; try { j = JSON.parse(d); } catch { continue; }
    if (j.usage) usage = j.usage;
    for (const ch of j.choices || []) {
      if (ch.finish_reason) finish = ch.finish_reason;
      const dl = ch.delta || {}; if (dl.content) text += dl.content;
      for (const tc of dl.tool_calls || []) { const k = tc.index ?? 0; calls[k] ??= { name: '', args: '' }; if (tc.function?.name) calls[k].name += tc.function.name; if (tc.function?.arguments) calls[k].args += tc.function.arguments; }
    }
  }
  const tool_calls = Object.values(calls);
  Object.assign(out, { finish, done: sawDone, prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null, tools: tool_calls.map((c) => c.name) });
  if (!finish && !sawDone) return { ...out, cls: 'eof_no_finish', text_tail: text.slice(-120) };
  if (/<function=|<tool_call>/.test(text)) return { ...out, cls: 'tool_xml_in_text', text_tail: text.slice(-160) };
  let badArgs = false, editsString = false;
  for (const c of tool_calls) { let v; try { v = JSON.parse(c.args || '{}'); } catch { badArgs = true; continue; } if (!v || typeof v !== 'object' || Array.isArray(v)) badArgs = true; else if (c.name === 'edit' && typeof v.edits === 'string') editsString = true; }
  if (badArgs) return { ...out, cls: 'bad_tool_args' };
  return { ...out, cls: 'complete', sub: finish, edits_as_string: editsString };
}
const MALFORMED = new Set(['eof_no_finish', 'http_500_parse', 'tool_xml_in_text', 'bad_tool_args']);
fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true }); fs.writeFileSync(opt.out, '');
const rows = [];
for (let rep = 1; rep <= opt.reps; rep++) {
  for (const [i, it] of list.entries()) {
    const body = JSON.parse(fs.readFileSync(it.f, 'utf8')); body.model = opt.model;
    const r = classify(await send(JSON.stringify(body)));
    const row = { t: new Date().toISOString(), rep, i, req_sha: it.h.slice(0, 16), src: it.f, msgs: body.messages?.length ?? 0, ...r };
    rows.push(row); fs.appendFileSync(opt.out, JSON.stringify(row) + '\n');
    console.log(`${rep}.${String(i + 1).padStart(3)}/${list.length} ${row.cls.padEnd(16)} ${row.sub ?? ''} ttfb ${(r.ttfb_ms / 1000).toFixed(1)}s total ${(r.total_ms / 1000).toFixed(1)}s prompt ${row.prompt_tokens ?? '-'} compl ${row.completion_tokens ?? '-'}`);
  }
}
const n = rows.length, bad = rows.filter((r) => MALFORMED.has(r.cls)).length;
const wilson = (k, m, z = 1.96) => { if (!m) return [0, 0]; const p = k / m, d = 1 + z * z / m, c = p + z * z / (2 * m), e = z * Math.sqrt(p * (1 - p) / m + z * z / (4 * m * m)); return [(c - e) / d, (c + e) / d]; };
const med = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const dec = rows.filter((r) => r.completion_tokens && r.total_ms > r.ttfb_ms).map((r) => ({ tok: r.completion_tokens, s: (r.total_ms - r.ttfb_ms) / 1000 }));
const counts = {}; for (const r of rows) counts[r.cls] = (counts[r.cls] || 0) + 1;
const pt = rows.map((r) => r.prompt_tokens).filter((x) => x != null);
const summary = { model: opt.model, requests_unique: list.length, reps: opt.reps, n, counts, malformed: bad, malformed_rate: n ? bad / n : 0,
  malformed_rate_wilson95: wilson(bad, n), edits_as_string: rows.filter((r) => r.edits_as_string).length,
  median_ttfb_s: med(rows.map((r) => r.ttfb_ms / 1000)), median_decode_tok_s: med(dec.map((d) => d.tok / d.s)),
  aggregate_decode_tok_s: dec.length ? dec.reduce((x, d) => x + d.tok, 0) / dec.reduce((x, d) => x + d.s, 0) : null,
  prompt_tokens_min: pt.length ? Math.min(...pt) : null, prompt_tokens_max: pt.length ? Math.max(...pt) : null };
fs.writeFileSync(opt.out + '.summary.json', JSON.stringify(summary, null, 1));
console.log('SUMMARY ' + JSON.stringify(summary));
