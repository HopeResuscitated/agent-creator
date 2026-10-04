// fakeprov.mjs - scripted fake OpenAI-compatible provider + one isolated REAL jcode.exe run per scenario.
// No model, no network beyond 127.0.0.1. Shared by editstring.mjs (A3 edit-string check) and a3offline.mjs
// (A2-vs-A3 behaviour comparison). Isolation: a fresh JCODE_HOME and sandbox per scenario under <outDir>;
// ~/.jcode is never used (JCODE_HOME points at the scenario home; USERPROFILE/HOME are left alone, as in
// editstring.mjs since it was introduced).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process'; import os from 'node:os'; import { fileURLToPath } from 'node:url';

/** First line of evfp.mjs for the user's real ~/.jcode ("~/.jcode entries=N tree=<sha1>"): the guard that a fake-provider
 *  run left the user's jcode state untouched (each scenario uses its own JCODE_HOME). */
export function jcodeHomeFingerprint() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evfp-')), 'ev.txt');
  spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'evfp.mjs'), out]);
  let line = null; try { line = fs.readFileSync(out, 'utf8').split(/\r?\n/)[0]; } catch { /* */ }
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return line;
}

export const chunk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: 'hermes-local-32k', system_fingerprint: 'fp_ollama', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
const usage = { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
const DONE = 'data: [DONE]\n\n';
const tc = (i, id, name, args) => ({ index: i, id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

/** Response builders. Each returns { status, body } (body is the exact bytes sent; the connection then closes). */
export const R = {
  complete: (text) => ({ status: 200, body: chunk({ role: 'assistant', content: text }) + chunk({}, 'stop') + chunk({}, 'stop', usage).replace(/"choices":\[[^\]]*\]/, '"choices":[]') + DONE }),
  // Ollama's verbatim shape when its tool parser rejects malformed XML after text: empty content, finish null, no usage, no [DONE]
  ollamaRejected: (text) => ({ status: 200, body: chunk({ role: 'assistant', content: text }) + chunk({ content: '' }) }),
  textEof: (text) => ({ status: 200, body: chunk({ role: 'assistant', content: text }) }),
  http500: () => ({ status: 500, body: JSON.stringify({ error: { message: 'XML syntax error on line 5: element <parameter> closed by </function>', type: 'api_error' } }) }),
  toolEof: (file, content) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [tc(0, 'call_w1', 'write', { file_path: file, content, intent: 'write file' })] }) }),
  toolDone: (file, content) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [tc(0, 'call_w0', 'write', { file_path: file, content, intent: 'write file' })] }) + chunk({}, 'tool_calls') + DONE }),
  /** several tool calls in ONE response, in order: calls = [{ id, name, args }] */
  tools: (calls) => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: calls.map((c, i) => tc(i, c.id, c.name, c.args)) }) + chunk({}, 'tool_calls') + DONE }),
  /** one tool call whose arguments arrive split across several deltas */
  toolSplit: (id, name, args, parts) => {
    const s = JSON.stringify(args); const n = Math.ceil(s.length / parts); let body = chunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] });
    for (let i = 0; i < s.length; i += n) body += chunk({ tool_calls: [{ index: 0, function: { arguments: s.slice(i, i + n) } }] });
    return { status: 200, body: body + chunk({}, 'tool_calls') + DONE };
  },
  edit: (edits, file = 'out.txt') => ({ status: 200, body: chunk({ role: 'assistant', tool_calls: [tc(0, 'call_e0', 'edit', { file_path: file, intent: 'edit', edits })] }) + chunk({}, 'tool_calls') + DONE }),
};

export function configToml(port) {
  return `[server]
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
`;
}

/**
 * Run one scenario: sc = { id, desc, script: [response...], seed?: { file: content } }. The n-th request gets
 * script[n] (the last entry repeats). Returns a result with every request's message summary, the sandbox files
 * after the run, exit code and stdout/stderr tails; also written to <base>/result.json.
 */
export async function runScenario(JC, sc, outDir, label, { timeoutMs = 240000 } = {}) {
  const reqs = []; let i = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch { /* */ }
      const msgs = body.messages ?? [];
      reqs.push({ path: req.url, msgs: msgs.length, roles: msgs.map((m) => m.role).join(','), hasPartial: b.includes('PARTIAL-XYZ'),
        toolResult: (msgs.filter((m) => m.role === 'tool').pop()?.content ?? null),
        toolResults: msgs.filter((m) => m.role === 'tool').map((m) => ({ id: m.tool_call_id ?? null, content: String(m.content) })),
        assistantToolCalls: msgs.filter((m) => m.role === 'assistant' && m.tool_calls).map((m) => m.tool_calls.map((t) => `${t.id}:${t.function?.name}`).join('+')),
        bodySha: crypto.createHash('sha256').update(JSON.stringify(msgs)).digest('hex').slice(0, 12),
        lastTool: msgs.filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 60)).pop() ?? null });
      const r = sc.script[Math.min(i, sc.script.length - 1)]; i++;
      if (r.status !== 200) { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(r.body); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(r.body); // clean close: EOF right after the scripted bytes
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = fs.mkdtempSync(path.join(outDir, `${label}-${sc.id}-`));
  const home = path.join(base, 'home'), sb = path.join(base, 'sandbox'); fs.mkdirSync(home); fs.mkdirSync(sb);
  for (const [f, c] of Object.entries(sc.seed ?? { 'out.txt': 'alpha\nbeta\n' })) fs.writeFileSync(path.join(sb, f), c);
  fs.writeFileSync(path.join(home, 'config.toml'), configToml(port));
  // telemetry opt-out as in run-in-job.ps1 (config [telemetry] enabled=false alone still prints jcode's notice)
  const env = { ...process.env, JCODE_HOME: home, JCODE_RUN_AUTO_POKE: '0', JCODE_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const p = spawn(JC, ['-p', 'openai-compatible', '--provider-profile', 'evalbroker', '-m', 'hermes-local-32k', 'run', '--no-update', 'Do the task.'], { cwd: sb, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false; p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (err += c));
    const kill = setTimeout(() => { killed = true; p.kill(); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(kill); resolve({ code, out, err, killed }); });
  });
  srv.close();
  const files = {};
  for (const f of fs.readdirSync(sb)) { const fp = path.join(sb, f); if (fs.statSync(fp).isFile()) files[f] = fs.readFileSync(fp, 'utf8'); }
  const res = { scenario: sc.id, desc: sc.desc, exit: r.code, killed: r.killed, requests: reqs.length, reqs, seconds: Math.round((Date.now() - t0) / 1000),
    files, out_txt: files['out.txt'] ?? null,
    stdout_tail: r.out.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-300), stderr_tail: r.err.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-400) };
  fs.writeFileSync(path.join(base, 'result.json'), JSON.stringify(res, null, 1));
  return res;
}
