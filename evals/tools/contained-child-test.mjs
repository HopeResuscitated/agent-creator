// evals/tools/contained-child-test.mjs — targeted regression test for child processes INSIDE the AppContainer.
//
//   node evals/tools/contained-child-test.mjs
//
// Stages the tools root exactly as run.ts does (via `run.ts --stage-tools-only`), then launches each case in
// its own contained process through the real wrapper (AppContainer + Job + ACLs + env allow-list). Checks:
//   - child with piped stdio returns (the libuv 1.52 pipe-namespace hang), fork IPC, node --test, npm, npx,
//     npm run, npx tsc
//   - negative controls: the STOCK node.exe must still hang on piped spawn (proves the test can detect the bug),
//     a global-namespace pipe must still be refused, and npm must still have no network.
// Exit 0 only when every case matches its expectation.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const WRAPPER = path.join(REPO, 'evals', 'tools', 'run-in-job.ps1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contained-child-'));
const sb = path.join(root, 'sb'); const home = path.join(root, 'home'); const stock = path.join(root, 'stock');
for (const d of [sb, home, stock]) fs.mkdirSync(d, { recursive: true });

const st = spawnSync(process.execPath, [path.join(REPO, 'evals', 'run.ts'), '--stage-tools-only', root], { cwd: REPO, encoding: 'utf8' });
if (st.status !== 0) { console.error(`staging failed:\n${st.stdout}${st.stderr}`); process.exit(2); }
const tools = path.join(root, '_agent-tools');
fs.copyFileSync(process.execPath, path.join(stock, 'node.exe'));

// A minimal package inside the sandbox: a test, a script, and a local typescript bin (copied, so the sandbox
// stays self-contained and the container never needs to read the repo's node_modules).
fs.writeFileSync(path.join(sb, 'package.json'), JSON.stringify({ name: 'cc', version: '1.0.0', type: 'module', scripts: { hello: 'node -e "console.log(\'SCRIPT-OK\')"' } }));
fs.writeFileSync(path.join(sb, 'a.test.mjs'), 'import test from "node:test"; import assert from "node:assert"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";\ntest("tmp fixture", () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "fx-")); fs.rmSync(d, { recursive: true }); });\ntest("math", () => assert.equal(1 + 1, 2));\n');
fs.writeFileSync(path.join(sb, 'spawn.mjs'), [
  'import cp from "node:child_process";',
  'const r = cp.spawnSync(process.execPath, ["-e", "process.stdout.write(\'KID-OUT\'); process.stderr.write(\'KID-ERR\')"], { encoding: "utf8", timeout: 8000 });',
  'console.log(`SPAWN status=${r.status} out=${r.stdout} err=${r.stderr} error=${r.error?.code ?? "none"}`);',
].join('\n'));
fs.writeFileSync(path.join(sb, 'kid-ipc.mjs'), 'process.send("IPC-HI"); process.disconnect();');
fs.writeFileSync(path.join(sb, 'fork.mjs'), 'import cp from "node:child_process"; const c = cp.fork("kid-ipc.mjs"); const t = setTimeout(() => { console.log("FORK timeout"); process.exit(1); }, 8000); c.on("message", (m) => { console.log(`FORK message=${m}`); clearTimeout(t); });');
fs.writeFileSync(path.join(sb, 'gpipe.mjs'), 'import net from "node:net"; const s = net.createServer(); s.on("error", (e) => { console.log(`GPIPE refused ${e.code}`); process.exit(0); }); s.listen("\\\\\\\\.\\\\pipe\\\\cc-global-" + process.pid, () => { console.log("GPIPE LISTENING"); process.exit(0); });');
fs.cpSync(path.join(REPO, 'node_modules', 'typescript'), path.join(sb, 'node_modules', 'typescript'), { recursive: true });
fs.mkdirSync(path.join(sb, 'node_modules', '.bin'), { recursive: true });
fs.writeFileSync(path.join(sb, 'node_modules', '.bin', 'tsc.cmd'), '@node "%~dp0\\..\\typescript\\bin\\tsc" %*\r\n');
// npm exec's local-bin lookup stats the extensionless name (npm generates both), so the test must too.
fs.writeFileSync(path.join(sb, 'node_modules', '.bin', 'tsc'), '#!/bin/sh\nexec node "$(dirname "$0")/../typescript/bin/tsc" "$@"\n');
fs.writeFileSync(path.join(sb, 'x.ts'), 'export const n: number = 1;\n');

