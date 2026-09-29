// Eval runner for agent creator.
//
//   node evals/run.ts                          run all tasks with the default local agent
//   node evals/run.ts --only T01,T05            run selected tasks
//   node evals/run.ts --agent jcode --provider lmstudio --model omnicoder-9b
//   node evals/run.ts --agent none              no agent: baseline (every task should FAIL)
//   node evals/run.ts --prepare T06             make a sandbox + print the prompt (for Hermes/Copilot/manual)
//   node evals/run.ts --grade T06 <sandboxDir>  grade a sandbox someone else worked in
//
// Every task runs in a fresh copy of the repo, so the real repo is never touched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { checks } from './checks.ts';

type Task = { id: string; title: string; difficulty: string; category: string; timeoutMin: number; prompt: string; setup?: { from: string; to: string }[] };

const EVALS = import.meta.dirname;
const REPO = path.dirname(EVALS);
const tasks: Task[] = JSON.parse(fs.readFileSync(path.join(EVALS, 'tasks.json'), 'utf8'));
// Grader-owned top-level path: never part of the subject starting state.
const GRADER_DIR = 'evals';

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const agent = flag('agent', 'jcode')!;
const provider = flag('provider', 'ollama')!;
const model = flag('model', 'hermes-local-32k')!;
// Optional named jcode provider profile (jcode --provider-profile). Passed through only when supplied.
const providerProfile = flag('provider-profile');
if (argv.includes('--provider-profile') && (!providerProfile || providerProfile.startsWith('--'))) { console.error('--provider-profile requires a value'); process.exit(2); }
// Sandbox starting state = a frozen git commit, never the live working tree, so
// uncommitted/new work in the real repo cannot leak into a capability score.
const baseline = flag('baseline', 'eval-baseline-v1')!;
const baselineSha = (() => {
  const r = spawnSync('git', ['rev-parse', '--verify', `${baseline}^{commit}`], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) { console.error(`baseline ref not found: ${baseline}\n${r.stderr}`); process.exit(2); }
  return r.stdout.trim();
})();

/**
 * Write the tracked tree of commit `sha` (minus evals/) into dest as raw blob bytes.
 * Fails closed on anything raw bytes cannot reproduce faithfully: symlinks, exec bits,
 * submodules, .gitattributes (checkout filters), or a malformed cat-file response.
 */
