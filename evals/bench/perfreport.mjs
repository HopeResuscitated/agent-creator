// perfreport.mjs - performance report of one suite run, in a format that compares the CPU baseline with a later
// GPU run. Read-only; no thresholds and no PASS/FAIL (the project defines none for performance).
//
//   node evals/bench/perfreport.mjs --label <name> --ev <ev-dir> [--ev <ev-dir>...] [--results <results.json>...]
//        [--hwprofile <hwprofile.json>] [--samples <perfsample.csv>] [--ollama-log <server.log>] [--out <report.json>]
//   node evals/bench/perfreport.mjs --compare <a.json> <b.json>      side-by-side table of two reports
//
// Sources (all already produced by the harness): ev-<label>/meter.jsonl (every model request through the meter:
// ttfb_ms, total_ms, usage), results.json (task outcomes), suite-start/end.txt (window), Ollama server.log (model
// loads inside the window), optional perfsample.ps1 CSV (CPU %, GPU util/memory), optional hwprofile.json.
// Definitions (per request r with status 200 and usage):
//   first_token_s      = ttfb_ms / 1000 (includes queueing, model load if cold, and prompt processing)
//   decode_tok_s       = sum(completion_tokens) / sum((total_ms - ttfb_ms) / 1000)    aggregate over requests
//   prefill_tok_s      = sum(prompt_tokens - cached_tokens) / sum(ttfb_ms / 1000)     aggregate; an upper-bound
//                        estimate of prompt processing speed's inverse cost (ttfb also includes queueing/load)
//   request_s          = total_ms / 1000
//   context_tokens     = prompt_tokens (+ completion_tokens = total_tokens) per request
//   model_load_s       = server.log "loading model via llama-server" -> next "loaded runners", inside the window
//   timeout_rate       = TIMEOUT outcomes / graded tasks; completion_rate = PASS / graded tasks (results.json with
//                        `outcome`; older results.json: timedOut / pass as recorded, flagged legacy=true)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const rd = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return null; } };

export function requestStats(reqs) {
  const ok = reqs.filter((r) => r.id !== undefined && r.status === 200 && r.usage);
  const all = reqs.filter((r) => r.id !== undefined);
  const ttfb = ok.map((r) => r.ttfb_ms / 1000), tot = ok.map((r) => r.total_ms / 1000);
  const comp = ok.reduce((a, r) => a + (r.usage.completion_tokens ?? 0), 0);
  const decodeS = ok.reduce((a, r) => a + Math.max(0, (r.total_ms - r.ttfb_ms) / 1000), 0);
  const newPrompt = ok.reduce((a, r) => a + Math.max(0, (r.usage.prompt_tokens ?? 0) - (r.usage.prompt_tokens_details?.cached_tokens ?? 0)), 0);
  const ttfbSum = ttfb.reduce((a, b) => a + b, 0);
  const prompt = ok.map((r) => r.usage.prompt_tokens ?? 0);
  return {
    requests: all.length, requests_ok: ok.length,
    requests_non200: all.filter((r) => r.status !== 200).length,
    requests_incomplete: all.filter((r) => r.status === 200 && !r.done_marker).length,
    first_token_s: { p50: r2(q(ttfb, 0.5)), p90: r2(q(ttfb, 0.9)), max: r2(q(ttfb, 1)) },
    request_s: { p50: r2(q(tot, 0.5)), p90: r2(q(tot, 0.9)), max: r2(q(tot, 1)), sum: r2(tot.reduce((a, b) => a + b, 0)) },
    decode_tok_s: decodeS > 0 ? r2(comp / decodeS) : null,
    prefill_tok_s: ttfbSum > 0 ? r2(newPrompt / ttfbSum) : null,
    completion_tokens: comp,
    context_tokens: { p50: q(prompt, 0.5), max: q(prompt, 1) },
  };
}

export function outcomeStats(results) {
  let legacy = false; const c = { PASS: 0, FAIL: 0, TIMEOUT: 0, OTHER: 0 };
  const graded = results.filter((r) => r.env !== 'SETUP_FAILED' && r.outcome !== 'SETUP_FAILED');
  for (const r of graded) {
    let o = r.outcome;
    if (!o) { legacy = true; o = r.env && r.env !== 'CLEAN' ? 'OTHER' : r.timedOut ? 'TIMEOUT' : r.pass ? 'PASS' : 'FAIL'; }
    c[o in c ? o : 'OTHER']++;
  }
  const n = graded.length;
  return { tasks: n, ...c, timeout_rate: n ? r2(c.TIMEOUT / n) : null, completion_rate: n ? r2(c.PASS / n) : null, legacy };
}

/** model loads (seconds) in server.log between two Date ms values */
export function modelLoads(logText, fromMs, toMs) {
  const loads = []; let start = null;
  for (const line of logText.split(/\r?\n/)) {
    const t = /^time=(\S+)/.exec(line); if (!t) continue; const ms = Date.parse(t[1]); if (Number.isNaN(ms)) continue;
    if (line.includes('msg="loading model via llama-server"')) start = ms;
    else if (line.includes('msg="loaded runners"') && start !== null) { if (start >= fromMs && start <= toMs) loads.push(r2((ms - start) / 1000)); start = null; }
  }
  return loads;
}

