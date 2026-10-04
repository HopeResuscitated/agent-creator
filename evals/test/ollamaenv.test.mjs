// Tests for evals/bench/ollamaenv.mjs (server-config parsing). Lines follow Ollama 0.34.4's server.log format.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServerConfigs, material, diff, MATERIAL } from '../bench/ollamaenv.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const line = (time, kv) => `time=${time} level=INFO source=routes.go:2005 msg="server config" env="map[CUDA_VISIBLE_DEVICES: GGML_VK_VISIBLE_DEVICES: HIP_VISIBLE_DEVICES: OLLAMA_CONTEXT_LENGTH:${kv.ctx} OLLAMA_FLASH_ATTENTION:${kv.fa} OLLAMA_HOST:http://127.0.0.1:11434 OLLAMA_IGPU_ENABLE:1 OLLAMA_KEEP_ALIVE:30m0s OLLAMA_KV_CACHE_TYPE:${kv.kv} OLLAMA_MODELS:C:\\\\Users\\\\cierra\\\\.ollama\\\\models OLLAMA_NUM_PARALLEL:1 OLLAMA_ORIGINS:[http://localhost https://localhost app://*] OLLAMA_REMOTES:[ollama.com] OLLAMA_VULKAN:true ROCR_VISIBLE_DEVICES:]"`;
const LOG = [
  line('2026-09-27T02:22:41.338-05:00', { ctx: 0, fa: 'false', kv: '' }),
  'time=2026-09-27T02:22:42 level=INFO msg="inference compute" library=cpu',
  line('2026-09-28T23:40:40.066-05:00', { ctx: 32768, fa: 'true', kv: 'q8_0' }),
].join('\r\n');

test('parses every server-config line, newest last', () => {
  const all = parseServerConfigs(LOG);
  assert.equal(all.length, 2);
  assert.equal(all[1].time, '2026-09-28T23:40:40.066-05:00');
  assert.equal(all[1].env.OLLAMA_KV_CACHE_TYPE, 'q8_0');
  assert.equal(all[0].env.OLLAMA_KV_CACHE_TYPE, '');
  assert.equal(all[1].env.OLLAMA_ORIGINS, '[http://localhost https://localhost app://*]');
  assert.equal(all[1].env.ROCR_VISIBLE_DEVICES, '');
});
test('material subset marks keys missing from the line as (absent)', () => {
  const m = material(parseServerConfigs(LOG)[1].env);
  assert.deepEqual(Object.keys(m), MATERIAL);
  assert.equal(m.OLLAMA_FLASH_ATTENTION, 'true'); assert.equal(m.OLLAMA_SCHED_SPREAD, '(absent)');
});
test('diff reports changed material keys only', () => {
  const [old, cur] = parseServerConfigs(LOG).map((c) => material(c.env));
  assert.deepEqual(diff(cur, cur), []);
  const d = diff(old, cur);
  assert.ok(d.some((x) => x.startsWith('OLLAMA_KV_CACHE_TYPE:')));
  assert.ok(d.some((x) => x.startsWith('OLLAMA_FLASH_ATTENTION:')));
  assert.ok(d.some((x) => x.startsWith('OLLAMA_CONTEXT_LENGTH:')));
  assert.equal(d.length, 3);
});
test('no server-config line -> empty', () => { assert.deepEqual(parseServerConfigs('time=x level=INFO msg="listening"'), []); });
test('the committed observation covers every MATERIAL key', () => {
  const o = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'bench', 'ollama-server-env.observed.json'), 'utf8'));
  assert.match(o.status, /OBSERVED, NOT PINNED/);
  assert.deepEqual(Object.keys(o.material), MATERIAL);
  assert.equal(o.material.OLLAMA_KV_CACHE_TYPE, 'q8_0');
});
