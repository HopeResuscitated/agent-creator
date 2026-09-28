// Pass/fail checks for each eval task. Each check runs inside the task's sandbox copy.
// Return { pass: boolean, detail: string }.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HIDDEN = path.join(import.meta.dirname, 'hidden');

function sh(cwd: string, cmd: string, timeoutMs = 180_000) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const read = (ws: string, p: string) => { try { return fs.readFileSync(path.join(ws, p), 'utf8'); } catch { return null; } };
const exists = (ws: string, p: string) => fs.existsSync(path.join(ws, p));
const tail = (s: string, n = 400) => {
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const key = lines.filter((l) => /^(not ok|error|Error|AssertionError|TypeError|SyntaxError|ReferenceError|✖|expected|actual|\+|-\s|TS\d+|.*error TS)/.test(l) || /Cannot find|ERR_|failed|Expected|actual:/.test(l));
  return (key.length ? key.slice(0, 6) : lines.slice(-6)).join(' / ').slice(0, n);
};

/** Copy a hidden test in, run it, then remove it. */
function hidden(ws: string, name: string, destDir: string) {
  const dest = path.join(ws, destDir, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(HIDDEN, name), dest);
  const r = sh(ws, `node --test "${path.join(destDir, name)}"`);
  fs.rmSync(dest, { force: true });
  return r;
}
const tests = (ws: string, file: string) => sh(ws, `node --test "${file}"`);
const tsc = (ws: string) => sh(ws, 'npx tsc --noEmit -p packages/agent');

type Result = { pass: boolean; detail: string };
const all = (...parts: Array<[boolean, string]>): Result => {
  const failed = parts.filter(([ok]) => !ok).map(([, d]) => d);
  return { pass: failed.length === 0, detail: failed.length ? failed.join(' | ') : 'all checks passed' };
};
/** Tools tests + typecheck must stay green for anything touching packages/agent. */
function regression(ws: string): Array<[boolean, string]> {
  const t = tests(ws, 'packages/agent/test/tools.test.ts');
  const c = tsc(ws);
  return [
    [t.code === 0, `existing tools tests broken: ${tail(t.out, 200)}`],
    [c.code === 0, `typecheck broken: ${tail(c.out, 200)}`],
  ];
}

