// Offline tests for evals/bench/dgate.mjs (read-only D gate evaluator; both gates PROPOSED, not approved).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateA, gateB, dPreflight } from '../bench/dgate.mjs';

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

const cRuns = [R('C1-contain', 'contain', 'PASS PASS'), R('C1-control', 'control', 'PASS FAIL'), R('C2-contain', 'contain', 'PASS PASS'),
  R('C2-control', 'control', 'PASS PASS'), R('C3-contain', 'contain', 'PASS PASS'), R('C3-control', 'control', 'PASS PASS')];
const C_FINAL = 'COMPLETE (2026-10-05) - VALID - FINAL EVIDENCE; DECISION RULE NOT MET';
const PRE = { tasks: ['T01'], reps: 1, order: 'suite order', timeouts: 'tasks.json unchanged', decision_rule: ['x'], evidence_dir: 'C:/x/cycle11-D' };
test('D preflight: the committed state (no approval, template pre-registration) is BLOCKED', () => {
  const r = dPreflight({ phases: { C_rebaseline: { status: C_FINAL }, D_gate: { preregistration_template: PRE } } }, cRuns);
  assert.equal(r.ready, false); assert.ok(r.reasons.some((x) => /no human approval/.test(x))); assert.ok(r.reasons.some((x) => /not pre-registered/.test(x)));
});
test('D preflight: Gate A approved is still BLOCKED by C NOT MET', () => {
  const r = dPreflight({ phases: { C_rebaseline: { status: C_FINAL }, D_gate: { approval: { gate: 'A', approved_by: 'user', date: '2026-10-06' }, preregistration: PRE } } }, cRuns);
  assert.equal(r.ready, false); assert.ok(r.reasons.some((x) => /Gate A not met/.test(x)));
});
test('D preflight: Gate B needs criterion_text; with it and a full pre-registration -> READY', () => {
  const plan = (ap, pre = PRE) => ({ phases: { C_rebaseline: { status: C_FINAL }, D_gate: { approval: ap, preregistration: pre } } });
  assert.equal(dPreflight(plan({ gate: 'B', approved_by: 'user', date: '2026-10-06' }), cRuns).ready, false);
  assert.equal(dPreflight(plan({ gate: 'B', approved_by: 'user', date: '2026-10-06', criterion_text: 'B1+B2+B3 as in D-GATES.md' }), cRuns).ready, true);
  assert.equal(dPreflight(plan({ gate: 'B', approved_by: 'user', date: '2026-10-06', criterion_text: 'ok' }, { ...PRE, decision_rule: 'TEMPLATE' }), cRuns).ready, false);
  assert.equal(dPreflight(plan({ gate: 'C', approved_by: 'user', date: '2026-10-06' }), cRuns).ready, false);
  assert.equal(dPreflight(plan({ gate: 'B', approved_by: '<name>', date: '2026-10-06', criterion_text: 'ok' }), cRuns).ready, false);
});
test('reduced.sh refuses a D label before creating anything (unapproved PLAN via DGATE_PLAN)', () => {
  const out = path.join(os.tmpdir(), `dguard-${process.pid}`);
  const plan = path.join(os.tmpdir(), `dguard-plan-${process.pid}.yaml`);
  fs.writeFileSync(plan, 'phases:\n  C_rebaseline: { status: "COMPLETE - DECISION RULE NOT MET" }\n  D_gate: {}\n');
  const sh = fileURLToPath(new URL('../bench/reduced.sh', import.meta.url));
  for (const label of ['D1-contain:contain', 'd2-control:control', 'D-x:contain']) {
    const r = spawnSync('bash', [sh, '--out', out, label], { encoding: 'utf8', env: { ...process.env, NODE_BIN: process.execPath.split(path.sep).join('/'), DGATE_PLAN: plan } });
    assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`); assert.match(r.stdout + r.stderr, /D BLOCKED|refusing D run/);
    assert.ok(!fs.existsSync(out), 'no output dir created');
  }
});
