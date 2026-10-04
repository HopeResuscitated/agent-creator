// meterabort.mjs - real-Ollama check that meter.mjs aborts its upstream request when the agent disconnects
// (meter incident, fixed in bab3a17). Run only when nothing else is using Ollama.
//   "$NODE_BIN" evals/bench/meterabort.mjs [listen port] [model]      -> prints the measurements, then
//   "METERABORT PASS ..." / "METERABORT FAIL ..." and exits 0 / 1.
// Steps: (1) warm request; (2) long generation through the meter, client destroyed after KILL_MS;
// (3) immediately a tiny request. If the meter left (2) running, Ollama is still busy and (3) waits behind it
// (pre-fix: 641 s). PASS = the killed request is logged client_gone with meter_aborted_upstream, and (3) gets its
// first byte within TINY_MAX_MS. The meter log is written to a temp dir, never into the repo.
// METER_JS=<file> runs a different meter build (used once to prove the gate fails on the pre-bab3a17 meter).
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import http from 'node:http'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.argv[2] || 40100 + Math.floor(Math.random() * 800)); const MODEL = process.argv[3] || 'hermes-local-32k';
const KILL_MS = 8000, TINY_MAX_MS = 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meterabort-')); const log = path.join(dir, 'meter.jsonl');
const me = spawn(process.execPath, [process.env.METER_JS || path.join(here, 'meter.mjs')], { env: { ...process.env, METER_LOG: log, METER_LISTEN: `127.0.0.1:${PORT}`, METER_UPSTREAM: process.env.METER_UPSTREAM || '127.0.0.1:11434' }, stdio: 'inherit' });
let meterExit = null; me.on('exit', (code) => { meterExit = code; });
await sleep(800);
if (meterExit !== null) { console.log(`METERABORT FAIL meter exited early (code ${meterExit})`); process.exit(1); }
const body = (prompt, n) => JSON.stringify({ model: MODEL, stream: true, max_tokens: n, messages: [{ role: 'user', content: prompt }] });
const req = (b, killAt, giveUpAt) => new Promise((r) => {
  const t0 = Date.now(); let ttfb = 0;
  const q = http.request({ host: '127.0.0.1', port: PORT, path: '/v1/chat/completions', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    res.on('data', () => { if (!ttfb) ttfb = Date.now() - t0; }); res.on('end', () => r({ ttfb, total: Date.now() - t0, killed: false })); res.on('error', () => {});
  });
  q.on('error', () => {}); q.end(b);
  if (killAt) setTimeout(() => { q.destroy(); r({ ttfb, total: Date.now() - t0, killed: true }); }, killAt);
  if (giveUpAt) setTimeout(() => { if (!ttfb) { q.destroy(); r({ ttfb: 0, total: Date.now() - t0, killed: false, gaveUp: true }); } }, giveUpAt);
});
const warm = await req(body('Say OK.', 5)); console.log('warm', warm);
const long = await req(body('Write a 3000-word essay on the history of bridges.', 3000), KILL_MS); console.log('long (killed)', long);
const tiny = await req(body('Say OK.', 5), 0, TINY_MAX_MS * 3); console.log('tiny after kill', tiny);
await sleep(500); me.kill();
const rows = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.id) : [];
for (const x of rows) console.log(x.id, 'total', x.total_ms, 'gone', !!x.client_gone, (x.events || []).map((e) => e[0]).join(','));
const killed = rows.find((x) => x.client_gone);
const aborted = !!killed && (killed.events || []).some((e) => e[0] === 'meter_aborted_upstream');
const ok = long.killed && aborted && tiny.ttfb > 0 && tiny.ttfb < TINY_MAX_MS;
console.log(`METERABORT ${ok ? 'PASS' : 'FAIL'} killed_request_aborted=${aborted} tiny_ttfb_ms=${tiny.ttfb} (limit ${TINY_MAX_MS}) log=${log}`);
process.exit(ok ? 0 : 1);
