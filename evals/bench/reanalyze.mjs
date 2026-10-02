// reanalyze.mjs — incomplete-stream analysis of suite meter logs, cross-checked against Ollama's server.log.
//
//   node evals/bench/reanalyze.mjs [--ollama-log <server.log>] <ev-dir> [<ev-dir> ...]
//
// complete = HTTP 200 AND finish_reason present AND usage present. For each incomplete chat stream, lists the
// Ollama WARN/ERROR lines and [GIN] chat/completions lines within ±2 s of the stream end, then any Ollama
// warnings in the run window not mapped to an incomplete stream. parser-bug-signature counts records where
// exactly one of finish/usage is present (the shape the cycle-4 meter's dropped-final-line bug produced).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let olPath = path.join(process.env.LOCALAPPDATA ?? '', 'Ollama', 'server.log');
const dirs = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--ollama-log') olPath = argv[++i]; else dirs.push(argv[i]); }
if (!dirs.length) { console.error('usage: reanalyze.mjs [--ollama-log <server.log>] <ev-dir> ...'); process.exit(2); }
const OL = fs.existsSync(olPath) ? fs.readFileSync(olPath, 'utf8').split(/\r?\n/) : [];
// Ollama server.log: "time=2026-10-01T14:28:48.980-05:00 level=WARN ..." and "[GIN] 2026/10/01 - 15:05:27 | 500 | 10m7s | POST ..." (local time)
const warns = OL.filter((l) => /level=(WARN|ERROR)/.test(l) && /time=\S+/.test(l)).map((l) => {
  const t = Date.parse(l.match(/time=(\S+)/)[1]); return { t, msg: (l.match(/msg="([^"]+)"/) ?? [])[1], err: (l.match(/error="([^"]+)"/) ?? [])[1] ?? '' };
});
const gin = OL.filter((l) => l.startsWith('[GIN] ') && l.includes('chat/completions')).map((l) => {
  const m = l.match(/\[GIN\] (\d+)\/(\d+)\/(\d+) - (\d+):(\d+):(\d+) \| (\d+) \|\s+(\S+)/);
  return m ? { t: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), status: +m[7], dur: m[8] } : null;
}).filter(Boolean);
const near = (arr, t, tol) => arr.filter((x) => Math.abs(x.t - t) <= tol);
const out = [];
if (!OL.length) out.push(`(no Ollama log at ${olPath}: cross-check skipped)`);
const tot = { req: 0, inc: 0, incWarn: 0, warnInWindow: 0, warnMapped: 0 };
for (const d of dirs) {
  const recs = fs.readFileSync(path.join(d, 'meter.jsonl'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((x) => x.id);
  // client_gone (older logs: first_closer 'client'): the agent was killed mid-request; not a model stream result
  const chat = recs.filter((x) => x.path?.includes('chat/completions') && !x.client_gone && x.first_closer !== 'client');
  if (!recs.length) { out.push(`== ${path.basename(d)}: no requests`); continue; }
  const t0 = Date.parse(recs[0].t), t1 = Math.max(...recs.map((x) => Date.parse(x.t) + x.total_ms));
  const inc = chat.filter((x) => !(x.status === 200 && x.finish && x.usage));
  const sig = chat.filter((x) => x.status === 200 && (!!x.finish !== !!x.usage));
  const wWin = warns.filter((w) => w.t >= t0 && w.t <= t1 + 5000);
  out.push(`== ${path.basename(d)}: chat=${chat.length} incomplete(fixed rule)=${inc.length} parser-bug-signature=${sig.length} ollama WARN/ERROR in window=${wWin.length}`);
  const mapped = new Set();
  for (const x of inc) {
    const end = Date.parse(x.t) + x.total_ms;
    const w = near(wWin, end, 2000); w.forEach((y) => mapped.add(y));
    const g = near(gin, end, 2000);
    out.push(`  #${x.id} start=${x.t} status=${x.status} ttfb=${((x.ttfb_ms ?? 0) / 1000).toFixed(1)}s total=${(x.total_ms / 1000).toFixed(1)}s chunks=${x.chunks} content=${x.content_chars} tool_deltas=${x.tool_call_deltas} finish=${JSON.stringify(x.finish)} usage=${!!x.usage}`);
    out.push(`      ollama@end±2s: ${w.map((y) => `${y.msg} [${y.err.slice(0, 70)}]`).join(' ; ') || 'NONE'} | GIN: ${g.map((y) => `${y.status} ${y.dur}`).join(',') || 'none'}`);
    tot.inc++; if (w.length) tot.incWarn++;
  }
  for (const y of wWin.filter((y) => !mapped.has(y))) out.push(`  unmapped ollama: ${new Date(y.t).toISOString()} ${y.msg} [${y.err.slice(0, 70)}]`);
  tot.req += chat.length; tot.warnInWindow += wWin.length; tot.warnMapped += mapped.size;
}
out.push(`TOTAL chat=${tot.req} incomplete=${tot.inc} incomplete-with-Ollama-parse-warning-at-end=${tot.incWarn} | Ollama warnings in run windows=${tot.warnInWindow}, mapped to an incomplete stream=${tot.warnMapped}`);
console.log(out.join('\n'));
