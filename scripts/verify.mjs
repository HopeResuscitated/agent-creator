#!/usr/bin/env node
// Tier-1 verify gate — implements data/spec-verify-gate.md (+ roadmap Step 3).
//
//   npm run verify            all steps; full output -> docs/verify.log; console = PASS/FAIL per step
//   npm run lint:all          lint every workspace (reports known debt; NOT part of the gate)
//
// Deterministic and offline: no Ollama, jcode, network or live browser. Every step runs
// even after an earlier failure so the log shows the whole picture; exit code is 0 only
// if every step passed. Tools are invoked from the repo's own node_modules via
// process.execPath (no shell, no npx resolution), so the gate cannot pick up a
// different tsc/eslint than the one pinned in package.json.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const AGENT = path.join(ROOT, 'packages', 'agent');
const TEST_DIR = path.join(AGENT, 'test');
const LOG = path.join(ROOT, 'docs', 'verify.log');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const ESLINT = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
// Spec: "One integration test: submit a task through the orchestrator and assert the
// real file side effects happened." Its absence is a gate failure, not a skip.
const REQUIRED_TESTS = ['orchestrator.test.ts'];
// Files package.json promises (main + ./orchestrator + ./tools exports).
const DIST_REQUIRED = ['dist/index.js', 'dist/orchestrator.js', 'dist/tools/index.js'];
const STEP_TIMEOUT_MS = 300_000;

const run = (args, extra = {}) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 64 << 20, windowsHide: true, ...extra });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return {
    ok: r.status === 0 && !timedOut,
    out: `$ node ${args.map((a) => path.relative(ROOT, a) || a).join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n[verify] ${timedOut ? 'TIMEOUT' : 'spawn error'}: ${r.error.message}` : ''}\n[verify] exit=${r.status} ${Date.now() - t0}ms`,
  };
};

if (process.argv.includes('--lint-all')) {
  const r = spawnSync(process.execPath, [ESLINT, '.', '--max-warnings=0'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, LINT_SCOPE: 'all' } });
  process.exit(r.status ?? 1);
}

const steps = [
  ['typecheck', () => run([TSC, '--noEmit', '-p', AGENT])],

  ['build', () => {
    // Clean first: a stale dist from an older layout must not satisfy the layout check.
    const dist = path.join(AGENT, 'dist');
    fs.rmSync(dist, { recursive: true, force: true });
    return run([TSC, '-p', AGENT]);
  }],

  ['dist-layout', () => {
    const lines = DIST_REQUIRED.map((f) => `${fs.existsSync(path.join(AGENT, f)) ? 'present' : 'MISSING'}  packages/agent/${f}`);
    const missing = lines.filter((l) => l.startsWith('MISSING'));
    const emitted = fs.existsSync(path.join(AGENT, 'dist'))
      ? fs.readdirSync(path.join(AGENT, 'dist'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => `  emitted: dist/${String(f).replace(/\\/g, '/')}`)
      : ['  emitted: (no dist directory)'];
    let imp = { ok: false, out: '[verify] import skipped: dist/index.js missing' };
    if (!missing.length) imp = run(['--input-type=module', '-e', "await import('./packages/agent/dist/index.js'); console.log('import ok')"]);
    return { ok: !missing.length && imp.ok, out: [...lines, ...emitted, imp.out].join('\n') };
  }],

  ['lint', () => run([ESLINT, '.', '--max-warnings=0'])],

  ['test', () => {
    const files = fs.existsSync(TEST_DIR) ? fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts')).sort() : [];
    const absent = REQUIRED_TESTS.filter((f) => !files.includes(f));
    const header = `test files (${files.length}): ${files.join(', ') || '(none)'}` + (absent.length ? `\nREQUIRED TEST MISSING: ${absent.join(', ')}` : '');
    if (!files.length) return { ok: false, out: `${header}\n[verify] no test files found` };
    const r = run(['--test', ...files.map((f) => path.join(TEST_DIR, f))]);
    return { ok: r.ok && !absent.length, out: `${header}\n${r.out}` };
  }],
];

fs.mkdirSync(path.dirname(LOG), { recursive: true });
const started = new Date().toISOString();
const results = [];
let log = `verify gate — ${started}\nnode ${process.version}  root ${ROOT}\n`;
for (const [name, fn] of steps) {
  let r;
  try { r = fn(); } catch (e) { r = { ok: false, out: `[verify] step threw: ${e?.stack ?? e}` }; }
  results.push([name, r.ok]);
  log += `\n===== ${name}: ${r.ok ? 'PASS' : 'FAIL'} =====\n${r.out.trimEnd()}\n`;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name}`);
}
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
const verdict = failed.length ? `VERIFY FAIL (${failed.join(', ')})` : 'VERIFY PASS';
log += `\n===== ${verdict} =====\n`;
fs.writeFileSync(LOG, log);
console.log(`${verdict}  — full output: ${path.relative(ROOT, LOG)}`);
process.exit(failed.length ? 1 : 0);
