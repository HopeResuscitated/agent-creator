import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../utils/duration.ts';

const ok: Array<[string, number]> = [
  ['45s', 45], ['2m', 120], ['1h30m', 5400], ['2d', 172800], ['1h 5m 10s', 3910], ['1H30M', 5400],
];
for (const [input, want] of ok) {
  test(`hidden: ${input} -> ${want}`, () => assert.equal(parseDuration(input), want));
}
for (const bad of ['', 'abc', '10x', 'h', '5']) {
  test(`hidden: rejects '${bad}'`, () => assert.throws(() => parseDuration(bad)));
}
