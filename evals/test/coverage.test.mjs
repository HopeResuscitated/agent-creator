// Tests for evals/bench/coverage.mjs (labels as recorded, mode/class mapping, matrix selection).
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedLabel, modeOf, classOf, matrix } from '../bench/coverage.mjs';

test('labels are shown as recorded, never reclassified', () => {
  assert.equal(recordedLabel({ pass: true, timedOut: true, env: 'CLEAN' }), 'PASS(to)');
  assert.equal(recordedLabel({ pass: false, timedOut: false, env: 'CLEAN' }), 'FAIL');
  assert.equal(recordedLabel({ pass: false, env: 'ENV_CONTAMINATED', graderPass: true }), 'ENV_CONTAMINATED(grader PASS)');
  assert.equal(recordedLabel({ outcome: 'TIMEOUT', graderPass: true }), 'TIMEOUT(grader PASS)');
  assert.equal(recordedLabel({ outcome: 'PASS' }), 'PASS');
});
test('mode from baseline.txt containment line', () => {
  assert.equal(modeOf('containment: appcontainer+acl+broker upstream=x'), 'contained');
  assert.equal(modeOf('containment: OFF config-equivalent control upstream=x (direct)'), 'control');
  assert.equal(modeOf('containment: OFF (--no-contain-unsafe --control-user-config)'), 'control-userconfig');
  assert.equal(modeOf(''), 'unknown');
});
test('evidence class follows PLAN.yaml evidence_classes', () => {
  for (const f of ['cycle9/a2val3-VALID', 'cycle9/b6-phaseB-AC', 'cycle9/final-regression', 'cycle9/pre-c-prep']) assert.equal(classOf(f), 'authoritative', f);
  for (const f of ['cycle9/b5-phaseB', 'cycle6/ev-C1', 'cycle8/ev-R-D']) assert.equal(classOf(f), 'historical', f);
  assert.equal(classOf('cycle9/contaminated-run1'), 'historical-contaminated');
  assert.equal(classOf(null), 'not-evidence');
});
test('matrix: pin columns use only evidence runs on the current pin; contaminated and ad-hoc runs never count', () => {
  const P = 'p'.repeat(64);
  const rows = [
    { dir: '2026-10-01-00-00_x', task: 'T05', sha: 'o'.repeat(64), mode: 'contained', label: 'PASS', cls: 'historical' },
    { dir: '2026-10-02-00-00_x', task: 'T05', sha: P, mode: 'contained', label: 'PASS(to)', cls: 'authoritative' },
    { dir: '2026-10-03-00-00_x', task: 'T05', sha: P, mode: 'contained', label: 'FAIL', cls: 'historical-contaminated' },
    { dir: '2026-10-04-00-00_x', task: 'T05', sha: P, mode: 'control', label: 'PASS', cls: 'not-evidence' },
  ];
  const [m] = matrix(rows, { pinSha: P, cTasks: ['T05'], tasks: ['T05'] });
  assert.match(m.pin_contained, /^PASS\(to\) \(2026-10-02/);
  assert.equal(m.pin_control, 'not run');
  assert.match(m.last_any, /^2026-10-02/);
  assert.equal(m.in_C, 'yes'); assert.match(m.in_D_proposal, /PROPOSED, not approved/);
  const [n] = matrix(rows, { pinSha: P, cTasks: [], tasks: ['T02'] });
  assert.equal(n.last_any, 'never'); assert.equal(n.post_a2_required, 'only if the D proposal is adopted');
});
