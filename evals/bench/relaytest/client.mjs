// Drives requests through the relay and checks every response arrives complete and byte-exact.
// Modes per request: normal (keep socket open), halfclose (client end()s right after the request), slowread
// (client pauses reading so the relay builds backpressure).
import net from 'node:net';
import crypto from 'node:crypto';
const port = Number(process.argv[2]);
const SIZE = Number(process.argv[3] ?? 3_000_000);
const N = Number(process.argv[4] ?? 12);
const exp = Buffer.alloc(SIZE); for (let i = 0; i < SIZE; i++) exp[i] = (i * 31 + 7) & 0xff;
const expSha = crypto.createHash('sha256').update(exp).digest('hex');
function one(mode) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
    const chunks = [];
    s.on('connect', () => {
      s.write('POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\n{}');
      if (mode === 'halfclose') s.end();
      if (mode === 'slowread') { s.pause(); setTimeout(() => s.resume(), 1500); }
    });
    s.on('data', (c) => chunks.push(c));
    const fin = (why) => {
      const all = Buffer.concat(chunks); const i = all.indexOf('\r\n\r\n');
      const b = i >= 0 ? all.subarray(i + 4) : Buffer.alloc(0);
      const ok = b.length === SIZE && crypto.createHash('sha256').update(b).digest('hex') === expSha;
      resolve({ mode, ok, bytes: b.length, why });
      s.destroy();
    };
    s.on('end', () => fin('end')); s.on('error', (e) => fin(`error ${e.code}`));
    setTimeout(() => fin('timeout'), 30000);
  });
}
const modes = ['normal', 'halfclose', 'slowread'];
const res = await Promise.all(Array.from({ length: N }, (_, i) => one(modes[i % 3])));
for (const m of modes) {
  const r = res.filter((x) => x.mode === m);
  console.log(`${m.padEnd(9)} ${r.filter((x) => x.ok).length}/${r.length} complete  ${r.filter((x) => !x.ok).map((x) => `${x.bytes}B/${x.why}`).join(' ')}`);
}
console.log(`TOTAL ${res.filter((x) => x.ok).length}/${res.length}`);
