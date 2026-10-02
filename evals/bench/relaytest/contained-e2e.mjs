// Real AppContainer end-to-end: the client runs INSIDE the container via run-in-job.ps1 -ModelUpstream, so bytes
// travel client -> in-container relay -> pipe -> broker -> fake upstream, exactly the contained model path.
// Also checks the fail-fast readiness path by occupying the relay port first.
//   node contained-e2e.mjs [repo]   (default: the checkout this script is in; pass a native C:/... path, not /c/...)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(process.argv[2] ?? path.join(HERE, '..', '..', '..'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-'));
const st = spawnSync(process.execPath, [path.join(REPO, 'evals', 'run.ts'), '--stage-tools-only', root], { cwd: REPO, encoding: 'utf8' });
if (st.status !== 0) { console.log('staging failed', st.error?.message ?? '', st.stdout, st.stderr); process.exit(1); }
const tools = path.join(root, '_agent-tools');
const SIZE = 3_000_000;
const upPort = 43000 + Math.floor(Math.random() * 1000);
const up = spawn(process.execPath, [path.join(HERE, 'upstream.mjs'), String(upPort), String(SIZE)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

function run(name, relayPort) {
  const sb = path.join(root, name); fs.mkdirSync(sb);
  fs.copyFileSync(path.join(HERE, 'client.mjs'), path.join(sb, 'client.mjs'));
  const home = `${sb}.agent-home`; fs.mkdirSync(home);
  const b64 = Buffer.from(JSON.stringify(['client.mjs', String(relayPort), String(SIZE), '9'])).toString('base64');
  const t0 = Date.now();
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'evals', 'tools', 'run-in-job.ps1'),
    '-Command', path.join(tools, 'node.exe'), '-ArgsB64', b64, '-TimeoutMs', '90000', '-WritableRoot', sb, '-JcodeHome', home, '-ToolsRoot', tools,
    '-ModelUpstream', `127.0.0.1:${upPort}`, '-RelayPort', String(relayPort)], { encoding: 'utf8', timeout: 180_000 });
  const all = `${r.stdout}\n${r.stderr}`;
  return { exit: r.status, ms: Date.now() - t0, all };
}

const okRun = run('ok', 25000 + Math.floor(Math.random() * 5000));
console.log(`== contained transfer: wrapper exit=${okRun.exit} (${okRun.ms} ms)`);
console.log(okRun.all.split(/\r?\n/).filter((l) => /complete|TOTAL|proven dead|relay ready|broker stopped|acl restore: identical|profile deleted/.test(l)).join('\n'));

const busyPort = 30000 + Math.floor(Math.random() * 5000);
const blocker = net.createServer().listen(busyPort, '127.0.0.1');
await new Promise((r) => blocker.on('listening', r));
const busy = run('busy', busyPort);
blocker.close();
console.log(`== relay port already in use: wrapper exit=${busy.exit} (${busy.ms} ms)`);
console.log(busy.all.split(/\r?\n/).filter((l) => /relay exited|setup failed|did not report|acl restore: identical/.test(l)).join('\n'));
up.kill();
