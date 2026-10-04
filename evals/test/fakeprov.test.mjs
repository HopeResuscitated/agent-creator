// Offline tests for the fake-provider tooling (no jcode run).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configToml, R } from '../bench/fakeprov.mjs';

const BENCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bench');
test('fakeprov config is byte-identical to editstring.mjs (validated re-pin tool) for the same port', () => {
  const src = fs.readFileSync(path.join(BENCH, 'editstring.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const m = /fs\.writeFileSync\(path\.join\(home, 'config\.toml'\), `([\s\S]*?)`\);/.exec(src);
  assert.ok(m, 'editstring config template not found');
  assert.equal(m[1].replace('${port}', '4242'), configToml(4242));
});
test('both fake-provider tools opt out of jcode telemetry', () => {
  for (const f of ['editstring.mjs', 'fakeprov.mjs']) assert.match(fs.readFileSync(path.join(BENCH, f), 'utf8'), /JCODE_NO_TELEMETRY: '1', DO_NOT_TRACK: '1'/, f);
});
const events = (body) => body.split('\n\n').filter(Boolean).map((e) => e.replace(/^data: /, ''));
test('stream shapes', () => {
  assert.equal(events(R.complete('x').body).at(-1), '[DONE]');
  assert.notEqual(events(R.textEof('x').body).at(-1), '[DONE]');
  assert.notEqual(events(R.ollamaRejected('x').body).at(-1), '[DONE]');
  const split = events(R.toolSplit('c', 'write', { file_path: 'f', content: 'abc' }, 3).body).slice(0, -2).map((e) => JSON.parse(e));
  const args = split.map((c) => c.choices[0].delta.tool_calls[0].function.arguments).join('');
  assert.deepEqual(JSON.parse(args), { file_path: 'f', content: 'abc' });
  assert.ok(split.length >= 4);
  const two = JSON.parse(events(R.tools([{ id: 'a', name: 'write', args: {} }, { id: 'b', name: 'write', args: '{bad' }]).body)[0]);
  assert.deepEqual(two.choices[0].delta.tool_calls.map((t) => [t.index, t.id, t.function.arguments]), [[0, 'a', '{}'], [1, 'b', '{bad']]);
});
