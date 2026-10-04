// Offline tests for evals/bench/quanttrial.mjs: classification, summary rules, model state, and an end-to-end CLI run
// against a fake Ollama (checks request construction: only `model` is replaced; order is deterministic).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, summarize, modelState, MALFORMED } from '../bench/quanttrial.mjs';

const QT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'quanttrial.mjs');
const sse = (...objs) => objs.map((o) => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`).join('');
const ch = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
const usage = (p, c, cached = 0) => ({ choices: [], usage: { prompt_tokens: p, completion_tokens: c, prompt_tokens_details: { cached_tokens: cached } } });
const ok = (buf) => ({ status: 200, buf, ttfb: 1000, total: 3000 });

test('classify: every class', () => {
  assert.equal(classify(ok(sse(ch({ content: 'hi' }), ch({}, 'stop'), usage(10, 2), '[DONE]'))).cls, 'complete');
  assert.equal(classify(ok(sse(ch({ content: 'hi' }), ch({ content: '' })))).cls, 'eof_no_finish');
  assert.equal(classify({ status: 500, buf: '{"error":{"message":"XML syntax error on line 5"}}', ttfb: 5, total: 6 }).cls, 'http_500_parse');
  assert.equal(classify({ status: 500, buf: 'out of memory', ttfb: 5, total: 6 }).cls, 'http_other');
  assert.equal(classify(ok(sse(ch({ content: 'x <function=write>' }), ch({}, 'stop'), '[DONE]'))).cls, 'tool_xml_in_text');
  assert.equal(classify(ok(sse(ch({ tool_calls: [{ index: 0, function: { name: 'write', arguments: '{"a":' } }] }), ch({}, 'tool_calls'), '[DONE]'))).cls, 'bad_tool_args');
  assert.equal(classify(ok(sse(ch({ tool_calls: [{ index: 0, function: { name: 'write', arguments: '[1]' } }] }), ch({}, 'tool_calls'), '[DONE]'))).cls, 'bad_tool_args');
  assert.equal(classify({ status: 0, buf: '', ttfb: 0, total: 900000, timeout: true }).cls, 'timeout');
  assert.equal(classify({ status: 0, buf: '', ttfb: 0, total: 5, error: 'ECONNREFUSED' }).cls, 'error');
});
test('classify: a transport failure after the 200 status is stream_error, NOT a malformed call', () => {
  const r = classify({ status: 200, buf: sse(ch({ content: 'partial' })), ttfb: 1000, total: 2000, error: 'Error: aborted' });
  assert.equal(r.cls, 'stream_error'); assert.equal(MALFORMED.has(r.cls), false);
});
test('classify: edits-as-string flagged; cached tokens recorded', () => {
  const r = classify(ok(sse(ch({ tool_calls: [{ index: 0, function: { name: 'edit', arguments: JSON.stringify({ file_path: 'f', edits: '[]' }) } }] }), ch({}, 'tool_calls'), usage(100, 5, 60), '[DONE]')));
  assert.equal(r.cls, 'complete'); assert.equal(r.edits_as_string, true); assert.equal(r.cached_tokens, 60); assert.equal(r.prompt_tokens, 100);
});
test('summarize: timeouts/errors/stream errors and a cold first request do not enter median ttfb', () => {
  const rows = [
    { cls: 'complete', status: 200, ttfb_ms: 90000, total_ms: 95000, prompt_tokens: 100, cached_tokens: 0, completion_tokens: 10 }, // cold first
    { cls: 'complete', status: 200, ttfb_ms: 2000, total_ms: 4000, prompt_tokens: 100, cached_tokens: 50, completion_tokens: 10 },
    { cls: 'complete', status: 200, ttfb_ms: 4000, total_ms: 6000, prompt_tokens: 100, cached_tokens: 0, completion_tokens: 10 },
    { cls: 'timeout', status: 0, ttfb_ms: 0, total_ms: 900000 },
    { cls: 'error', status: 0, ttfb_ms: 0, total_ms: 3 },
    { cls: 'stream_error', status: 200, ttfb_ms: 100, total_ms: 200 },
    { cls: 'eof_no_finish', status: 200, ttfb_ms: 3000, total_ms: 3500 },
  ];
  const cold = summarize(rows, { model: 'm', requests_unique: 7, reps: 1, start: { loaded: false, placement: null } });
  assert.equal(cold.ttfb_samples, 3); assert.equal(cold.median_ttfb_s, 3); assert.equal(cold.cold_first_request_ttfb_s, 90);
  assert.equal(cold.malformed, 1); assert.equal(cold.n, 7);
  assert.deepEqual(cold.prefix_cache, { rows_with_usage: 3, rows_cached_gt0: 1, cached_share: 50 / 300 });
  const warm = summarize(rows, { model: 'm', requests_unique: 7, reps: 1, start: { loaded: true, placement: '100% CPU' } });
  assert.equal(warm.ttfb_samples, 4); assert.equal(warm.cold_first_request_ttfb_s, null);
});
test('modelState: loaded / not loaded / placement', () => {
  const ps = { models: [{ name: 'hermes-local-32k:latest', size: 100, size_vram: 0, digest: 'd', context_length: 32768 }, { name: 'g:latest', size: 100, size_vram: 100 }, { name: 'h:latest', size: 100, size_vram: 40 }] };
  assert.deepEqual(modelState(ps, 'hermes-local-32k'), { loaded: true, placement: '100% CPU', digest: 'd', context_length: 32768 });
  assert.equal(modelState(ps, 'g').placement, '100% GPU'); assert.equal(modelState(ps, 'h').placement, '40% GPU');
  assert.equal(modelState(ps, 'other').loaded, false); assert.equal(modelState(null, 'x').loaded, null);
});

test('CLI end to end against a fake Ollama: model replaced, nothing else changed, deterministic order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-test-'));
  try {
    const reqDir = path.join(dir, 'raw'); fs.mkdirSync(path.join(reqDir, 'sub'), { recursive: true });
    const bodies = [0, 1, 2].map((i) => ({ model: 'old-model', stream: true, messages: [{ role: 'user', content: `task ${i}` }], tools: [{ type: 'function', function: { name: 'write' } }], stream_options: { include_usage: true } }));
    bodies.forEach((b, i) => fs.writeFileSync(path.join(reqDir, i === 2 ? 'sub' : '.', `${i}.req.json`), JSON.stringify(b)));
    fs.writeFileSync(path.join(reqDir, 'dup.req.json'), JSON.stringify(bodies[0]));          // byte-identical duplicate
    const seen = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        if (req.url === '/api/ps') { res.end(JSON.stringify({ models: [] })); return; }
        seen.push(JSON.parse(b));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sse(ch({ content: 'ok' }), ch({}, 'stop'), usage(10, 2), '[DONE]'));
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const out = path.join(dir, 'res.jsonl');
    const p = spawn(process.execPath, [QT, '--model', 'new-model', '--requests', reqDir, '--out', out, '--reps', '2', '--upstream', `127.0.0.1:${srv.address().port}`], { stdio: 'pipe' });
    let so = ''; p.stdout.on('data', (c) => (so += c));
    const code = await new Promise((r) => p.on('close', r)); srv.close();
    assert.equal(code, 0, so);
    assert.match(so, /requests: 4 files, 3 unique, using 3 x 2 reps/);
    assert.match(so, /model at start: \{"loaded":false/);
    assert.equal(seen.length, 6);
    for (const s of seen) { assert.equal(s.model, 'new-model'); const orig = bodies.find((b) => b.messages[0].content === s.messages[0].content); assert.deepEqual({ ...s, model: 'old-model' }, orig); }
    const order = seen.map((s) => s.messages[0].content);
    assert.deepEqual(order.slice(0, 3), order.slice(3));                                          // rep 2 = same order
    const sum = JSON.parse(fs.readFileSync(out + '.summary.json', 'utf8'));
    assert.equal(sum.n, 6); assert.equal(sum.counts.complete, 6); assert.equal(sum.malformed, 0); assert.equal(sum.model_at_start.loaded, false);
    assert.equal(fs.readFileSync(out, 'utf8').trim().split('\n').length, 6);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
