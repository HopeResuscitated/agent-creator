// secprobe.mjs — runs INSIDE the measured environment with the PATCHED node. Each check reports what happened;
// the outer script decides pass/fail per mode. Results -> secprobe-<mode>.json in cwd.
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
const mode = process.argv[2] || 'unknown';
const OUTSIDE = process.argv[3];               // a directory outside the sandbox the trusted side owns
const REAL_HOME = process.argv[4];             // the user's real profile dir (inside, USERPROFILE is the agent home)
const REPO = process.argv[5];                  // the real repo checkout
if (!OUTSIDE || !REAL_HOME || !REPO) { console.error('usage: secprobe.mjs <mode> <outsideDir> <realUserProfile> <repo>'); process.exit(2); }
const USERPROFILE_JCODE = path.join(REAL_HOME, '.jcode');
const res = { mode, node: process.version, checks: {} };
const rec = (k, v) => { res.checks[k] = v; console.log(`CHK ${k.padEnd(26)} ${JSON.stringify(v)}`); };
const tryFs = (f) => { try { f(); return 'ALLOWED'; } catch (e) { return `DENIED:${e.code}`; } };
// filesystem
rec('write_inside', tryFs(() => fs.writeFileSync('inside.txt', 'x')));
rec('write_outside_abs', tryFs(() => fs.writeFileSync(path.join(OUTSIDE, `escape-${mode}.txt`), 'x')));
rec('write_traversal', tryFs(() => fs.writeFileSync(path.join('..', '..', `trav-${mode}.txt`), 'x')));
rec('read_user_jcode', tryFs(() => fs.readdirSync(USERPROFILE_JCODE)));
rec('read_user_ssh', tryFs(() => fs.readdirSync(path.join(REAL_HOME, '.ssh'))));
rec('write_repo', tryFs(() => fs.writeFileSync(path.join(REPO, 'escape.txt'), 'x')));
// environment / credentials
const secretish = Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|API/i.test(k));
rec('env_count', Object.keys(process.env).length);
rec('env_secretish_names', secretish);
rec('userprofile', process.env.USERPROFILE ?? null);
// network
const tcp = (host, port) => new Promise((r) => {
  const s = net.connect({ host, port, timeout: 3000 });
  s.on('connect', () => { s.destroy(); r('CONNECTED'); });
  s.on('timeout', () => { s.destroy(); r('TIMEOUT'); });
  s.on('error', (e) => r(`DENIED:${e.code}`));
});
rec('tcp_ollama_direct', await tcp('127.0.0.1', 11434));
rec('tcp_internet_1.1.1.1', await tcp('1.1.1.1', 443));
// broker path: the relay port is in the generated config if present
let relay = null;
try { relay = /base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"/.exec(fs.readFileSync(path.join(process.env.JCODE_HOME || '', 'config.toml'), 'utf8'))?.[1]; } catch {}
if (relay) {
  rec('relay_models', await new Promise((r) => {
    const q = http.get({ host: '127.0.0.1', port: Number(relay), path: '/v1/models', timeout: 15000 }, (rs) => { let b = ''; rs.on('data', (d) => (b += d)); rs.on('end', () => r(`HTTP${rs.statusCode}:${b.slice(0, 80)}`)); });
    q.on('error', (e) => r(`ERR:${e.code}`)); q.on('timeout', () => { q.destroy(); r('TIMEOUT'); });
  }));
} else rec('relay_models', 'no relay configured');
// process isolation: can we see / signal processes outside? (tasklist and a kill of the parent's parent)
const tl = cp.spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
rec('tasklist', tl.status === 0 ? `rows=${(tl.stdout || '').trim().split(/\r?\n/).length}` : `rc=${tl.status}:${(tl.stderr || tl.stdout || '').trim().slice(0, 80)}`);
const explorer = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1).Id'], { encoding: 'utf8', windowsHide: true });
rec('see_explorer_pid', (explorer.stdout || '').trim() || `none rc=${explorer.status}`);
// leave a detached grandchild behind on purpose: the job must kill it at exit
const g = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},600000)'], { detached: true, stdio: 'ignore' });
g.unref();
rec('orphan_pid', g.pid);
fs.writeFileSync(`secprobe-${mode}.json`, JSON.stringify(res, null, 2));
