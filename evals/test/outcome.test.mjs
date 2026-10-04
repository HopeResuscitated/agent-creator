// Unit tests for evals/outcome.ts (result classification). Run: "<pinned node>" --test evals/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWrapperNote, decideTimedOut, classify, skipGrading, resultLabel } from '../outcome.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const note = (exit, to, extra = 'killed=none members-left=0') => `[run-in-job 1759500000000] agent exit=${exit} timedOut=${to} ${extra}`;

test('wrapper note: normal exit', () => {
  assert.deepEqual(parseWrapperNote(`x\n${note(0, 'False')}\ny`), { agentExit: '0', timedOut: false });
});
test('wrapper note: timeout', () => {
  assert.deepEqual(parseWrapperNote(note('timeout', 'True', 'killed=1234,5678 members-left=0')), { agentExit: 'timeout', timedOut: true });
});
test('wrapper note: CRLF transcript', () => {
  assert.deepEqual(parseWrapperNote(`a\r\n${note(1, 'False')}\r\nb`), { agentExit: '1', timedOut: false });
});
test('wrapper note: missing -> null', () => {
  assert.equal(parseWrapperNote('agent printed: agent exit=0 timedOut=False (not a wrapper line)'), null);
  assert.equal(parseWrapperNote(''), null);
});
test('wrapper note: exit=timeout wins even if the flag text is odd', () => {
  assert.equal(parseWrapperNote(note('timeout', 'False')).timedOut, true);
});
test('wrapper note: duplicate lines fail toward TIMEOUT', () => {
  assert.equal(parseWrapperNote(`${note(0, 'False')}\n${note('timeout', 'True')}`).timedOut, true);
  assert.equal(parseWrapperNote(`${note('timeout', 'True')}\n${note(0, 'False')}`).timedOut, true);
});

test('timedOut: wrapper is authoritative over elapsed time', () => {
  // the historical T03 case: 901 s elapsed on a 15-min limit, but the agent exited by itself
  assert.deepEqual(decideTimedOut({ agentExit: '0', timedOut: false }, 901, 15, true), { timedOut: false, source: 'wrapper' });
  assert.deepEqual(decideTimedOut({ agentExit: 'timeout', timedOut: true }, 10, 15, true), { timedOut: true, source: 'wrapper' });
});
test('timedOut: elapsed fallback only for jcode without a note', () => {
  assert.equal(decideTimedOut(null, 896, 15, true).timedOut, true);
  assert.equal(decideTimedOut(null, 894, 15, true).timedOut, false);
  assert.equal(decideTimedOut(null, 99999, 15, false).timedOut, false);
});

test('classify: grader PASS after timeout is TIMEOUT, never PASS', () => {
  assert.deepEqual(classify({ env: 'CLEAN', graderPass: true, timedOut: true }), { outcome: 'TIMEOUT', pass: false });
  assert.deepEqual(classify({ env: 'CLEAN', graderPass: false, timedOut: true }), { outcome: 'TIMEOUT', pass: false });
});
test('classify: clean in-time runs follow the grader', () => {
  assert.deepEqual(classify({ env: 'CLEAN', graderPass: true, timedOut: false }), { outcome: 'PASS', pass: true });
  assert.deepEqual(classify({ env: 'CLEAN', graderPass: false, timedOut: false }), { outcome: 'FAIL', pass: false });
});
test('classify: non-clean env never passes, whatever the grader said', () => {
  for (const env of ['ENV_CONTAMINATED', 'ENV_RESTORE_FAILED', 'SETUP_FAILED', 'UNSAFE_PROCESS_TREE', 'AGENT_STATUS_UNKNOWN']) {
    for (const timedOut of [false, true]) {
      const c = classify({ env, graderPass: true, timedOut });
      assert.equal(c.pass, false, env); assert.equal(c.outcome, env);
    }
  }
});
test('classify: unknown env string is conservative, not CLEAN', () => {
  assert.deepEqual(classify({ env: '', graderPass: true, timedOut: false }), { outcome: 'UNSAFE_PROCESS_TREE', pass: false });
  assert.deepEqual(classify({ env: 'clean', graderPass: true, timedOut: false }), { outcome: 'UNSAFE_PROCESS_TREE', pass: false });
});
test('skipGrading: exactly the never-graded classes', () => {
  for (const e of ['SETUP_FAILED', 'UNSAFE_PROCESS_TREE', 'AGENT_STATUS_UNKNOWN', 'ENV_RESTORE_FAILED']) assert.equal(skipGrading(e), true, e);
  for (const e of ['CLEAN', 'ENV_CONTAMINATED']) assert.equal(skipGrading(e), false, e);
});
test('resultLabel', () => {
  assert.equal(resultLabel({ outcome: 'PASS', graderPass: true }), 'PASS');
  assert.equal(resultLabel({ outcome: 'TIMEOUT', graderPass: true }), 'TIMEOUT (grader: PASS)');
  assert.equal(resultLabel({ outcome: 'ENV_CONTAMINATED', graderPass: true }), 'ENV_CONTAMINATED (grader: PASS)');
  assert.equal(resultLabel({ outcome: 'SETUP_FAILED', graderPass: false }), 'SETUP_FAILED (not graded)');
  assert.equal(resultLabel({ outcome: 'UNSAFE_PROCESS_TREE', graderPass: false }), 'UNSAFE_PROCESS_TREE (not graded)');
});

test('run.ts decides pass only through outcome.ts', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'run.ts'), 'utf8');
  assert.match(src, /const \{ outcome, pass \} = classify\(/);
  assert.doesNotMatch(src, /const pass = g\.pass/);
  assert.doesNotMatch(src, /timedOut: run\.seconds >=/);
  // the score counts r.pass only
  assert.match(src, /const passed = graded\.filter\(\(r\) => r\.pass\)\.length;/);
});
