// analyze.mjs — per-run benchmark analysis: tasks vs a baseline run, failure detail, model meter stats,
// per-task containment evidence (wrapper notes, broker/agent-home logs) and the watchdog log.
//
//   node evals/bench/analyze.mjs --run <evals/results/<runId>> --ev <suite ev dir> [--base <evals/results/<baseRunId>>]
//                                [--sandboxes <dir with <task>.agent-home>] [--out <file>]
//
// --ev is the suite.sh evidence dir (meter.jsonl, watch.log). --sandboxes defaults to <os.tmpdir()>/agent-evals/<runId>
// (where run.ts keeps them). --base defaults to the uncontained baseline run 2026-09-28-16-05_ollama-hermes-local-32k.
// Prints the report; with --out also writes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const runDir = flag('run'); const evDir = flag('ev');
if (!runDir || !evDir) { console.error('usage: analyze.mjs --run <results dir> --ev <ev dir> [--base <results dir>] [--sandboxes <dir>] [--out <file>]'); process.exit(2); }
const runId = path.basename(path.resolve(runDir));
const baseDir = flag('base') ?? path.join(REPO, 'evals', 'results', '2026-09-28-16-05_ollama-hermes-local-32k');
const sbRoot = flag('sandboxes') ?? path.join(os.tmpdir(), 'agent-evals', runId);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

const run = readJson(path.join(runDir, 'results.json'));
const base = fs.existsSync(path.join(baseDir, 'results.json')) ? readJson(path.join(baseDir, 'results.json')) : [];
const B = Object.fromEntries(base.map((r) => [r.id, r]));
const res = (r) => (r ? `${r.env && r.env !== 'CLEAN' ? r.env : r.pass ? 'PASS' : 'FAIL'}${r.timedOut ? '(to)' : ''}` : '-');
const out = [];

// ---------- tasks ----------
out.push(`== TASKS (baseline uncontained ${path.basename(baseDir).slice(0, 16)}  vs  contained this run)`);
out.push(`${'id'.padEnd(5)}${'level'.padEnd(8)}${'base'.padEnd(16)}${'contained'.padEnd(16)}${'base_s'.padStart(6)}${'cont_s'.padStart(8)}${'delta'.padStart(7)}  note`);
let bPass = 0, cPass = 0, bSec = 0, cSec = 0;
for (const r of run) {
  const b = B[r.id];
  const note = b && b.pass && !r.pass ? 'REGRESSION' : b && !b.pass && r.pass ? 'IMPROVED' : '';
  if (b?.pass) bPass++; if (r.pass) cPass++; bSec += b?.seconds ?? 0; cSec += r.seconds;
  out.push(`${r.id.padEnd(5)}${r.difficulty.padEnd(8)}${res(b).padEnd(16)}${res(r).padEnd(16)}${String(b?.seconds ?? '-').padStart(6)}${String(r.seconds).padStart(8)}${String(b ? r.seconds - b.seconds : '-').padStart(8)}  ${note}`);
}
const denom = base.length || run.length;
out.push(`TOTAL base ${bPass}/${denom} ${Math.round(bSec / 60)} min | contained ${cPass}/${denom} ${Math.round(cSec / 60)} min`);
out.push('');
out.push('== FAILURE DETAIL (contained)');
for (const r of run.filter((x) => !x.pass && x.detail)) out.push(`${r.id}: ${r.detail.replace(/\r?\n/g, ' ').slice(0, 300)}`);
out.push('');

// ---------- model meter ----------
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const meter = readText(path.join(evDir, 'meter.jsonl')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.id);
const chat = meter.filter((x) => x.path?.includes('chat/completions') && !x.error);
const errors = meter.filter((x) => x.error).length;
const non200 = meter.filter((x) => x.status && x.status !== 200).length;
out.push('== MODEL (trusted-side meter between broker and Ollama)');
out.push(`requests total=${meter.length} chat=${meter.filter((x) => x.path?.includes('chat/completions')).length} errors=${errors} non200=${non200}`);
const ttfb = chat.map((x) => x.ttfb_ms), tot = chat.map((x) => x.total_ms);
out.push(`chat ttfb ms n=${ttfb.length} p50=${pct(ttfb, 0.5)} p90=${pct(ttfb, 0.9)} max=${Math.max(0, ...ttfb)}`);
out.push(`chat total ms n=${tot.length} p50=${pct(tot, 0.5)} p90=${pct(tot, 0.9)} max=${Math.max(0, ...tot)}`);
const withU = chat.filter((x) => x.usage);
out.push(`completion tokens total=${withU.reduce((a, x) => a + (x.usage.completion_tokens ?? 0), 0)} prompt tokens total=${withU.reduce((a, x) => a + (x.usage.prompt_tokens ?? 0), 0)}`);
const tps = withU.filter((x) => x.total_ms > x.ttfb_ms).map((x) => x.usage.completion_tokens / ((x.total_ms - x.ttfb_ms) / 1000));
out.push(`client-observed decode tok/s (completion_tokens / (total-ttfb)) p50=${pct(tps, 0.5).toFixed(2)} p90=${pct(tps, 0.9).toFixed(2)}`);
const ptok = withU.map((x) => x.usage.prompt_tokens);
out.push(`prompt tokens per request p50=${pct(ptok, 0.5)} max=${Math.max(0, ...ptok)}`);
const structured = chat.filter((x) => x.tool_call_deltas > 0).length;
const finish = {}; for (const x of chat) finish[x.finish || '?'] = (finish[x.finish || '?'] ?? 0) + 1;
const names = {}; for (const x of chat) for (const n of x.tool_names ?? []) names[n] = (names[n] ?? 0) + 1;
out.push(`TOOL CALLS: structured=${structured} (${chat.length ? ((100 * structured) / chat.length).toFixed(1) : '0.0'}% of chat turns) | tool-call-as-TEXT (needs jcode recovery)=${chat.filter((x) => x.text_toolcall).length} | finish: ${JSON.stringify(finish)}`);
out.push(`tool names: ${JSON.stringify(names)}`);
out.push('');

