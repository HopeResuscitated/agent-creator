// editstring.mjs - A3 check: a REAL jcode.exe against a scripted fake OpenAI-compatible server (no model, no network).
// The fake model sends one edit tool call whose `edits` is: E1 a JSON array, E2 a strict-JSON string, E3 a string whose
// nested strings hold raw newline/tab (the shape seen in 2 of 24 real edit calls), E4 an unparseable string.
//   "$NODE_BIN" evals/bench/editstring.mjs <jcode.exe> <label> --expect fixed|unfixed
// fixed   (A3, jcode 710560f91): E1 E2 E3 applied identically, E4 rejected with the file untouched.
// unfixed (A2 pin, 7ed7403f8):   E1 applied; E2 E3 E4 rejected with the file untouched.
// Prints one line per scenario, then EDITSTRING PASS/FAIL; exit 0/1. Isolation: fresh JCODE_HOME + sandbox per scenario
// under the OS temp dir; ~/.jcode is never used. Origin: hermes-bench-archive/cycle9/a3-candidate/a3e2e.mjs.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn } from 'node:child_process'; import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const [JC, LABEL, EXPECT_FLAG, EXPECT] = process.argv.slice(2);
if (!JC || !LABEL || EXPECT_FLAG !== '--expect' || !['fixed', 'unfixed'].includes(EXPECT)) { console.error('usage: editstring.mjs <jcode.exe> <label> --expect fixed|unfixed'); process.exit(3); }
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'editstring-'));
fs.mkdirSync(OUT, { recursive: true });

const chunk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: 'hermes-local-32k', system_fingerprint: 'fp_ollama', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
const usage = { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
// response kinds
const R = {
  complete: (text) => ({ status: 200, body: chunk({ role: 'assistant', content: text }) + chunk({}, 'stop') + chunk({}, 'stop', usage).replace(/"choices":\[[^\]]*\]/, '"choices":[]') + 'data: [DONE]\n\n' }),
  // Ollama's verbatim shape when its tool parser rejects malformed XML after text: empty content, finish null, no usage, no [DONE]
  ollamaRejected: (text) => ({ status: 200, body: chunk({ role: 'assistant', content: text }) + chunk({ content: '' }) }),
  textEof: (text) => ({ status: 200, body: chunk({ role: 'assistant', content: text }) }),
  http500: () => ({ status: 500, body: JSON.stringify({ error: { message: 'XML syntax error on line 5: element <parameter> closed by </function>', type: 'api_error' } }) }),
  toolEof: (file, content) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_w1', type: 'function', function: { name: 'write', arguments: JSON.stringify({ file_path: file, content, intent: 'write file' }) } }] }) }),
  toolDone: (file, content) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_w0', type: 'function', function: { name: 'write', arguments: JSON.stringify({ file_path: file, content, intent: 'write file' }) } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n' }),
};
const editCall = (edits) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_e0', type: 'function', function: { name: 'edit', arguments: JSON.stringify({ file_path: 'out.txt', intent: 'edit', edits }) } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n' });
const SEED = 'alpha\nbeta\n';
const scenariosA3 = [
  { id: 'E1_native_array', desc: 'edits as a JSON array (unchanged path)', script: [editCall([{ old_string: 'alpha\n', new_string: 'ALPHA\n\tx\n' }]), R.complete('Done.')] },
  { id: 'E2_string_strict', desc: 'edits as a strict-JSON string', script: [editCall(JSON.stringify([{ old_string: 'alpha\n', new_string: 'ALPHA\n\tx\n' }])), R.complete('Done.')] },
  { id: 'E3_string_raw_newlines', desc: 'edits as a string whose nested strings hold raw newline/tab (observed qwen/Ollama shape)', script: [editCall('[{"new_string":"ALPHA\n\tx\n","old_string":"alpha\n"}]'), R.complete('Done.')] },
  { id: 'E4_string_garbage', desc: 'edits as an unparseable string (must still be an error; file untouched)', script: [editCall('[{"old_string": alpha'), R.complete('Done.')] },
];
const scenarios = [
  { id: 'S1_complete', desc: 'normal 200 with finish_reason', script: [R.complete('All done.')] },
  { id: 'S2_text_eof_always', desc: '200 text then EOF, no finish_reason, every time', script: [R.textEof('partial A'), R.textEof('partial B'), R.textEof('partial C'), R.textEof('partial D'), R.textEof('partial E')] },
  { id: 'S3_t13_malformed_then_ok', desc: 'Ollama rejected-tool-call tail, then a good response', script: [R.ollamaRejected("I'll update the parser now."), R.complete('Fixed it.')] },
  { id: 'S4a_500_then_ok', desc: 'HTTP 500 (Ollama parse error body), then a good response', script: [R.http500(), R.complete('Recovered after 500.')] },
  { id: 'S4b_500_always', desc: 'HTTP 500 every time', script: Array(12).fill(0).map(() => R.http500()) },
  { id: 'S5a_tool_then_eof', desc: 'tool call streamed, then EOF without finish_reason (tool must run, response not retried)', script: [R.toolEof('out.txt', 'from-S5a'), R.complete('Wrote the file.')] },
  { id: 'S5b_tool_ran_earlier_then_text_eof', desc: 'earlier turn ran a tool; next response is text+EOF (per-response rule)', script: [R.toolDone('out.txt', 'from-S5b'), R.ollamaRejected('Now checking the file.'), R.complete('Checked.')] },
  { id: 'S6_partial_not_in_history', desc: 'text+EOF (PARTIAL-XYZ), retry gives a tool call, then completion: later requests must not contain the discarded text', script: [R.ollamaRejected('PARTIAL-XYZ thinking'), R.toolDone('out.txt', 'from-S6'), R.complete('Finished.')] },
];

