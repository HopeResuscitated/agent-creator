// ollamaenv.mjs - read the RUNNING Ollama server's effective configuration from its own log (read-only).
//
//   node evals/bench/ollamaenv.mjs [--log <server.log>] [--expect <json>] [--out <file>] [--json]
//
// Ollama prints one `msg="server config" env="map[...]"` line at every server start. The newest one in server.log
// is the configuration of the running server (server.log rotates to server-1.log on restart). Of those keys,
// MATERIAL ones can change model output or timing without changing the Ollama version or the model digest
// (e.g. OLLAMA_KV_CACHE_TYPE quantizes the KV cache; OLLAMA_FLASH_ATTENTION; OLLAMA_NUM_PARALLEL splits the
// context). They are NOT in evals/baseline-env.json: recorded here as OBSERVED, not pinned (see AUDIT.md).
//
// --expect <json>: compare MATERIAL keys with a recorded observation (evals/bench/ollama-server-env.observed.json).
// Exit: 0 read (and equal to --expect if given), 1 differs from --expect, 2 cannot read/parse, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MATERIAL = ['OLLAMA_CONTEXT_LENGTH', 'OLLAMA_FLASH_ATTENTION', 'OLLAMA_KV_CACHE_TYPE', 'OLLAMA_NUM_PARALLEL',
  'OLLAMA_KEEP_ALIVE', 'OLLAMA_MAX_LOADED_MODELS', 'OLLAMA_SCHED_SPREAD', 'OLLAMA_GPU_OVERHEAD', 'OLLAMA_LLM_LIBRARY',
  'OLLAMA_VULKAN', 'OLLAMA_IGPU_ENABLE', 'CUDA_VISIBLE_DEVICES', 'HIP_VISIBLE_DEVICES', 'ROCR_VISIBLE_DEVICES',
  'GGML_VK_VISIBLE_DEVICES', 'GPU_DEVICE_ORDINAL', 'HSA_OVERRIDE_GFX_VERSION', 'OLLAMA_LOAD_TIMEOUT'];

/** Parse every server-config line; returns [{ time, env: {KEY: value} }] in file order. */
export function parseServerConfigs(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('msg="server config"')) continue;
    const time = /^time=(\S+)/.exec(line)?.[1] ?? null;
    const m = /env="map\[(.*)\]"\s*$/.exec(line); if (!m) continue;
    const env = {};
    // values never contain spaces except bracketed lists (OLLAMA_ORIGINS:[a b c]); keys are [A-Z0-9_]
    const re = /([A-Z][A-Z0-9_]*):(\[[^\]]*\]|\S*)/g;
    for (let k = re.exec(m[1]); k; k = re.exec(m[1])) env[k[1]] = k[2];
    out.push({ time, env });
  }
  return out;
}
export function material(env) { const o = {}; for (const k of MATERIAL) o[k] = env[k] ?? '(absent)'; return o; }
export function diff(have, want) {
  const d = [];
  for (const k of MATERIAL) if (k in want && have[k] !== want[k]) d.push(`${k}: running=${JSON.stringify(have[k])} observed=${JSON.stringify(want[k])}`);
  return d;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const log = flag('log') ?? path.join(process.env.LOCALAPPDATA ?? '', 'Ollama', 'server.log');
  let text; try { text = fs.readFileSync(log, 'utf8'); } catch (e) { console.log(`OLLAMAENV UNKNOWN cannot read ${log}: ${e.message}`); process.exit(2); }
  const all = parseServerConfigs(text);
  if (!all.length) { console.log(`OLLAMAENV UNKNOWN no "server config" line in ${log}`); process.exit(2); }
  const last = all[all.length - 1]; const mat = material(last.env);
  const lines = [`ollama server config (started ${last.time}; ${log}):`, ...MATERIAL.map((k) => `  ${k}=${mat[k]}`)];
  let rc = 0;
  if (flag('expect')) {
    const want = JSON.parse(fs.readFileSync(flag('expect'), 'utf8')).material;
    const d = diff(mat, want);
    lines.push(d.length ? `OLLAMAENV DIFFERS from ${flag('expect')}:\n${d.map((x) => `  ${x}`).join('\n')}` : `OLLAMAENV SAME as ${path.basename(flag('expect'))}`);
    rc = d.length ? 1 : 0;
  }
  const text2 = argv.includes('--json') ? JSON.stringify({ server_started: last.time, material: mat }, null, 1) : lines.join('\n');
  console.log(text2);
  if (flag('out')) fs.writeFileSync(flag('out'), text2 + '\n');
  process.exit(rc);
}
