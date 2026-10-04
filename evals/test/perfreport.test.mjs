// Tests for evals/bench/perfreport.mjs (fixtures shaped like real meter.jsonl / results.json / server.log lines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStats, outcomeStats, modelLoads, sampleStats, table } from '../bench/perfreport.mjs';

const req = (id, ttfb, total, prompt, cached, comp, extra = {}) => ({ id, status: 200, ttfb_ms: ttfb, total_ms: total, done_marker: true, usage: { prompt_tokens: prompt, prompt_tokens_details: { cached_tokens: cached }, completion_tokens: comp }, ...extra });
test('requestStats: aggregate decode/prefill, percentiles, failures counted separately', () => {
  const s = requestStats([
    { start: 'x', listen: 'y' },                         // meter header line: not a request
    req(1, 10000, 20000, 1000, 0, 50),                   // decode 50 tok / 10 s
    req(2, 30000, 60000, 3000, 1000, 150),               // decode 150 tok / 30 s
    { id: 3, status: 500, ttfb_ms: 5, total_ms: 6 },
    { id: 4, status: 200, ttfb_ms: 1, total_ms: 2, done_marker: false },   // incomplete, no usage
  ]);
  assert.equal(s.requests, 4); assert.equal(s.requests_ok, 2); assert.equal(s.requests_non200, 1); assert.equal(s.requests_incomplete, 1);
  assert.equal(s.decode_tok_s, 5);                       // 200 tok / 40 s
  assert.equal(s.prefill_tok_s, 3000 / 40);              // (1000 + 2000) new prompt tokens / 40 s of ttfb
  assert.deepEqual(s.first_token_s, { p50: 30, p90: 30, max: 30 });
  assert.deepEqual(s.context_tokens, { p50: 3000, max: 3000 });
});
test('requestStats: empty input gives nulls, not NaN', () => {
  const s = requestStats([]);
  assert.equal(s.decode_tok_s, null); assert.equal(s.first_token_s.p50, null);
});
test('outcomeStats: new results use outcome; legacy results are flagged, not reclassified silently', () => {
  const o = outcomeStats([{ outcome: 'PASS' }, { outcome: 'TIMEOUT', graderPass: true }, { outcome: 'FAIL' }, { outcome: 'SETUP_FAILED' }, { outcome: 'ENV_CONTAMINATED' }]);
  assert.deepEqual([o.tasks, o.PASS, o.FAIL, o.TIMEOUT, o.OTHER, o.legacy], [4, 1, 1, 1, 1, false]);
  assert.equal(o.timeout_rate, 0.25); assert.equal(o.completion_rate, 0.25);
  const l = outcomeStats([{ pass: true, timedOut: true, env: 'CLEAN' }, { pass: true, timedOut: false, env: 'CLEAN' }]);
  assert.equal(l.legacy, true); assert.equal(l.TIMEOUT, 1); assert.equal(l.PASS, 1);
});
test('modelLoads: pairs loading -> loaded inside the window only', () => {
  const log = [
    'time=2026-10-04T12:22:50.452-05:00 level=INFO source=llama_server.go:1054 msg="loading model via llama-server" model=x',
    'load_tensors:   CPU_REPACK model buffer size = 13432.50 MiB',
    'time=2026-10-04T12:23:19.088-05:00 level=INFO source=sched.go:733 msg="loaded runners" count=1',
    'time=2026-10-04T15:00:00.000-05:00 level=INFO msg="loading model via llama-server" model=x',
    'time=2026-10-04T15:00:10.000-05:00 level=INFO msg="loaded runners" count=1',
  ].join('\r\n');
  assert.deepEqual(modelLoads(log, Date.parse('2026-10-04T12:00:00-05:00'), Date.parse('2026-10-04T13:00:00-05:00')), [28.64]);
});
test('sampleStats: GPU columns optional', () => {
  const cpuOnly = sampleStats('time,cpu_pct,gpu_util_pct,gpu_mem_used_mib,gpu_mem_total_mib\n2026-10-04T12:00:00,50,,,\n2026-10-04T12:00:05,90,,,\n');
  assert.deepEqual(cpuOnly.cpu_pct, { p50: 90, max: 90 }); assert.equal(cpuOnly.gpu_util_pct, null);
  const gpu = sampleStats('h\nt,10,80,12000,16384\nt,20,95,12500,16384\n');
  assert.deepEqual(gpu.gpu_util_pct, { p50: 95, max: 95 }); assert.deepEqual(gpu.gpu_mem_used_mib, { p50: 12500, max: 12500 });
});
test('table renders every row for two reports without thresholds', () => {
  const rep = (label) => ({ label, hardware: null, model_load_s: [], requests: requestStats([req(1, 1000, 2000, 10, 0, 5)]), outcomes: null, samples: null });
  const t = table([rep('cpu'), rep('gpu')]);
  assert.match(t, /^\| metric \| cpu \| gpu \|/); assert.doesNotMatch(t, /PASS\b.*threshold|target/i);
  assert.equal(t.split('\n').length, 2 + 14);
});