async function runScenario(sc) {
  const reqs = []; let i = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch { /* */ }
      const msgs = body.messages ?? [];
      reqs.push({ path: req.url, msgs: msgs.length, roles: msgs.map((m) => m.role).join(','), hasPartial: b.includes('PARTIAL-XYZ'), toolResult: (msgs.filter((m) => m.role === 'tool').pop()?.content ?? null), bodySha: require('node:crypto').createHash('sha256').update(JSON.stringify(msgs)).digest('hex').slice(0,12), lastTool: msgs.filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 60)).pop() ?? null });
      const r = sc.script[Math.min(i, sc.script.length - 1)]; i++;
      if (r.status !== 200) { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(r.body); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(r.body);  // clean close: EOF right after the scripted bytes
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = fs.mkdtempSync(path.join(OUT, `${LABEL}-${sc.id}-`));
  const home = path.join(base, 'home'), sb = path.join(base, 'sandbox'); fs.mkdirSync(home); fs.mkdirSync(sb); fs.writeFileSync(path.join(sb, 'out.txt'), SEED);
  fs.writeFileSync(path.join(home, 'config.toml'), `[server]
wake_mode = "internal"
[tools]
profile = "minimal"
enabled = ["bash", "read", "write", "edit", "ls"]
mcp_tools = "deferred"
[features]
check_updates = false
memory = false
swarm = false
mermaid = false
auto_poke = false
persist_memory_injections = false
[provider]
default_model = "hermes-local-32k"
default_provider = "evalbroker"
cross_provider_failover = "off"
max_retries = 8
retry_backoff_cap_secs = 1
stream_idle_timeout_secs = 60
[providers.evalbroker]
type = "open-ai-compatible"
base_url = "http://127.0.0.1:${port}/v1"
auth = "bearer"
api_key = "fake-not-a-credential"
default_model = "hermes-local-32k"
provider_routing = false
model_catalog = false
allow_provider_pinning = false
disable_reasoning_heuristics = true
[[providers.evalbroker.models]]
id = "hermes-local-32k"
context_window = 32768
[agents]
swarm_spawn_mode = "inline"
swarm_max_concurrent_agents = 1
memory_sidecar_enabled = false
[ambient]
enabled = false
allow_api_keys = false
[telemetry]
enabled = false
`);
  const env = { ...process.env, JCODE_HOME: home, JCODE_RUN_AUTO_POKE: '0' };
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const p = spawn(JC, ['-p', 'openai-compatible', '--provider-profile', 'evalbroker', '-m', 'hermes-local-32k', 'run', '--no-update', 'Do the task.'], { cwd: sb, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (err += c));
    const kill = setTimeout(() => p.kill(), 240000);
    p.on('close', (code) => { clearTimeout(kill); resolve({ code, out, err }); });
  });
  srv.close();
  const file = path.join(sb, 'out.txt');
  const res = { scenario: sc.id, desc: sc.desc, exit: r.code, requests: reqs.length, reqs, seconds: Math.round((Date.now() - t0) / 1000),
    out_txt: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
    stdout_tail: r.out.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-300), stderr_tail: r.err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-400) };
  fs.writeFileSync(path.join(base, 'result.json'), JSON.stringify(res, null, 1));
  return res;
}

scenarios.length = 0; scenarios.push(...scenariosA3);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const all = [];
for (const sc of scenarios) {
  if (only && !only.includes(sc.id)) continue;
  const r = await runScenario(sc); all.push(r);
  console.log(`${LABEL} ${r.scenario.padEnd(36)} exit=${r.exit} requests=${r.requests} out.txt=${JSON.stringify(r.out_txt)} ${r.seconds}s | stdout: ${JSON.stringify(r.stdout_tail.slice(-120))}`);
}
fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(all, null, 1));
const APPLIED = SEED.replace('alpha\n', 'ALPHA\n	x\n');   // what E1 (native array) produces
const want = { E1_native_array: true, E2_string_strict: EXPECT === 'fixed', E3_string_raw_newlines: EXPECT === 'fixed', E4_string_garbage: false };
let fails = 0;
for (const r of all) {
  const toolErr = r.reqs.length >= 2 && String(r.reqs[1].toolResult ?? '').startsWith('[Error]');
  const applied = r.out_txt === APPLIED, untouched = r.out_txt === SEED;
  const ok = r.exit === 0 && (want[r.scenario] ? applied && !toolErr : untouched && toolErr);
  if (!ok) fails++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${r.scenario.padEnd(24)} want ${want[r.scenario] ? 'applied' : 'rejected+untouched'} got ${applied ? 'applied' : untouched ? 'untouched' : 'OTHER'}${toolErr ? ' (tool error)' : ''}`);
}
if (all.length !== 4) fails++;
console.log(`EDITSTRING ${fails ? 'FAIL' : 'PASS'} expect=${EXPECT} scenarios=${all.length} out=${OUT}`); process.exit(fails ? 1 : 0);