// ---------- per-task containment ----------
out.push('== PER-TASK CONTAINMENT + TOOL RESULTS (wrapper transcript and agent-home logs)');
const agg = { denied: 0, guard: 0, xml: 0 };
for (const r of run) {
  const tr = readText(path.join(runDir, `${r.id}.transcript.txt`));
  const notes = tr.split(/\r?\n/).filter((l) => l.startsWith('[run-in-job '));
  const body = tr.split(/\r?\n/).filter((l) => !/^\[(run-in-job|model-broker|model-relay) /.test(l)).join('\n');
  const home = path.join(sbRoot, `${r.id}.agent-home`);
  const logs = fs.existsSync(path.join(home, 'logs')) ? fs.readdirSync(path.join(home, 'logs')).map((f) => readText(path.join(home, 'logs', f))).join('\n') : '';
  const ex = /agent exit=(\S+) timedOut=(\S+) killed=(\S+) members-left=(\S+)/.exec(notes.join('\n'));
  const acl = ['agent home', 'tools root', 'sandbox'].map((w, i) => { const m = new RegExp(`${w} acl restore: identical-to-original=\\S+ aces-identical=(\\S+)`).exec(notes.join('\n')); return m ? `${['agent', 'tools', 'sandbox'][i]}:${m[1]}` : null; }).filter(Boolean).join(',');
  const envM = /(?:reduced to|replaced with) (\d+) (?:allow-listed|fixed) variables.*?\(dropped (\d+)/.exec(notes.join('\n'));
  const brokerLog = readText(path.join(home, 'broker.log'));
  const conns = /model broker stopped after (\d+) connection/.exec(notes.join('\n'))?.[1] ?? '?';
  const upfail = (brokerLog.match(/upstream connect failed/g) ?? []).length;
  const denied = (body.match(/Access is denied/g) ?? []).length;
  const guard = (logs.match(/refus(ed|ing) .*(outside|escape)|path (escapes|outside) (the )?(workspace|root)/gi) ?? []).length;
  const xml = (logs.match(/Recovered XML text tool call/g) ?? []).length;
  agg.denied += denied; agg.guard += guard; agg.xml += xml;
  const relayPort = /in-container relay ready on 127\.0\.0\.1:(\d+)/.exec(notes.join('\n'))?.[1];
  const urls = [...new Set([...logs.matchAll(/https?:\/\/[^\s"/)]+/g)].map((m) => m[0]))].filter((u) => !(relayPort && u === `http://127.0.0.1:${relayPort}`));
  out.push(`${r.id} exit=[${ex ? ex.slice(1).join(' ') : '?'}] dead=${notes.some((l) => /process tree proven dead/.test(l))} acl=${acl} profileDeleted=${notes.some((l) => /appcontainer profile deleted=True/.test(l))} env=${envM ? `${envM[1]}/${envM[2]}` : '?'} broker_conns=${conns} broker_upfail=${upfail} deniedMentions=${denied} guardRefusals=${guard} xmlRecovered=${xml}${urls.length ? ` NON-RELAY-URLS=${urls.join(',')}` : ''}`);
}
out.push(`AGG deniedMentions=${agg.denied} guardRefusals=${agg.guard} xmlRecovered=${agg.xml}`);
out.push('');

// ---------- watchdog ----------
out.push('== WATCHDOG');
const wl = readText(path.join(evDir, 'watch.log')).split(/\r?\n/).filter((l) => /^\d{4}-\d\d-\d\dT\S+ /.test(l) && !/ heartbeat /.test(l)); // continuation lines of multi-line cmds dropped
const trips = wl.filter((l) => / TRIP /.test(l)).length;
for (const l of wl.slice(0, 25)) out.push(l);
if (wl.length > 25) { out.push(`... ${wl.length - 25} more line(s); TRIP lines total=${trips}`); const stop = wl.find((l) => / watch stop /.test(l)); if (stop) out.push(stop); }

const text = out.join('\n') + '\n';
process.stdout.write(text);
if (flag('out')) fs.writeFileSync(flag('out'), text);
