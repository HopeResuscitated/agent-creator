// Reference solutions. These prove every eval task can be passed and that the graders work.
// NEVER copied into a sandbox the agent sees.   Usage: node evals/reference/solve.ts <taskId> <sandboxDir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [id, ws] = process.argv.slice(2);
const P = (p: string) => path.join(ws, p);
const w = (p: string, s: string) => { fs.mkdirSync(path.dirname(P(p)), { recursive: true }); fs.writeFileSync(P(p), s); };
const r = (p: string) => fs.readFileSync(P(p), 'utf8');
const sub = (p: string, a: string | RegExp, b: string) => { const s = r(p); const n = s.replace(a, b); if (n === s) throw new Error(`no change in ${p}`); fs.writeFileSync(P(p), n); };

const S: Record<string, () => void> = {
  T01: () => w('notes/hello.txt', 'hello agent\n'),
  T02: () => sub('packages/shared/utils/retry-config.ts', 'MAX_RETRIES = 2', 'MAX_RETRIES = 5'),
  T03: () => w('answer.txt', 'resolveInRoot\n'),
  T04: () => {
    const o = spawnSync('node --test packages/agent/test/tools.test.ts', { cwd: ws, shell: true, encoding: 'utf8' });
    const passLine = (o.stdout + o.stderr).match(/ℹ pass (\d+)/);
    if (!passLine) throw new Error(`T04: no "ℹ pass N" line in node --test output (exit ${o.status})`);
    w('answer.txt', `${passLine[1]}\n`);
  },
  T05: () => sub('packages/shared/utils/chunk.ts', 'i < items.length - size', 'i < items.length'),
  T06: () => {
    w('packages/shared/utils/slugify.ts', `export function slugify(input: string): string {
  let s = input.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 60).replace(/-+$/, '');
}
`);
    w('packages/shared/test/slugify.test.ts', `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../utils/slugify.ts';
test('basic', () => assert.equal(slugify('Hello World'), 'hello-world'));
test('accents', () => assert.equal(slugify('Café'), 'cafe'));
`);
  },
  T07: () => {
    w('packages/shared/utils/duration.ts', `const UNIT: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
export function parseDuration(s: string): number {
  const str = s.trim().toLowerCase();
  if (!/^(\\d+\\s*[dhms]\\s*)+$/.test(str)) throw new Error(\`invalid duration: \${s}\`);
  let total = 0;
  for (const m of str.matchAll(/(\\d+)\\s*([dhms])/g)) total += Number(m[1]) * UNIT[m[2]];
  return total;
}
`);
    w('packages/shared/test/duration.test.ts', `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../utils/duration.ts';
test('1h30m', () => assert.equal(parseDuration('1h30m'), 5400));
test('bad', () => assert.throws(() => parseDuration('10x')));
`);
  },
  T08: () => {
    fs.appendFileSync(P('packages/agent/tools/fs.ts'), `
export async function fileExists(args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
  const t = Date.now();
  try {
    const abs = resolveInRoot(rootOf(options), str(args, 'path'));
    try {
      const st = await fs.stat(abs);
      return ok('file_exists', { exists: true, type: st.isDirectory() ? 'dir' : 'file' }, t, { path: abs });
    } catch {
      return ok('file_exists', { exists: false, type: null }, t, { path: abs });
    }
  } catch (e) {
    return fail('file_exists', e, t);
  }
}
`);
    sub('packages/agent/tools/index.ts', "import { editFile, listDir, readFile, writeFile } from './fs.ts';", "import { editFile, fileExists, listDir, readFile, writeFile } from './fs.ts';");
    sub('packages/agent/tools/index.ts', /\n\];\n/, `
  {
    name: 'file_exists',
    description: 'Check whether a path exists inside the repo root and whether it is a file or dir.',
    parameters: [{ name: 'path', type: 'string', required: true }],
    implementation: fileExists,
  },
];
`);
  },
  T09: () => {
    sub('packages/agent/orchestrator.ts', "import { executeTool } from './tools/index.ts';", "import { executeTool } from './tools/index.ts';\nimport fs from 'node:fs/promises';\nimport path from 'node:path';");
    sub('packages/agent/orchestrator.ts', /  \): Promise<ToolResult> \{\n    return executeTool\(toolName, args, \{/, `  ): Promise<ToolResult> {
    const started = Date.now();
    const result = await executeTool(toolName, args, {`);
    sub('packages/agent/orchestrator.ts', /      \},\n    \}\);\n  \}/, `      },
    });
    if (context?.workspace) {
      const line = [new Date().toISOString(), toolName, context.taskId ?? '-', Date.now() - started, result.success ? 'ok' : 'error'].join(' | ');
      const dir = path.join(context.workspace, 'docs');
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, 'tool-timing.log'), line + '\\n', 'utf8');
    }
    return result;
  }`);
  },
  T10: () => w('packages/agent/scripts/bench-tools.ts', `import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeTool } from '../tools/index.ts';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-'));
const opts = { context: { workspace: dir, timestamp: new Date().toISOString() } };
await fs.writeFile(path.join(dir, 'a.txt'), 'hello bench\\n');
const cases: Array<[string, () => Record<string, unknown>]> = [
  ['read_file', () => ({ path: 'a.txt' })],
  ['write_file', () => ({ path: 'b.txt', content: 'x' })],
  ['edit_file', () => { return { path: 'b.txt', old_string: 'x', new_string: 'x', replace_all: true }; }],
  ['list_dir', () => ({ path: '.' })],
  ['run_command', () => ({ command: 'node -e "0"' })],
  ['grep', () => ({ pattern: 'hello' })],
];
const rows: string[] = [];
try {
  for (const [tool, args] of cases) {
    let total = 0;
    for (let i = 0; i < 5; i++) { const t = performance.now(); await executeTool(tool, args(), opts); total += performance.now() - t; }
    rows.push(\`| \${tool} | \${(total / 5).toFixed(2)} |\`);
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
const md = ['| Tool | Avg ms (5 runs) |', '|---|---|', ...rows].join('\\n');
console.log(md);
await fs.mkdir('docs', { recursive: true });
await fs.writeFile('docs/BENCH.md', md + '\\n');
`),
  T11: () => w('packages/agent/test/grep.test.ts', `import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeTool } from '../tools/index.ts';
let root = ''; let opts: any;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-'));
  opts = { context: { workspace: root, timestamp: new Date().toISOString() } };
  await fs.writeFile(path.join(root, 'a.txt'), 'alpha\\nbeta.gamma\\n');
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });
test('literal match', async () => {
  const r = await executeTool('grep', { pattern: 'beta.gamma', literal: true }, opts);
  assert.equal(r.success, true); assert.equal((r.data as any[]).length, 1);
});
test('regex match', async () => {
  const r = await executeTool('grep', { pattern: '^al.*a$' }, opts);
  assert.equal(r.success, true); assert.equal((r.data as any[])[0].line, 1);
});
test('no matches', async () => {
  const r = await executeTool('grep', { pattern: 'zzz' }, opts);
  assert.equal(r.success, true); assert.deepEqual(r.data, []);
});
test('escape path refused', async () => {
  const r = await executeTool('grep', { pattern: 'x', path: '..' }, opts);
  assert.equal(r.success, false);
});
`),
  T12: () => {
    w('eslint.config.js', `export default [{ files: ['**/*.js', '**/*.mjs'], ignores: ['**/dist/**', '**/node_modules/**'], rules: {} }];\n`);
    w('scripts/verify.mjs', `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const steps = [
  ['typecheck', 'npx tsc --noEmit -p packages/agent'],
  ['lint', 'npx eslint . --max-warnings=0'],
  ['test', 'node --test "packages/agent/test/*.test.ts"'],
];
let log = ''; let failed = false;
for (const [name, cmd] of steps) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  log += \`== \${name}: \${cmd} -> exit \${r.status}\\n\${r.stdout}\${r.stderr}\\n\`;
  if (r.status !== 0) { failed = true; break; }
}
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/verify.log', log + (failed ? 'VERIFY FAILED\\n' : 'VERIFY PASSED\\n'));
console.log(failed ? 'VERIFY FAILED (see docs/verify.log)' : 'VERIFY PASSED');
process.exit(failed ? 1 : 0);
`);
    const pkg = JSON.parse(r('package.json')); pkg.scripts.verify = 'node scripts/verify.mjs'; w('package.json', JSON.stringify(pkg, null, 2) + '\n');
  },
  T13: () => {
    sub('packages/agent/orchestrator.ts', "import type { Task, ToolResult } from '@agent-creator/protocol';", "import type { Task, TaskStep, ToolResult } from '@agent-creator/protocol';\n\nexport type Planner = (task: Task) => Promise<Array<{ title: string; tool: string; args: Record<string, unknown> }>>;");
    sub('packages/agent/orchestrator.ts', /\n  \/\*\*\n   \* Execute a tool call\./, `
  async runTask(objective: string, workspace: string, planner: Planner): Promise<Task> {
    const task = this.createTask(objective);
    const touch = () => { task.updatedAt = new Date().toISOString(); };
    task.status = 'running'; touch();
    let plan;
    try { plan = await planner(task); } catch (e) { task.status = 'failed'; touch(); return task; }
    task.steps = plan.map((p, i): TaskStep => ({ id: \`\${task.id}_step_\${i + 1}\`, title: p.title, status: 'pending' }));
    for (let i = 0; i < plan.length; i++) {
      const step = task.steps[i];
      step.status = 'active'; step.startedAt = new Date().toISOString();
      const res = await this.executeTool(plan[i].tool, plan[i].args, { workspace, taskId: task.id });
      step.completedAt = new Date().toISOString();
      if (res.success) { step.status = 'completed'; step.result = res.data; }
      else { step.status = 'failed'; step.error = res.error ?? 'unknown error'; task.status = 'failed'; touch(); return task; }
      touch();
    }
    task.status = 'completed'; touch();
    return task;
  }

  /**
   * Execute a tool call.`);
  },
  T14: () => {
    const tc = JSON.parse(r('packages/agent/tsconfig.json'));
    tc.compilerOptions.rootDir = '.';
    tc.compilerOptions.paths = { '@agent-creator/protocol': ['../protocol/types.d.ts'] };
    w('packages/agent/tsconfig.json', JSON.stringify(tc, null, 2) + '\n');
  },
  T15: () => {
    sub('packages/agent/tools/sandbox.ts', "import path from 'node:path';", "import path from 'node:path';\nimport fs from 'node:fs';\n\n/** Real location of p, following symlinks/junctions of the deepest existing ancestor. */\nfunction realOf(p: string): string {\n  let cur = p;\n  const rest: string[] = [];\n  while (!fs.existsSync(cur)) {\n    const parent = path.dirname(cur);\n    if (parent === cur) break;\n    rest.unshift(path.basename(cur));\n    cur = parent;\n  }\n  return path.join(fs.realpathSync.native(cur), ...rest);\n}");
    sub('packages/agent/tools/sandbox.ts', /    throw new Error\(`path escapes repo root: \$\{p\}`\);\n  \}\n  return abs;/, "    throw new Error(`path escapes repo root: ${p}`);\n  }\n  const realRel = path.relative(realOf(root), realOf(abs));\n  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {\n    throw new Error(`path escapes repo root (via link): ${p}`);\n  }\n  return abs;");
    fs.appendFileSync(P('packages/agent/test/tools.test.ts'), `
test('sandbox refuses junction/symlink escape', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
  await fs.writeFile(path.join(outside, 's.txt'), 'secret');
  await fs.symlink(outside, path.join(root, 'lnk'), 'junction');
  const r = await executeTool('read_file', { path: 'lnk/s.txt' }, opts);
  assert.equal(r.success, false);
  await fs.unlink(path.join(root, 'lnk')).catch(() => fs.rm(path.join(root, 'lnk'), { force: true }));
  await fs.rm(outside, { recursive: true, force: true });
});
`);
  },
  T16: () => w('docs/PLAN-donation-page.md', `# PLAN: Hope Resuscitated donation page

Repo: github.com/HopeResuscitated/donate
Live target: https://donate-hope.vercel.app

| # | Stage | Files touched | Who (local JCode / Hermes / me) | Done-check (exact command or test) | Status |
|---|-------|---------------|----------------------------------|------------------------------------|--------|
| 1 | Scaffold Vite + TS | package.json, index.html, src/main.ts | local JCode | npm run build exits 0 and dist/index.html exists | |
| 2 | Page content + donate button | src/main.ts, src/style.css | Hermes | npm run build exits 0; npx vite preview shows the donate button linking to the donation URL | |
| 3 | Mobile + accessibility | src/style.css | local JCode | Lighthouse accessibility score >= 90 on mobile (npx lighthouse http://localhost:4173) | |
| 4 | Publish to GitHub | .gitignore | me | git push origin main succeeds and the repo shows the commit on github.com | |
| 5 | Deploy on Vercel | vercel.json | Hermes | curl -I https://donate-hope.vercel.app returns HTTP 200 | |

## Risks / open questions
- Payment provider choice.

## Lessons (fill in at the end, then save to a skill)
-
`),
  T17: () => {
    let posts: unknown;
    try { posts = JSON.parse(r('data/posts-export.json')); } catch (e) { throw new Error(`T17: data/posts-export.json is not valid JSON: ${(e as Error).message}`); }
    if (!Array.isArray(posts)) throw new Error('T17: data/posts-export.json must be a JSON array of posts');
    const rows = posts.map((p: any) => ({ id: p.id, date: p.created.slice(0, 10), platform: p.platform.toLowerCase(), status: p.status, likes: p.metrics?.likes ?? 0 }));
    rows.sort((a: any, b: any) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    w('docs/posts.csv', ['id,date,platform,status,likes', ...rows.map((x: any) => `${x.id},${x.date},${x.platform},${x.status},${x.likes}`)].join('\n') + '\n');
  },
  T18: () => w('docs/STATUS.md', ['Step 1 — Tool Executor — DONE', 'Step 2 — Orchestrator — TODO', 'Step 3 — Gate — TODO', 'Step 4 — Agent Factory — TODO', 'Step 5 — Swarm — TODO'].join('\n') + '\n'),
};

S[id]();
console.log(`${id} reference solution applied`);
