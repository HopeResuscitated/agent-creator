// hwreport.mjs - hardware measurement report: CURRENT MEASURED BASELINE vs FUTURE HARDWARE MEASUREMENTS, side by side,
// from files the harness already writes (hwprofile.ps1 JSON, perfreport.mjs JSON). Descriptive only: no thresholds,
// no PASS/FAIL. A field the inputs do not contain is printed "NOT MEASURED", never estimated.
//
//   "$NODE_BIN" evals/bench/hwreport.mjs --baseline-hw evals/perf/cpu-baseline-hwprofile.json
//        --baseline-perf evals/perf/cpu-baseline-b6-contained.json
//        [--future-hw $R/hwprofile.json] [--future-perf <perfreport.json>] [--out <report.md>]
//
// After the hardware change: hwprofile.ps1 is run by repin.mjs stage 1 (model loaded: run one warm-up first so
// placement and buffer lines are current); the perf report comes from perfreport.mjs over the first suite run.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const NM = 'NOT MEASURED';
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const val = (x) => (x && typeof x === 'object' && 'reason' in x && 'value' in x && x.value === null ? null : x);   // hwprofile Try-Get failure shape

/** llama.cpp load lines -> { per device { model_mib, kv_mib, compute_mib, output_mib }, layers: {offloaded,total}, kv: {...} } */
export function parseBuffers(lines = []) {
  const dev = {}; let layers = null; let kv = null;
  const add = (d, k, mib) => { dev[d] ??= {}; dev[d][k] = Math.round(((dev[d][k] ?? 0) + mib) * 100) / 100; };
  for (const l of lines) {
    let m;
    if ((m = /load_tensors:\s+(\S+) model buffer size =\s+([\d.]+) MiB/.exec(l))) add(m[1], 'model_mib', +m[2]);
    else if ((m = /llama_kv_cache:\s+(\S+) KV buffer size =\s+([\d.]+) MiB/.exec(l))) add(m[1], 'kv_mib', +m[2]);
    else if ((m = /(\S+) compute buffer size =\s+([\d.]+) MiB/.exec(l))) add(m[1], 'compute_mib', +m[2]);
    else if ((m = /(\S+)\s+output buffer size =\s+([\d.]+) MiB/.exec(l))) add(m[1], 'output_mib', +m[2]);
    if ((m = /offloaded (\d+)\/(\d+) layers to GPU/.exec(l))) layers = { offloaded: +m[1], total: +m[2] };
    if ((m = /llama_kv_cache: size =\s+([\d.]+) MiB \(\s*(\d+) cells,\s+(\d+) layers.*K \((\S+)\)/.exec(l))) kv = { total_mib: +m[1], cells: +m[2], layers: +m[3], type: m[4] };
  }
  return { devices: dev, layers, kv };
}
/** Ollama "inference compute" lines -> [{ library, name, description, type, total, available }] */
export function parseCompute(lines = []) {
  return lines.map((l) => { const g = (k) => (new RegExp(`(?:^| )${k}=(?:"([^"]*)"|(\\S+))`).exec(l) ?? []).slice(1).find((x) => x !== undefined) ?? null;
    return { library: g('library'), name: g('name'), description: g('description'), type: g('type'), total: g('total'), available: g('available'), driver: g('driver') }; });
}

export function summarizeProfile(h) {
  if (!h) return null;
  const nv = val(h.nvidia), vc = val(h.video_controllers) ?? [], ol = val(h.ollama), cpu = val(h.cpu), ram = val(h.ram), st = val(h.storage), pw = val(h.power), rm = val(h.runner_memory);
  const loaded = ol?.loaded?.[0] ?? null; const buf = parseBuffers(ol?.newest_load_buffers ?? []); const comp = parseCompute(ol?.inference_compute ?? []);
  const gpuDevs = Object.entries(buf.devices).filter(([d]) => !/^CPU/.test(d));
  const sum = (devs, k) => devs.reduce((a, [, v]) => a + (v[k] ?? 0), 0);
  const cpuDevs = Object.entries(buf.devices).filter(([d]) => /^CPU/.test(d));
  return {
    taken: h.taken ?? null,
    gpu_name: nv?.gpus?.length ? nv.gpus.map((g) => g.name).join(' + ') : vc.length ? vc.map((v) => v.name).join(' + ') : null,
    gpu_vram: nv?.gpus?.length ? nv.gpus.map((g) => `${g.memory_total_mib} MiB`).join(' + ') : comp.find((c) => c.total)?.total ? `${comp.find((c) => c.total).total} (as reported by Ollama for ${comp.find((c) => c.total).description ?? comp.find((c) => c.total).name}${comp.find((c) => c.total).type === 'iGPU' ? ', shared system memory' : ''})` : null,
    gpu_driver: nv?.gpus?.length ? nv.gpus.map((g) => g.driver).join(' + ') : vc.length ? vc.map((v) => v.driver_version).join(' + ') : null,
    gpu_runtime: [nv?.cuda_driver_api ? `CUDA driver API ${nv.cuda_driver_api}` : null, h.rocm?.rocm_smi || h.rocm?.hipinfo ? 'ROCm tools present' : null, ...comp.map((c) => `Ollama library=${c.library}`)].filter(Boolean).join('; ') || null,
    gpu_visible_to_ollama: comp.length ? comp.map((c) => `${c.library} ${c.description ?? c.name} (${c.type ?? '?'}, total ${c.total ?? '?'}, available ${c.available ?? '?'})`).join('; ') : null,
    model: loaded ? `${loaded.name} ${loaded.quant} ctx ${loaded.context_length} digest ${String(loaded.digest).slice(0, 12)}` : null,
    placement: loaded?.placement ?? null,
    model_gpu_layers: buf.layers ? `${buf.layers.offloaded}/${buf.layers.total} offloaded to GPU` : gpuDevs.length === 0 && cpuDevs.length ? '0 (no GPU buffers in the newest load)' : null,
    model_memory: Object.keys(buf.devices).length ? `GPU ${Math.round(sum(gpuDevs, 'model_mib'))} MiB, CPU ${Math.round(sum(cpuDevs, 'model_mib'))} MiB (weights buffers)` : null,
    kv_cache_memory: buf.kv ? `${buf.kv.total_mib} MiB (${buf.kv.type}, ${buf.kv.cells} cells, ${buf.kv.layers} layers) on ${Object.entries(buf.devices).filter(([, v]) => v.kv_mib).map(([d]) => d).join('+') || '?'}` : null,
    compute_buffers: Object.keys(buf.devices).length ? Object.entries(buf.devices).filter(([, v]) => v.compute_mib).map(([d, v]) => `${d} ${v.compute_mib} MiB`).join(', ') || null : null,
    runner_private_memory: rm?.length ? rm.map((r) => `${r.name} ${r.private_gib} GiB private (peak working set ${r.peak_working_set_gib} GiB)`).join('; ') : null,
    system_ram: ram ? `${ram.total_gib} GiB total, ${ram.free_gib} GiB free at sample` : null,
    cpu: cpu?.length ? cpu.map((c) => `${c.name} (${c.cores}C/${c.threads}T)`).join(' + ') : null,
    storage: st?.disks?.length ? `${st.disks.map((d) => `${d.name} ${d.media}/${d.bus} ${d.size_gib} GiB`).join(' + ')}; C: free ${st.c_free_gib} GiB` : null,
    power_source: pw?.source ?? null,
    ollama_version: ol?.version ?? null,
  };
}
export function summarizePerf(r) {
  if (!r) return null;
  const q = r.requests ?? {};
  return {
    perf_label: r.label ?? null,
    model_load_s: r.model_load_s?.length ? r.model_load_s.join(', ') : 'none inside the window (model already loaded)',
    first_token_s: q.first_token_s ? `p50 ${q.first_token_s.p50} / p90 ${q.first_token_s.p90} / max ${q.first_token_s.max}` : null,
    decode_tok_s: q.decode_tok_s ?? null,
    prefill_tok_s_est: q.prefill_tok_s ?? null,
    request_s: q.request_s ? `p50 ${q.request_s.p50} / p90 ${q.request_s.p90} / max ${q.request_s.max}` : null,
    requests: q.requests !== undefined ? `${q.requests} (ok ${q.requests_ok}, non-200 ${q.requests_non200}, incomplete ${q.requests_incomplete})` : null,
    timeout_rate: r.outcomes ? `${r.outcomes.timeout_rate} (${r.outcomes.TIMEOUT}/${r.outcomes.tasks})${r.outcomes.legacy ? ' legacy results.json' : ''}` : null,
    task_completion_rate: r.outcomes ? `${r.outcomes.completion_rate} (${r.outcomes.PASS}/${r.outcomes.tasks})` : null,
  };
}

const FIELDS = [
  ['gpu_name', 'GPU name'], ['gpu_vram', 'VRAM'], ['gpu_driver', 'GPU driver'], ['gpu_runtime', 'GPU runtime'], ['gpu_visible_to_ollama', 'GPU visible to Ollama'],
  ['model', 'model (loaded)'], ['placement', 'placement'], ['model_gpu_layers', 'model GPU layers'], ['model_memory', 'model memory'], ['kv_cache_memory', 'KV-cache memory'],
  ['compute_buffers', 'compute buffers'], ['runner_private_memory', 'runner memory'], ['system_ram', 'system RAM'], ['cpu', 'CPU'], ['storage', 'storage'], ['power_source', 'power source'], ['ollama_version', 'Ollama'],
  ['perf_label', 'performance run'], ['model_load_s', 'model load time (s)'], ['first_token_s', 'first-token latency (s)'], ['decode_tok_s', 'tokens/s (decode, aggregate)'], ['prefill_tok_s_est', 'prefill tokens/s (estimate)'],
  ['request_s', 'total request duration (s)'], ['requests', 'requests'], ['timeout_rate', 'timeout rate'], ['task_completion_rate', 'task completion rate'],
];
export function render({ baseline, future }) {
  const cell = (o, k) => (o && o[k] !== null && o[k] !== undefined && o[k] !== '' ? String(o[k]).replace(/\|/g, '/') : NM);
  const rows = FIELDS.map(([k, label]) => `| ${label} | ${cell(baseline, k)} | ${future ? cell(future, k) : NM} |`);
  return ['| measurement | CURRENT MEASURED BASELINE | FUTURE HARDWARE MEASUREMENTS |', '|---|---|---|', ...rows].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const one = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (!one('baseline-hw')) { console.error('usage: hwreport.mjs --baseline-hw f [--baseline-perf f] [--future-hw f] [--future-perf f] [--out f]'); process.exit(2); }
  const b = { ...summarizeProfile(readJson(one('baseline-hw'))), ...(one('baseline-perf') ? summarizePerf(readJson(one('baseline-perf'))) : {}) };
  const f = one('future-hw') || one('future-perf') ? { ...(one('future-hw') ? summarizeProfile(readJson(one('future-hw'))) : {}), ...(one('future-perf') ? summarizePerf(readJson(one('future-perf'))) : {}) } : null;
  const md = render({ baseline: b, future: f });
  if (one('out')) fs.writeFileSync(one('out'), md + '\n');
  console.log(md);
}