function contained(exe, argv, toolsRoot, timeoutMs) {
  const t0 = Date.now();
  const b64 = Buffer.from(JSON.stringify(argv)).toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WRAPPER,
    '-Command', exe, '-ArgsB64', b64, '-TimeoutMs', String(timeoutMs), '-WritableRoot', sb, '-JcodeHome', home, '-ToolsRoot', toolsRoot],
    { cwd: REPO, encoding: 'utf8', timeout: timeoutMs + 60_000 });
  const all = `${r.stdout}${r.stderr}`;
  return { all, out: all.split(/\r?\n/).filter((l) => !l.startsWith('[run-in-job')).join('\n'), timedOut: /timedOut=True/.test(all), dead: /process tree proven dead/.test(all), ms: Date.now() - t0 };
}
const cmd = (line) => ['/d', '/c', `${line} 2>&1`];

const cases = [
  ['piped spawn returns (patched node)', () => contained(path.join(tools, 'node.exe'), ['spawn.mjs'], tools, 30_000), (r) => /SPAWN status=0 out=KID-OUT err=KID-ERR error=none/.test(r.out)],
  ['fork IPC works', () => contained(path.join(tools, 'node.exe'), ['fork.mjs'], tools, 30_000), (r) => /FORK message=IPC-HI/.test(r.out)],
  ['node --test (child per file, tmp fixture)', () => contained('cmd', cmd('node --test a.test.mjs'), tools, 60_000), (r) => /(#|ℹ) pass 2/.test(r.out) && /(#|ℹ) fail 0/.test(r.out)],
  ['npm --version', () => contained('cmd', cmd('npm --version'), tools, 60_000), (r) => /^\d+\.\d+\.\d+/m.test(r.out)],
  ['npx --version', () => contained('cmd', cmd('npx --version'), tools, 60_000), (r) => /^\d+\.\d+\.\d+/m.test(r.out)],
  ['npm run <script>', () => contained('cmd', cmd('npm run hello'), tools, 60_000), (r) => /SCRIPT-OK/.test(r.out)],
  ['npx tsc (local bin)', () => contained('cmd', cmd('npx --no-install tsc --noEmit x.ts && echo TSC-OK'), tools, 90_000), (r) => /TSC-OK/.test(r.out)],
  // negative controls
  ['CONTROL stock node still hangs on piped spawn', () => contained(path.join(stock, 'node.exe'), ['spawn.mjs'], stock, 12_000), (r) => r.timedOut || /error=ETIMEDOUT/.test(r.out)],
  ['CONTROL global-namespace pipe still refused', () => contained(path.join(tools, 'node.exe'), ['gpipe.mjs'], tools, 30_000), (r) => /GPIPE refused/.test(r.out)],
  ['CONTROL npm has no network', () => contained('cmd', cmd('npm view left-pad version --fetch-retries=0 --fetch-timeout=5000'), tools, 90_000), (r) => /npm error (code E|network)/.test(r.out) && !/^\d+\.\d+\.\d+\s*$/m.test(r.out)],
];

let failed = 0;
for (const [name, run, expect] of cases) {
  const r = run();
  const ok = expect(r) && r.dead;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${String(r.ms).padStart(6)}ms${r.dead ? '' : '  (process tree NOT proven dead)'}`);
  if (!ok) console.log(r.out.split('\n').filter(Boolean).slice(-8).map((l) => `        ${l.slice(0, 180)}`).join('\n'));
}
fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} case(s) FAILED` : `\nall ${cases.length} cases passed`);
process.exit(failed ? 1 : 0);