function extractTree(sha: string, dest: string) {
  const ls = spawnSync('git', ['ls-tree', '-r', '-z', '--full-tree', sha], { cwd: REPO, encoding: 'buffer', maxBuffer: 64 << 20 });
  if (ls.status !== 0) throw new Error(`git ls-tree failed: ${ls.stderr}`);
  const all = ls.stdout.toString('utf8').split('\0').filter(Boolean).map((l) => {
    const tab = l.indexOf('\t');
    const [mode, type, obj] = l.slice(0, tab).split(' ');
    return { mode, type, obj, file: l.slice(tab + 1) };
  });
  for (const e of all) {
    if (e.type !== 'blob') throw new Error(`baseline: unsupported ${e.type} entry: ${e.file}`);
    if (e.mode !== '100644') throw new Error(`baseline: unsupported mode ${e.mode} (symlink/executable): ${e.file}`);
    if (e.file.split('/').includes('.gitattributes')) throw new Error(`baseline: .gitattributes present (raw blobs != checkout): ${e.file}`);
    if (!/^[0-9a-f]{40}$/.test(e.obj) || e.file.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new Error(`baseline: bad entry: ${e.obj} ${e.file}`);
  }
  const entries = all.filter((e) => e.file.split('/')[0] !== GRADER_DIR);
  const cat = spawnSync('git', ['cat-file', '--batch'], { cwd: REPO, input: entries.map((e) => e.obj).join('\n') + '\n', maxBuffer: 256 << 20 });
  if (cat.status !== 0) throw new Error(`git cat-file failed: ${cat.stderr}`);
  const buf = cat.stdout as Buffer; let off = 0;
  for (const e of entries) {
    const nl = buf.indexOf(10, off);
    if (nl < 0) throw new Error(`cat-file: truncated header for ${e.file}`);
    const header = buf.subarray(off, nl).toString('utf8');
    const m = /^([0-9a-f]{40}) (\S+) (\d+)$/.exec(header);
    if (!m) throw new Error(`cat-file: bad header "${header}" for ${e.file}`);
    if (m[1] !== e.obj) throw new Error(`cat-file: id mismatch ${m[1]} != ${e.obj} (${e.file})`);
    if (m[2] !== 'blob') throw new Error(`cat-file: type ${m[2]} != blob (${e.file})`);
    const size = Number(m[3]);
    const end = nl + 1 + size;
    if (end + 1 > buf.length || buf[end] !== 10) throw new Error(`cat-file: size ${size} does not match payload (${e.file})`);
    const out = path.join(dest, ...e.file.split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf.subarray(nl + 1, end));
    off = end + 1;
  }
  if (off !== buf.length) throw new Error(`cat-file: ${buf.length - off} unexpected trailing bytes`);
}

/**
 * Eval environment fingerprint. Sandboxes copy the LIVE node_modules, which the tag
 * cannot freeze, so installed packages are compared to the pinned manifest
 * evals/baseline-env.json. Drift does not block a run but is recorded on every result,
 * because scores from different environments are not comparable.
 */
const ENV_FILE = path.join(EVALS, 'baseline-env.json');
function envPackages(): Record<string, string> {
  const nm = path.join(REPO, 'node_modules'); const out: Record<string, string> = {};
  const add = (name: string) => {
    try { out[name] = JSON.parse(fs.readFileSync(path.join(nm, name, 'package.json'), 'utf8')).version ?? '?'; } catch { /* not a package */ }
  };
  for (const e of fs.readdirSync(nm)) {
    if (e.startsWith('.')) continue;
    if (e.startsWith('@')) for (const s of fs.readdirSync(path.join(nm, e))) add(`${e}/${s}`);
    else add(e);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
function envDrift(): string[] {
  if (!fs.existsSync(ENV_FILE)) return ['no pinned manifest (run: node evals/run.ts --write-env)'];
  const want: { node: string; packages: Record<string, string> } = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
  const have = envPackages(); const d: string[] = [];
  if (want.node.split('.')[0] !== process.version.split('.')[0]) d.push(`node ${want.node} -> ${process.version}`);
  for (const [k, v] of Object.entries(have)) if (!(k in want.packages)) d.push(`+${k}@${v}`); else if (want.packages[k] !== v) d.push(`${k} ${want.packages[k]} -> ${v}`);
  for (const k of Object.keys(want.packages)) if (!(k in have)) d.push(`-${k}`);
  return d;
}
if (argv.includes('--write-env')) {
  fs.writeFileSync(ENV_FILE, JSON.stringify({ baseline, node: process.version, packages: envPackages() }, null, 2) + '\n');
  console.log(`wrote ${ENV_FILE}`); process.exit(0);
}
const drift = envDrift();
const envLine = drift.length ? `DRIFT (${drift.length}): ${drift.join(', ')}` : 'matches evals/baseline-env.json';
if (drift.length) console.warn(`WARNING eval environment differs from pinned manifest: ${drift.join(', ')}`);

/**
 * Give the sandbox its OWN physical copy of the repo's node_modules (the golden source),
 * so nothing the agent does to its dependencies can reach the repo or other sandboxes.
 * Links are never copied or followed: each one (npm workspace links such as
 * @agent-creator/agent -> <repo>/packages/agent) is recreated to point at the same
 * relative path inside the sandbox. Fails closed if a link would leave the repo or
 * the sandbox, or if its sandbox target does not exist.
 */
function copyNodeModules(dest: string) {
  const src = path.join(REPO, 'node_modules');
  const out = path.join(dest, 'node_modules');
  const within = (p: string, root: string) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  const links: string[] = [];
  fs.cpSync(src, out, { recursive: true, verbatimSymlinks: true, filter: (s) => { if (fs.lstatSync(s).isSymbolicLink()) { links.push(s); return false; } return true; } });
  for (const l of links) {
    const target = path.resolve(path.dirname(l), fs.readlinkSync(l));
    if (!within(target, REPO)) throw new Error(`node_modules link leaves the repo: ${l} -> ${target}`);
    const inSandbox = path.join(dest, path.relative(REPO, target));
    if (!fs.existsSync(inSandbox)) throw new Error(`node_modules link target missing in sandbox: ${l} -> ${inSandbox}`);
    const link = path.join(out, path.relative(src, l));
    fs.symlinkSync(inSandbox, link, 'junction');
    if (!within(fs.realpathSync(link), dest)) throw new Error(`recreated link leaves the sandbox: ${link}`);
  }
}

/**
 * Deterministic fingerprint of <root>/node_modules: every directory, every file (size +
 * sha1 of content) and every link (target relative to root, never followed). Mtimes are
 * ignored. The golden fingerprint is taken once, from the repo's node_modules, and every
 * sandbox copy must equal it, so any change the agent makes to its dependencies shows up.
 */
type Fingerprint = Map<string, string>;
function fingerprintNodeModules(root: string): Fingerprint {
  const nm = path.join(root, 'node_modules'); const fp: Fingerprint = new Map();
  let st: fs.Stats;
  try { st = fs.lstatSync(nm); } catch { fp.set('.', 'MISSING'); return fp; }
  if (st.isSymbolicLink()) { fp.set('.', `LINK ${fs.readlinkSync(nm)}`); return fp; }
  if (!st.isDirectory()) { fp.set('.', 'NOT-A-DIRECTORY'); return fp; }
  (function walk(d: string) {
    for (const e of fs.readdirSync(d).sort()) {
      const f = path.join(d, e); const rel = path.relative(nm, f).replace(/\\/g, '/'); const s = fs.lstatSync(f);
      if (s.isSymbolicLink()) {
        const t = path.relative(root, path.resolve(path.dirname(f), fs.readlinkSync(f)));
        fp.set(rel, t.startsWith('..') || path.isAbsolute(t) ? `L OUTSIDE ${path.resolve(path.dirname(f), fs.readlinkSync(f))}` : `L ${t.replace(/\\/g, '/')}`);
      } else if (s.isDirectory()) { fp.set(rel, 'D'); walk(f); }
      else fp.set(rel, `F ${s.size} ${crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')}`);
    }
  })(nm);
  return fp;
}
let goldenFp: Fingerprint | undefined;
const golden = () => (goldenFp ??= fingerprintNodeModules(REPO));
/** Differences between a sandbox fingerprint and the golden one, as `+path`, `-path`, `~path`. */
function fpDiff(have: Fingerprint): string[] {
  const want = golden(); const d: string[] = [];
  for (const [k, v] of have) if (!want.has(k)) d.push(`+${k}`); else if (want.get(k) !== v) d.push(`~${k}`);
  for (const k of want.keys()) if (!have.has(k)) d.push(`-${k}`);
  return d;
}

type EnvStatus = { env: 'CLEAN' | 'ENV_CONTAMINATED' | 'ENV_RESTORE_FAILED'; envDetail: string };
/**
 * Post-agent dependency integrity, run after the agent and before grading. If the
 * sandbox's node_modules differs from the golden fingerprint in any way, the agent's tree
 * is moved OUT of the sandbox as evidence (<ws>.contaminated-node_modules-<time>, with a
 * .txt listing every difference), a fresh golden copy is put in its place, and the copy is
 * re-verified. Grading happens only on a verified golden tree.
 */
function checkAndRestoreEnv(ws: string): EnvStatus {
  const d = fpDiff(fingerprintNodeModules(ws));
  if (!d.length) return { env: 'CLEAN', envDetail: '' };
  const summary = `${d.length} node_modules difference(s): ${d.slice(0, 8).join(', ')}${d.length > 8 ? ', ...' : ''}`;
  try {
    const evidence = `${ws}.contaminated-node_modules-${Date.now()}`;
    const nm = path.join(ws, 'node_modules');
    let exists = true; try { fs.lstatSync(nm); } catch { exists = false; }
    if (exists) fs.renameSync(nm, evidence);
    fs.writeFileSync(`${evidence}.txt`, `sandbox: ${ws}\nnode_modules ${exists ? `moved to: ${evidence}` : 'was missing'}\n${d.join('\n')}\n`);
    copyNodeModules(ws);
    const after = fpDiff(fingerprintNodeModules(ws));
    if (after.length) throw new Error(`restored tree still differs from golden: ${after.slice(0, 5).join(', ')}`);
    return { env: 'ENV_CONTAMINATED', envDetail: `${summary}; restored from golden; evidence: ${evidence}` };
  } catch (e) {
    return { env: 'ENV_RESTORE_FAILED', envDetail: `${summary}; restore failed: ${(e as Error).message}` };
  }
}

function copyRepo(dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  extractTree(baselineSha, dest);
  fs.mkdirSync(path.join(dest, 'docs'), { recursive: true });
  copyNodeModules(dest);
  const d = fpDiff(fingerprintNodeModules(dest));
  if (d.length) throw new Error(`sandbox node_modules does not match golden (repo node_modules changed during the run?): ${d.slice(0, 5).join(', ')}`);
}

function prepare(task: Task, root: string): string {
  const ws = path.join(root, task.id);
  fs.rmSync(ws, { recursive: true, force: true });
  copyRepo(ws);
  for (const s of task.setup ?? []) {
    fs.mkdirSync(path.dirname(path.join(ws, s.to)), { recursive: true });
    fs.copyFileSync(path.join(EVALS, s.from), path.join(ws, s.to));
  }
  const g = (c: string) => spawnSync(c, { cwd: ws, shell: true, encoding: 'utf8' });
  g('git init -q && git add -A && git -c user.email=eval@local -c user.name=eval commit -qm baseline');
  return ws;
}

function runAgent(task: Task, ws: string): { seconds: number; exit: number; transcript: string; contained: boolean; containDetail: string } {
  const t0 = Date.now();
  if (agent === 'none') return { seconds: 0, exit: 0, transcript: '', contained: true, containDetail: '' };
  if (agent === 'reference') {
    const r = spawnSync('node', [path.join(EVALS, 'reference', 'solve.ts'), task.id, ws], { encoding: 'utf8' });
    return { seconds: Math.round((Date.now() - t0) / 1000), exit: r.status ?? -1, transcript: `${r.stdout}${r.stderr}`, contained: true, containDetail: '' };
  }
  const prompt = `${task.prompt}\n\nWork only inside the current folder. Verify your work by actually running it before you finish.`;
  // jcode runs inside a Windows Job Object (tools/run-in-job.ps1). The wrapper enforces the timeout, then kills
  // every process the agent started (children, grandchildren, orphans) and exits 0 only when the job is proven
  // empty. The spawnSync timeout is a backstop: if it fires, the job handle closes (kill-on-close) but the tree
  // was not proven dead, so the task is treated as unsafe to grade.
  const args = Buffer.from(JSON.stringify(['-p', provider, '-m', model, ...(providerProfile ? ['--provider-profile', providerProfile] : []), 'run', '--no-update', prompt]), 'utf8').toString('base64');
  const timeoutMs = task.timeoutMin * 60_000;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(EVALS, 'tools', 'run-in-job.ps1'),
    '-Command', 'jcode', '-ArgsB64', args, '-TimeoutMs', String(timeoutMs)], {
    cwd: ws, input: '\n', encoding: 'utf8', timeout: timeoutMs + 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  const contained = r.status === 0 && !r.error;
  const containDetail = contained ? '' : `agent process tree not proven dead (run-in-job exit=${r.status ?? 'none'}${r.error ? `, ${r.error.message}` : ''})`;
  return { seconds: Math.round((Date.now() - t0) / 1000), exit: r.status ?? -1, transcript: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n[runner] ${r.error.message}` : ''}`, contained, containDetail };
}

async function grade(task: Task, ws: string) {
  try { return await checks[task.id](ws, REPO); } catch (e) { return { pass: false, detail: `grader error: ${(e as Error).message}` }; }
}

// ---- single-task modes (for Hermes / Copilot / manual runs) ----
if (flag('prepare')) {
  const task = tasks.find((t) => t.id === flag('prepare'))!;
  const ws = prepare(task, path.join(os.tmpdir(), 'agent-evals', 'manual'));
  console.log(`Baseline: ${baseline} (${baselineSha})\nEnvironment: ${envLine}\nSandbox: ${ws}\n\nPrompt:\n${task.prompt}\n\nWhen done: node evals/run.ts --grade ${task.id} "${ws}"`);
  process.exit(0);
}
if (flag('grade')) {
  const task = tasks.find((t) => t.id === flag('grade'))!;
  const ws = argv[argv.indexOf('--grade') + 2];
  const r = await grade(task, ws);
  console.log(`${task.id} ${r.pass ? 'PASS' : 'FAIL'}  ${r.detail}`);
  process.exit(r.pass ? 0 : 1);
}

// ---- batch mode ----
const onlyFlag = flag('only');
const only = onlyFlag ? new Set(onlyFlag.split(',')) : undefined;
const selected = tasks.filter((t) => !only || only.has(t.id));
const runId = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${agent === 'none' ? 'baseline' : agent === 'reference' ? 'reference' : `${provider}-${model}`}`.replace(/[^\w.-]/g, '_');
const root = path.join(os.tmpdir(), 'agent-evals', runId);
const outDir = path.join(EVALS, 'results', runId);
fs.mkdirSync(outDir, { recursive: true });

console.log(`Run ${runId}: ${selected.length} task(s), agent=${agent}${agent === 'none' ? '' : ` ${provider}/${model}`}, baseline=${baseline} (${baselineSha.slice(0, 10)})\n`);
fs.writeFileSync(path.join(outDir, 'baseline.txt'), `${baseline} ${baselineSha}\nenv: ${envLine}\n`);
const results: any[] = [];
for (const task of selected) {
  process.stdout.write(`${task.id} ${task.title.padEnd(42)} `);
  const ws = prepare(task, root);
  const run = runAgent(task, ws);
  // Dependency integrity before grading: never grade against the agent's node_modules. If the agent's
  // process tree was not proven dead, a survivor could still change the sandbox: skip the check and grading.
  const envStatus: { env: string; envDetail: string } = run.contained ? checkAndRestoreEnv(ws) : { env: 'UNSAFE_PROCESS_TREE', envDetail: run.containDetail };
  const g = envStatus.env === 'ENV_RESTORE_FAILED' || envStatus.env === 'UNSAFE_PROCESS_TREE' ? { pass: false, detail: `not graded: ${envStatus.envDetail}` } : await grade(task, ws);
  // A contaminated environment is never counted as a PASS; the grader's verdict (graded on
  // the restored golden tree) is kept alongside as graderPass.
  const pass = g.pass && envStatus.env === 'CLEAN';
  const diff = spawnSync('git diff --stat HEAD', { cwd: ws, shell: true, encoding: 'utf8' }).stdout.trim().split('\n').pop() ?? '';
  fs.writeFileSync(path.join(outDir, `${task.id}.transcript.txt`), run.transcript);
  results.push({ id: task.id, title: task.title, difficulty: task.difficulty, pass, detail: g.detail, seconds: run.seconds, timedOut: run.seconds >= task.timeoutMin * 60 - 5, diff, env: envStatus.env, envDetail: envStatus.envDetail, graderPass: g.pass });
  console.log(`${envStatus.env === 'CLEAN' ? (pass ? 'PASS' : 'FAIL') : `${envStatus.env} (grader: ${g.pass ? 'PASS' : 'FAIL'})`} ${String(run.seconds).padStart(5)}s  ${pass ? '' : g.detail.slice(0, 110)}${envStatus.env === 'CLEAN' ? '' : `\n    ${envStatus.envDetail.slice(0, 300)}`}`);
}

const passed = results.filter((r) => r.pass).length;
const byDiff = ['easy', 'medium', 'hard'].map((d) => { const x = results.filter((r) => r.difficulty === d); return `${d} ${x.filter((r) => r.pass).length}/${x.length}`; }).join(', ');
const minutes = Math.round(results.reduce((a, r) => a + r.seconds, 0) / 60);
const contaminated = results.filter((r) => r.env !== 'CLEAN');
const summary = [
  `# Eval run ${runId}`, '', `Baseline: ${baseline} (${baselineSha})`, '', `Environment: ${envLine}`, '',
  `Score: **${passed}/${results.length}** (${Math.round((100 * passed) / results.length)}%)  |  ${byDiff}  |  ${minutes} min total`, '',
  ...(contaminated.length ? [`Dependency environment: ${contaminated.length} task(s) not CLEAN (${contaminated.map((r) => `${r.id} ${r.env}`).join(', ')}); these never count as PASS. Details in results.json (env, envDetail, graderPass).`, ''] : []),
  '| Task | Title | Level | Result | Time | Changes | Why it failed |', '|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.title} | ${r.difficulty} | ${r.env === 'CLEAN' ? (r.pass ? 'PASS' : 'FAIL') : `${r.env} (grader: ${r.graderPass ? 'PASS' : 'FAIL'})`}${r.timedOut ? ' (timeout)' : ''} | ${r.seconds}s | ${r.diff.replace(/\|/g, '/')} | ${r.pass ? '' : r.detail.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 160)} |`),
].join('\n');
fs.writeFileSync(path.join(outDir, 'summary.md'), summary + '\n');
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const hist = path.join(EVALS, 'results', 'history.csv');
if (!fs.existsSync(hist)) fs.writeFileSync(hist, 'run,agent,passed,total,easy_medium_hard,minutes\n');
fs.appendFileSync(hist, `${runId},${agent === 'none' ? 'baseline' : `${provider}/${model}`},${passed},${results.length},"${byDiff}",${minutes}\n`);
console.log(`\nScore ${passed}/${results.length}  (${byDiff})  ${minutes} min\nReport: ${path.join(outDir, 'summary.md')}\nSandboxes kept for review: ${root}`);
