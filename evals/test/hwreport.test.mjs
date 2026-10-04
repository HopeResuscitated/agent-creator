// hwreport.mjs: parsing of llama.cpp load lines / Ollama compute lines, and NOT MEASURED instead of guesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseBuffers, parseCompute, summarizeProfile, summarizePerf, render } from '../bench/hwreport.mjs';

const EVALS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rj = (f) => JSON.parse(fs.readFileSync(path.join(EVALS, f), 'utf8').replace(/^\uFEFF/, ''));

test('baseline (CPU) profile: the measured values, 0 GPU layers, nothing invented', () => {
  const s = summarizeProfile(rj('perf/cpu-baseline-hwprofile.json'));
  assert.equal(s.placement, '100% CPU');
  assert.equal(s.model_gpu_layers, '0 (no GPU buffers in the newest load)');
  assert.match(s.kv_cache_memory, /^1632 MiB \(q8_0, 32768 cells, 48 layers\) on CPU$/);
  assert.match(s.model_memory, /^GPU 0 MiB, CPU 17691 MiB/);
  assert.match(s.gpu_visible_to_ollama, /Vulkan .*860M.*iGPU/);
  const p = summarizePerf(rj('perf/cpu-baseline-b6-contained.json'));
  assert.equal(p.decode_tok_s, 4.51);
  assert.match(p.first_token_s, /max 273.65/);
});

test('future NVIDIA fixture: layers, per-device memory, runtime, VRAM from nvidia-smi', () => {
  const h = { taken: 'x', nvidia: { cuda_driver_api: '12.8', gpus: [{ name: 'NVIDIA GeForce RTX 0000', memory_total_mib: 24564, driver: '570.00' }] },
    ollama: { version: '0.34.4', loaded: [{ name: 'hermes-local-32k:latest', quant: 'Q4_K_M', context_length: 32768, digest: 'f'.repeat(64), placement: '100% GPU' }],
      inference_compute: ['msg="inference compute" id=GPU-1 library=CUDA compute=8.9 name=CUDA0 description="NVIDIA GeForce RTX 0000" driver=12.8 type=discrete total="24.0 GiB" available="22.9 GiB"'],
      newest_load_buffers: ['load_tensors: offloaded 49/49 layers to GPU', 'load_tensors:        CUDA0 model buffer size = 17000.00 MiB', 'load_tensors:   CPU_Mapped model buffer size =   166.92 MiB',
        'llama_kv_cache:      CUDA0 KV buffer size =  1632.00 MiB', 'llama_kv_cache: size = 1632.00 MiB ( 32768 cells,  48 layers,  1/1 seqs), K (q8_0):  816.00 MiB, V (q8_0):  816.00 MiB', 'sched_reserve:      CUDA0 compute buffer size =   300.75 MiB'] } };
  const s = summarizeProfile(h);
  assert.equal(s.gpu_name, 'NVIDIA GeForce RTX 0000'); assert.equal(s.gpu_vram, '24564 MiB'); assert.equal(s.gpu_driver, '570.00');
  assert.match(s.gpu_runtime, /CUDA driver API 12.8; Ollama library=CUDA/);
  assert.equal(s.model_gpu_layers, '49/49 offloaded to GPU');
  assert.equal(s.model_memory, 'GPU 17000 MiB, CPU 167 MiB (weights buffers)');
  assert.match(s.kv_cache_memory, /on CUDA0$/);
  assert.equal(s.compute_buffers, 'CUDA0 300.75 MiB');
  assert.equal(s.system_ram, null); assert.equal(s.storage, null);   // not in the fixture: NOT MEASURED, not guessed
  const md = render({ baseline: s, future: null });
  assert.match(md, /\| system RAM \| NOT MEASURED \| NOT MEASURED \|/);
});

test('hwprofile Try-Get failure shapes and missing sections render NOT MEASURED', () => {
  const s = summarizeProfile({ nvidia: { value: null, reason: 'nvidia-smi not on PATH' }, ollama: { value: null, reason: 'unavailable' }, ram: { value: null, reason: 'x' } });
  for (const k of ['gpu_name', 'gpu_vram', 'placement', 'model_gpu_layers', 'kv_cache_memory', 'system_ram']) assert.equal(s[k], null, k);
  assert.equal(summarizeProfile(null), null); assert.equal(summarizePerf(null), null);
  assert.ok(!render({ baseline: s, future: null }).includes('undefined'));
});

test('parseCompute / parseBuffers edge cases', () => {
  assert.deepEqual(parseCompute(['library=ROCm name=ROCm0 description="AMD Radeon RX" type=discrete total="16.0 GiB" available="15.5 GiB"'])[0], { library: 'ROCm', name: 'ROCm0', description: 'AMD Radeon RX', type: 'discrete', total: '16.0 GiB', available: '15.5 GiB', driver: null });
  const b = parseBuffers(['load_tensors: offloaded 30/49 layers to GPU', 'load_tensors: ROCm0 model buffer size = 10000.00 MiB', 'load_tensors: CPU model buffer size = 7000.00 MiB']);
  assert.deepEqual(b.layers, { offloaded: 30, total: 49 }); assert.equal(b.devices.ROCm0.model_mib, 10000); assert.equal(b.kv, null);
});

test('committed HARDWARE-REPORT.md matches the generator on the committed baseline files', () => {
  const md = render({ baseline: { ...summarizeProfile(rj('perf/cpu-baseline-hwprofile.json')), ...summarizePerf(rj('perf/cpu-baseline-b6-contained.json')) }, future: null });
  const doc = fs.readFileSync(path.join(EVALS, 'perf', 'HARDWARE-REPORT.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(doc.includes(md), 'regenerate the table in evals/perf/HARDWARE-REPORT.md');
});