/** perfsample.ps1 CSV: time,cpu_pct,gpu_util_pct,gpu_mem_used_mib,gpu_mem_total_mib (gpu columns empty if none) */
export function sampleStats(csv) {
  const rows = csv.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(','));
  const col = (i) => rows.map((r) => parseFloat(r[i])).filter((x) => !Number.isNaN(x));
  const cpu = col(1), gu = col(2), gm = col(3);
  return { samples: rows.length, cpu_pct: { p50: r2(q(cpu, 0.5)), max: r2(q(cpu, 1)) },
    gpu_util_pct: gu.length ? { p50: r2(q(gu, 0.5)), max: r2(q(gu, 1)) } : null,
    gpu_mem_used_mib: gm.length ? { p50: q(gm, 0.5), max: q(gm, 1) } : null };
}

const ROWS = [
  ['hardware', (r) => r.hardware?.summary ?? 'n/a'], ['placement', (r) => r.hardware?.placement ?? 'n/a'],
  ['model_load_s', (r) => (r.model_load_s.length ? r.model_load_s.join(', ') : 'none in window')],
  ['requests (ok / non200 / incomplete)', (r) => `${r.requests.requests_ok} / ${r.requests.requests_non200} / ${r.requests.requests_incomplete}`],
  ['first_token_s p50 / p90 / max', (r) => `${r.requests.first_token_s.p50} / ${r.requests.first_token_s.p90} / ${r.requests.first_token_s.max}`],
  ['decode_tok_s (aggregate)', (r) => r.requests.decode_tok_s], ['prefill_tok_s (aggregate, est.)', (r) => r.requests.prefill_tok_s],
  ['request_s p50 / p90 / max', (r) => `${r.requests.request_s.p50} / ${r.requests.request_s.p90} / ${r.requests.request_s.max}`],
  ['context_tokens p50 / max', (r) => `${r.requests.context_tokens.p50} / ${r.requests.context_tokens.max}`],
  ['cpu_pct p50 / max', (r) => (r.samples ? `${r.samples.cpu_pct.p50} / ${r.samples.cpu_pct.max}` : 'not sampled')],
  ['gpu_util_pct p50 / max', (r) => (r.samples?.gpu_util_pct ? `${r.samples.gpu_util_pct.p50} / ${r.samples.gpu_util_pct.max}` : 'not sampled')],
  ['gpu_mem_used_mib p50 / max', (r) => (r.samples?.gpu_mem_used_mib ? `${r.samples.gpu_mem_used_mib.p50} / ${r.samples.gpu_mem_used_mib.max}` : 'not sampled')],
  ['tasks: PASS / FAIL / TIMEOUT / other', (r) => (r.outcomes ? `${r.outcomes.PASS} / ${r.outcomes.FAIL} / ${r.outcomes.TIMEOUT} / ${r.outcomes.OTHER}${r.outcomes.legacy ? ' (legacy results.json)' : ''}` : 'n/a')],
  ['timeout_rate / completion_rate', (r) => (r.outcomes ? `${r.outcomes.timeout_rate} / ${r.outcomes.completion_rate}` : 'n/a')],
];
export function table(reports) {
  const head = `| metric | ${reports.map((r) => r.label).join(' | ')} |\n|---|${reports.map(() => '---').join('|')}|`;
  return [head, ...ROWS.map(([k, f]) => `| ${k} | ${reports.map((r) => String(f(r))).join(' | ')} |`)].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const many = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
  const one = (n) => many(n)[0];
  if (argv[0] === '--compare') { const reps = argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))); console.log(table(reps)); process.exit(0); }
  const label = one('label'), evs = many('ev');
  if (!label || !evs.length) { console.error('usage: perfreport.mjs --label <name> --ev <ev-dir>... [--results f]... [--hwprofile f] [--samples f] [--ollama-log f] [--out f] | --compare a.json b.json'); process.exit(2); }
  const reqs = evs.flatMap((e) => readJsonl(path.join(e, 'meter.jsonl')));
  const windows = evs.map((e) => [Date.parse(rd(path.join(e, 'suite-start.txt')) ?? ''), Date.parse(rd(path.join(e, 'suite-end.txt')) ?? '')]).filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
  const logF = one('ollama-log') ?? path.join(process.env.LOCALAPPDATA ?? '', 'Ollama', 'server.log');
  const logText = fs.existsSync(logF) ? fs.readFileSync(logF, 'utf8') : '';
  const loads = windows.flatMap(([a, b]) => modelLoads(logText, a, b));
  const results = many('results').flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  let hardware = null;
  if (one('hwprofile')) {
    const h = JSON.parse(fs.readFileSync(one('hwprofile'), 'utf8').replace(/^\uFEFF/, ''));
    const gpu = h.nvidia?.gpus?.map((g) => `${g.name} ${g.memory_total_mib} MiB`).join('+') || (Array.isArray(h.video_controllers) ? h.video_controllers.map((v) => v.name).join('+') : '');
    hardware = { summary: `${h.cpu?.[0]?.name ?? '?'}; ${h.ram?.total_gib ?? '?'} GiB RAM; ${gpu}`, placement: h.ollama?.loaded?.[0]?.placement ?? null };
  }
  const rep = { schema: 'perfreport/1', label, ev: evs, windows: windows.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]),
    hardware, model_load_s: loads, requests: requestStats(reqs), outcomes: results.length ? outcomeStats(results) : null,
    samples: one('samples') ? sampleStats(fs.readFileSync(one('samples'), 'utf8')) : null,
    note: 'Descriptive only. No thresholds; compare runs on the same task set, pins and timeouts.' };
  if (one('out')) fs.writeFileSync(one('out'), JSON.stringify(rep, null, 1) + '\n');
  console.log(table([rep]));
}
