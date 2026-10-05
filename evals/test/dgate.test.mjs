// Offline tests for evals/bench/dgate.mjs (read-only D gate evaluator; both gates PROPOSED, not approved).
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateA, gateB } from '../bench/dgate.mjs';

test('gate A: met only when the C status says DECISION RULE MET (not NOT MET)', () => {
  assert.equal(gateA('COMPLETE (2026-10-05) - VALID - FINAL EVIDENCE; DECISION RULE NOT MET: 4 of 5').met, false);
  assert.equal(gateA('COMPLETE - DECISION RULE MET').met, true);
  assert.equal(gateA('NOT STARTED').met, false); assert.equal(gateA(undefined).met, false);
});
const R = (label, mode, s) => ({ label, mode, outcomes: Object.fromEntries(s.split(' ').map((o, i) => [`T0${i + 1}`, o])) });
test('gate B: C-like pattern (control-only misses) has no regression and same-mode 4/48', () => {
  const runs = [R('C1-contain', 'contain', 'PASS PASS TIMEOUT PASS'), R('C1-control', 'control', 'PASS FAIL TIMEOUT PASS'),
    R('C2-contain', 'contain', 'PASS PASS TIMEOUT PASS'), R('C2-control', 'control', 'PASS PASS TIMEOUT PASS'),
    R('C3-contain', 'contain', 'PASS PASS TIMEOUT PASS'), R('C3-control', 'control', 'TIMEOUT PASS TIMEOUT PASS')];
  const r = gateB(runs);
  assert.deepEqual(r.regressions, []); assert.equal(r.diff, 4); assert.equal(r.pairs, 24); assert.equal(r.met, true);
});
test('gate B: contained majority not-PASS vs control majority PASS is a regression; TIMEOUT never counts as PASS', () => {
  const runs = [R('a-contain', 'contain', 'TIMEOUT PASS'), R('b-contain', 'contain', 'FAIL PASS'), R('c-contain', 'contain', 'PASS PASS'),
    R('a-control', 'control', 'PASS PASS'), R('b-control', 'control', 'PASS PASS'), R('c-control', 'control', 'TIMEOUT PASS')];
  const r = gateB(runs); assert.deepEqual(r.regressions, ['T01']); assert.equal(r.met, false);
});
test('gate B: both modes required; same-mode > 25% fails', () => {
  assert.equal(gateB([R('a-contain', 'contain', 'PASS')]).met, false);
  const noisy = [R('a-contain', 'contain', 'PASS FAIL'), R('b-contain', 'contain', 'FAIL PASS'), R('a-control', 'control', 'PASS FAIL'), R('b-control', 'control', 'FAIL PASS')];
  const r = gateB(noisy); assert.deepEqual(r.regressions, []); assert.equal(r.sameMode, 1); assert.equal(r.met, false);
});
