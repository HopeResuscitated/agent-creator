import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from '../utils/chunk.ts';

test('hidden: single partial group', () => {
  assert.deepEqual(chunk([1], 5), [[1]]);
});
test('hidden: size 1', () => {
  assert.deepEqual(chunk([1, 2, 3], 1), [[1], [2], [3]]);
});
test('hidden: size equals length', () => {
  assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
});
test('hidden: invalid size still throws', () => {
  assert.throws(() => chunk([1], 0));
});