export const checks: Record<string, (ws: string, original: string) => Result | Promise<Result>> = {
  T01: (ws) => {
    const c = read(ws, 'notes/hello.txt');
    return all([c !== null, 'notes/hello.txt missing'], [c?.trim() === 'hello agent', `content was ${JSON.stringify(c)}`]);
  },

  T02: (ws) => {
    const orig = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/retry-config.ts'), 'utf8');
    const now = read(ws, 'packages/shared/utils/retry-config.ts') ?? '';
    const want = orig.replace('MAX_RETRIES = 2', 'MAX_RETRIES = 5');
    const norm = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
    return all([norm(now) === norm(want), 'file differs from the exact one-line change']);
  },

  T03: (ws) => {
    const a = read(ws, 'answer.txt')?.trim().replace(/[`'"]/g, '');
    return all([a === 'resolveInRoot', `answer was ${JSON.stringify(a)}`]);
  },

  T04: (ws) => {
    const r = tests(ws, 'packages/agent/test/tools.test.ts');
    const m = r.out.match(/ℹ pass (\d+)/) ?? r.out.match(/# pass (\d+)/);
    const actual = m?.[1];
    const a = read(ws, 'answer.txt')?.trim();
    return all([!!actual, 'could not determine real pass count'], [a === actual, `answer ${JSON.stringify(a)} vs real ${actual}`]);
  },

  T05: (ws) => {
    const origTest = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/chunk.test.ts'), 'utf8');
    const t = read(ws, 'packages/shared/test/chunk.test.ts') ?? '';
    const own = tests(ws, 'packages/shared/test/chunk.test.ts');
    const h = hidden(ws, 'chunk.hidden.test.ts', 'packages/shared/test');
    return all(
      [t.replace(/\r\n/g, '\n') === origTest.replace(/\r\n/g, '\n'), 'test file was modified'],
      [own.code === 0, `provided test still fails: ${tail(own.out, 200)}`],
      [h.code === 0, `hidden edge cases fail: ${tail(h.out, 200)}`],
    );
  },

  T06: (ws) => {
    const own = exists(ws, 'packages/shared/test/slugify.test.ts') ? tests(ws, 'packages/shared/test/slugify.test.ts') : { code: 1, out: 'no test file' };
    const h = hidden(ws, 'slugify.hidden.test.ts', 'packages/shared/test');
    return all([own.code === 0, `agent's own tests: ${tail(own.out, 150)}`], [h.code === 0, `hidden tests: ${tail(h.out, 250)}`]);
  },

  T07: (ws) => {
    const own = exists(ws, 'packages/shared/test/duration.test.ts') ? tests(ws, 'packages/shared/test/duration.test.ts') : { code: 1, out: 'no test file' };
    const h = hidden(ws, 'duration.hidden.test.ts', 'packages/shared/test');
    return all([own.code === 0, `agent's own tests: ${tail(own.out, 150)}`], [h.code === 0, `hidden tests: ${tail(h.out, 250)}`]);
  },

  T08: (ws) => {
    const h = hidden(ws, 'file-exists.hidden.test.ts', 'packages/agent/test');
    return all([h.code === 0, `hidden tests: ${tail(h.out, 250)}`], ...regression(ws));
  },

  T09: (ws) => {
    const h = hidden(ws, 'timing.hidden.test.ts', 'packages/agent/test');
    return all([h.code === 0, `hidden tests: ${tail(h.out, 250)}`], ...regression(ws));
  },

  T10: async (ws) => {
    const tmpBefore = new Set(fs.readdirSync(process.env.TEMP ?? '/tmp'));
    fs.rmSync(path.join(ws, 'docs/BENCH.md'), { force: true });
    const r = sh(ws, 'node packages/agent/scripts/bench-tools.ts', 300_000);
    const md = read(ws, 'docs/BENCH.md') ?? '';
    const toolsNamed = ['read_file', 'write_file', 'edit_file', 'list_dir', 'run_command', 'grep'].filter((t) => md.includes(t));
    const leaked = fs.readdirSync(process.env.TEMP ?? '/tmp').filter((f) => !tmpBefore.has(f));
    return all(
      [r.code === 0, `script failed: ${tail(r.out, 200)}`],
      [md.includes('|'), 'docs/BENCH.md missing or not a table'],
      [toolsNamed.length === 6, `BENCH.md lists ${toolsNamed.length}/6 tools`],
      [leaked.length === 0, `temp dirs left behind: ${leaked.join(', ')}`],
      ...regression(ws),
    );
  },

  T11: (ws) => {
    const f = 'packages/agent/test/grep.test.ts';
    if (!exists(ws, f)) return { pass: false, detail: 'grep.test.ts missing' };
    const r = tests(ws, f);
    const count = Number(r.out.match(/ℹ tests (\d+)/)?.[1] ?? 0);
    const src = read(ws, f) ?? '';
    // Mutation check: tests must FAIL when grep is broken.
    const searchPath = path.join(ws, 'packages/agent/tools/search.ts');
    const orig = fs.readFileSync(searchPath, 'utf8');
    const mutant = orig.replace(/export async function grep\s*\(([^)]*)\)[^{]*\{/, (m) => `${m}\n  return { callId: 'x', tool: 'grep', success: true, data: [] } as any;`);
    let mutationCaught = false;
    if (mutant !== orig) {
      fs.writeFileSync(searchPath, mutant);
      mutationCaught = tests(ws, f).code !== 0;
      fs.writeFileSync(searchPath, orig);
    }
    return all(
      [r.code === 0, `tests fail: ${tail(r.out, 200)}`],
      [count >= 4, `only ${count} tests`],
      [/escape|outside|\.\./i.test(src), 'no escape-path test'],
      [mutant !== orig, 'grader could not mutate grep (signature changed?)'],
      [mutationCaught, 'tests still pass when grep is broken (they do not really test it)'],
    );
  },

  T12: (ws) => {
    const pkg = JSON.parse(read(ws, 'package.json') ?? '{}');
    if (!pkg.scripts?.verify) return { pass: false, detail: 'no verify script' };
    fs.rmSync(path.join(ws, 'docs/verify.log'), { force: true });
    const good = sh(ws, 'npm run verify', 400_000);
    const log = read(ws, 'docs/verify.log');
    // Break a test on purpose: verify must fail.
    const bad = path.join(ws, 'packages/agent/test/zz-eval-broken.test.ts');
    fs.writeFileSync(bad, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('broken', () => assert.equal(1, 2));\n");
    const broken = sh(ws, 'npm run verify', 400_000);
    fs.rmSync(bad, { force: true });
    return all(
      [good.code === 0, `verify fails on a healthy repo: ${tail(good.out, 250)}`],
      [!!log && log.length > 20, 'docs/verify.log missing or empty'],
      [broken.code !== 0, 'verify still passes with a failing test'],
    );
  },

  T13: (ws) => {
    const h = hidden(ws, 'orchestrator.hidden.test.ts', 'packages/agent/test');
    const types = read(ws, 'packages/agent/orchestrator.ts') ?? '';
    return all(
      [h.code === 0, `hidden tests: ${tail(h.out, 300)}`],
      [!/interface\s+(Task|TaskStep)\b/.test(types), 'created parallel Task/TaskStep types'],
      ...regression(ws),
    );
  },

  T14: (ws) => {
    fs.rmSync(path.join(ws, 'packages/agent/dist'), { recursive: true, force: true });
    const b = sh(ws, 'npx tsc -p packages/agent');
    const files = ['dist/index.js', 'dist/orchestrator.js', 'dist/tools/index.js'].map((f) => `packages/agent/${f}`);
    const missing = files.filter((f) => !exists(ws, f));
    const imp = sh(ws, `node -e "import('./packages/agent/dist/index.js').then(()=>console.log('ok'))"`);
    const t = tests(ws, 'packages/agent/test/tools.test.ts');
    return all(
      [b.code === 0, `build errors: ${tail(b.out, 200)}`],
      [missing.length === 0, `missing: ${missing.join(', ')}`],
      [imp.code === 0 && imp.out.includes('ok'), `import failed: ${tail(imp.out, 200)}`],
      [t.code === 0, 'tools tests broken'],
    );
  },

  T15: (ws) => {
    const h = hidden(ws, 'sandbox.hidden.test.ts', 'packages/agent/test');
    const src = read(ws, 'packages/agent/test/tools.test.ts') ?? '';
    return all(
      [h.code === 0, `hidden escape tests: ${tail(h.out, 300)}`],
      [/symlink|junction/i.test(src), 'no escape test added to tools.test.ts'],
      ...regression(ws),
    );
  },

  T16: (ws) => {
    const md = read(ws, 'docs/PLAN-donation-page.md');
    if (!md) return { pass: false, detail: 'docs/PLAN-donation-page.md missing' };
    const rows = md.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l));
    const cells = rows.map((r) => r.split('|').map((c) => c.trim()));
    const doneChecks = cells.map((c) => c[5] ?? '');
    const vague = doneChecks.filter((d) => d.length < 8 || /^(tbd|todo|n\/a|-|<.*>)$/i.test(d));
    return all(
      [rows.length >= 4, `only ${rows.length} stage rows`],
      [vague.length === 0, `vague/empty done-checks: ${JSON.stringify(vague)}`],
      [/vercel/i.test(md), 'no Vercel deploy stage'],
      [/github/i.test(md), 'no GitHub mention'],
      [!/<project name>/.test(md), 'template placeholders left in'],
    );
  },

  T17: (ws) => {
    const want = [
      'id,date,platform,status,likes',
      'p1,2026-09-18,facebook,published,17',
      'p2,2026-09-19,instagram,draft,0',
      'p3,2026-09-20,instagram,published,42',
      'p6,2026-09-21,facebook,failed,3',
      'p4,2026-09-22,instagram,published,0',
      'p5,2026-09-25,facebook,scheduled,0',
    ].join('\n');
    const got = (read(ws, 'docs/posts.csv') ?? '').replace(/\r\n/g, '\n').trim();
    return all([got === want, `csv mismatch. got:\n${got.slice(0, 300)}`]);
  },

  T18: (ws) => {
    const s = read(ws, 'docs/STATUS.md');
    if (!s) return { pass: false, detail: 'docs/STATUS.md missing' };
    const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const want = ['DONE', 'TODO', 'TODO', 'TODO', 'TODO'];
    const got = lines.map((l) => (/\bDONE\b/.test(l) ? 'DONE' : /\bTODO\b/.test(l) ? 'TODO' : '?'));
    return all(
      [lines.length === 5, `${lines.length} lines, expected 5`],
      [JSON.stringify(got) === JSON.stringify(want), `statuses ${got.join(',')} (want DONE,TODO,TODO,TODO,TODO)`],
      [lines.every((l, i) => l.includes(`Step ${i + 1}`)), 'lines not in Step 1..5 order'],
    );
  },
};
