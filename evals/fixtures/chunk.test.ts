import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from '../utils/chunk.ts';

test('keeps the final partial group', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('exact multiple', () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test('empty input', () => {
  assert.deepEqual(chunk([], 3), []);
});
