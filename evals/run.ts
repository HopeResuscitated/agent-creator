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
import { spawn, spawnSync } from 'node:child_process';
import { checks } from './checks.ts';

type Task = { id: string; title: string; difficulty: string; category: string; timeoutMin: number; prompt: string; setup?: { from: string; to: string }[] };

const EVALS = import.meta.dirname;
const REPO = path.dirname(EVALS);
const tasks: Task[] = JSON.parse(fs.readFileSync(path.join(EVALS, 'tasks.json'), 'utf8'));
const SKIP = new Set(['node_modules', '.git', 'evals', 'dist', '.jswarm', 'docs']);
const COPY_EXCLUDE = new Set(['dist', 'node_modules']); // skipped at any depth when copying the repo

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const agent = flag('agent', 'jcode')!;
const provider = flag('provider', 'ollama')!;
const model = flag('model', 'hermes-local-32k')!;

function copyRepo(dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(REPO)) {
    if (SKIP.has(e)) continue;
    fs.cpSync(path.join(REPO, e), path.join(dest, e), { recursive: true, filter: (s) => !path.relative(REPO, s).split(path.sep).some((seg) => COPY_EXCLUDE.has(seg)) });
  }
  fs.mkdirSync(path.join(dest, 'docs'), { recursive: true });
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dest, 'node_modules'), 'junction');
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

async function runAgent(task: Task, ws: string): Promise<{ seconds: number; exit: number; transcript: string }> {
  const t0 = Date.now();
  if (agent === 'none') return { seconds: 0, exit: 0, transcript: '' };
  if (agent === 'reference') {
    const r = spawnSync('node', [path.join(EVALS, 'reference', 'solve.ts'), task.id, ws], { encoding: 'utf8' });
    return { seconds: Math.round((Date.now() - t0) / 1000), exit: r.status ?? -1, transcript: `${r.stdout}${r.stderr}` };
  }
  const prompt = `${task.prompt}\n\nWork only inside the current folder. Verify your work by actually running it before you finish.`;
  const startedUtc = new Date().toISOString();
  const child = spawn('jcode', ['-p', provider, '-m', model, 'run', '--no-update', prompt], { cwd: ws, windowsHide: true });
  let out = '', err = '', note = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
  child.stdin.on('error', () => {}).end('\n'); // answers jcode's first-launch "Approve sources" prompt
  const exit = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      note += `\n[runner] timeout after ${task.timeoutMin} min, killing process tree`;
      killTree(child.pid);
    }, task.timeoutMin * 60_000);
    child.on('error', (e) => { note += `\n[runner] ${e.message}`; clearTimeout(timer); resolve(-1); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code ?? -1); });
  });
  const swept = sweepAgentProcesses(ws, child.pid, startedUtc);
  if (swept) note += `\n[runner] ${swept}`;
  return { seconds: Math.round((Date.now() - t0) / 1000), exit, transcript: `${out}\n${err}${note}` };
}

// jcode spawns helper processes (daemon/agents) that outlive `jcode run`. Kill the direct child's tree first,
// then anything whose CommandLine mentions the sandbox, is descended from the child, or is a jcode.exe started
// during this task. Otherwise stragglers hold the sandbox open and hit the next task.
function killTree(pid?: number) {
  if (pid) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
}
function sweepAgentProcesses(ws: string, pid: number | undefined, sinceUtc: string): string {
  killTree(pid);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(EVALS, 'tools', 'kill-sandbox-procs.ps1'),
    '-Path', ws, '-RootPid', String(pid ?? 0), '-Name', 'jcode.exe', '-SinceUtc', sinceUtc], { encoding: 'utf8', windowsHide: true });
  const lines = (r.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
  return lines.some((l) => l.startsWith('killed') || l.startsWith('FAILED')) ? `swept stray processes: ${lines.join('; ')}` : '';
}

async function grade(task: Task, ws: string) {
  try { return await checks[task.id](ws, REPO); } catch (e) { return { pass: false, detail: `grader error: ${(e as Error).message}` }; }
}

// ---- single-task modes (for Hermes / Copilot / manual runs) ----
if (flag('prepare')) {
  const task = tasks.find((t) => t.id === flag('prepare'))!;
  const ws = prepare(task, path.join(os.tmpdir(), 'agent-evals', 'manual'));
  console.log(`Sandbox: ${ws}\n\nPrompt:\n${task.prompt}\n\nWhen done: node evals/run.ts --grade ${task.id} "${ws}"`);
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

console.log(`Run ${runId}: ${selected.length} task(s), agent=${agent}${agent === 'none' ? '' : ` ${provider}/${model}`}\n`);
const results: any[] = [];
for (const task of selected) {
  process.stdout.write(`${task.id} ${task.title.padEnd(42)} `);
  const ws = prepare(task, root);
  const run = await runAgent(task, ws);
  const g = await grade(task, ws);
  const diff = spawnSync('git diff --stat HEAD', { cwd: ws, shell: true, encoding: 'utf8' }).stdout.trim().split('\n').pop() ?? '';
  fs.writeFileSync(path.join(outDir, `${task.id}.transcript.txt`), run.transcript);
  results.push({ id: task.id, title: task.title, difficulty: task.difficulty, pass: g.pass, detail: g.detail, seconds: run.seconds, timedOut: run.seconds >= task.timeoutMin * 60 - 5, diff });
  console.log(`${g.pass ? 'PASS' : 'FAIL'} ${String(run.seconds).padStart(5)}s  ${g.pass ? '' : g.detail.slice(0, 110)}`);
}

const passed = results.filter((r) => r.pass).length;
const byDiff = ['easy', 'medium', 'hard'].map((d) => { const x = results.filter((r) => r.difficulty === d); return `${d} ${x.filter((r) => r.pass).length}/${x.length}`; }).join(', ');
const minutes = Math.round(results.reduce((a, r) => a + r.seconds, 0) / 60);
const summary = [
  `# Eval run ${runId}`, '',
  `Score: **${passed}/${results.length}** (${Math.round((100 * passed) / results.length)}%)  |  ${byDiff}  |  ${minutes} min total`, '',
  '| Task | Title | Level | Result | Time | Changes | Why it failed |', '|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.title} | ${r.difficulty} | ${r.pass ? 'PASS' : 'FAIL'}${r.timedOut ? ' (timeout)' : ''} | ${r.seconds}s | ${r.diff.replace(/\|/g, '/')} | ${r.pass ? '' : r.detail.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 160)} |`),
].join('\n');
fs.writeFileSync(path.join(outDir, 'summary.md'), summary + '\n');
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const hist = path.join(EVALS, 'results', 'history.csv');
if (!fs.existsSync(hist)) fs.writeFileSync(hist, 'run,agent,passed,total,easy_medium_hard,minutes\n');
fs.appendFileSync(hist, `${runId},${agent === 'none' ? 'baseline' : `${provider}/${model}`},${passed},${results.length},"${byDiff}",${minutes}\n`);
console.log(`\nScore ${passed}/${results.length}  (${byDiff})  ${minutes} min\nReport: ${path.join(outDir, 'summary.md')}\nSandboxes kept for review: ${root}`);
