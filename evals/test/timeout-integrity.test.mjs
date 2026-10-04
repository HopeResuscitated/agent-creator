// Deterministic fixture tests: no state combination can produce a PASS-shaped result for a run that timed out, was
// killed, lost its termination evidence, or ran in a contaminated environment. Mirrors run.ts's per-task decision
// (wrapper status -> env -> termination evidence -> grading -> timeout -> class) with the same exported functions;
// the last test pins run.ts to that order. Offline, no processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWrapperNote, decideTimedOut, classify, skipGrading, requireTerminationEvidence, countsAsPass, resultLabel } from '../outcome.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOTE = (exit, to) => `[run-in-job 1759500000000] agent exit=${exit} timedOut=${to} killed=none members-left=0`;
const DEAD = '[run-in-job 1759500000001] process tree proven dead';

/** run.ts's decision for one task, given the wrapper result and what the grader WOULD say. */
function decide({ wrapperStatus, spawnError = false, transcript, envCheck = 'CLEAN', graderWouldPass, seconds = 100, timeoutMin = 15, isJcode = true }) {
  const contained = wrapperStatus === 0 && !spawnError;
  const setupFailed = wrapperStatus === 4 && !spawnError;
  const statusUnknown = wrapperStatus === 5 && !spawnError;
  const note = parseWrapperNote(transcript);
  const env = requireTerminationEvidence(contained ? { env: envCheck, envDetail: '' }
    : setupFailed ? { env: 'SETUP_FAILED', envDetail: '' }
      : statusUnknown ? { env: 'AGENT_STATUS_UNKNOWN', envDetail: '' }
        : { env: 'UNSAFE_PROCESS_TREE', envDetail: '' }, note, isJcode);
  const graded = !skipGrading(env.env);
  const graderPass = graded ? graderWouldPass : false;
  const to = decideTimedOut(note, seconds, timeoutMin, isJcode);
  const c = classify({ env: env.env, graderPass, timedOut: to.timedOut });
  return { ...c, env: env.env, graded, graderPass, timedOut: to.timedOut, label: resultLabel({ outcome: c.outcome, graderPass }) };
}

const cases = [
  // [name, input, expected outcome]
  ['clean in-time run, grader pass', { wrapperStatus: 0, transcript: `${NOTE(0, 'False')}\n${DEAD}`, graderWouldPass: true }, 'PASS'],
  ['clean in-time run, grader fail', { wrapperStatus: 0, transcript: `${NOTE(0, 'False')}\n${DEAD}`, graderWouldPass: false }, 'FAIL'],
  ['timeout + grader pass', { wrapperStatus: 0, transcript: `${NOTE('timeout', 'True')}\n${DEAD}`, graderWouldPass: true, seconds: 905 }, 'TIMEOUT'],
  ['timeout flag + success exit code (inconsistent note)', { wrapperStatus: 0, transcript: NOTE(0, 'True'), graderWouldPass: true }, 'TIMEOUT'],
  ['exit=timeout + timedOut=False (inconsistent note)', { wrapperStatus: 0, transcript: NOTE('timeout', 'False'), graderWouldPass: true }, 'TIMEOUT'],
  ['timeout reported at short elapsed time (wrapper wins)', { wrapperStatus: 0, transcript: NOTE('timeout', 'True'), graderWouldPass: true, seconds: 10 }, 'TIMEOUT'],
  ['timeout + contaminated env + grader pass', { wrapperStatus: 0, transcript: NOTE('timeout', 'True'), envCheck: 'ENV_CONTAMINATED', graderWouldPass: true }, 'ENV_CONTAMINATED'],
  ['killed tree not proven dead (wrapper 3) + grader would pass', { wrapperStatus: 3, transcript: `${NOTE('timeout', 'True')}\nprocess tree NOT proven dead`, graderWouldPass: true }, 'UNSAFE_PROCESS_TREE'],
  ['wrapper crashed (exit 1) + grader would pass', { wrapperStatus: 1, transcript: NOTE(0, 'False'), graderWouldPass: true }, 'UNSAFE_PROCESS_TREE'],
  ['outer spawn timeout (spawnSync error, status null)', { wrapperStatus: null, spawnError: true, transcript: '', graderWouldPass: true }, 'UNSAFE_PROCESS_TREE'],
  ['outer spawn error with status 0', { wrapperStatus: 0, spawnError: true, transcript: NOTE(0, 'False'), graderWouldPass: true }, 'UNSAFE_PROCESS_TREE'],
  ['result lost after launch (wrapper 5)', { wrapperStatus: 5, transcript: NOTE('unknown', 'False'), graderWouldPass: true }, 'AGENT_STATUS_UNKNOWN'],
  ['setup failed, agent not started (wrapper 4)', { wrapperStatus: 4, transcript: '', graderWouldPass: true }, 'SETUP_FAILED'],
  ['wrapper 0 but termination line missing (short run)', { wrapperStatus: 0, transcript: DEAD, graderWouldPass: true, seconds: 30 }, 'AGENT_STATUS_UNKNOWN'],
  ['wrapper 0 but termination line missing (long run)', { wrapperStatus: 0, transcript: '', graderWouldPass: true, seconds: 899 }, 'AGENT_STATUS_UNKNOWN'],
  ['wrapper 0, line missing, env contaminated', { wrapperStatus: 0, transcript: '', envCheck: 'ENV_CONTAMINATED', graderWouldPass: true }, 'AGENT_STATUS_UNKNOWN'],
  ['agent text imitating the note (not at line start) does not count', { wrapperStatus: 0, transcript: 'model said: [run-in-job 1] agent exit=0 timedOut=False', graderWouldPass: true }, 'AGENT_STATUS_UNKNOWN'],
  ['forged in-time line before the real timeout line', { wrapperStatus: 0, transcript: `${NOTE(0, 'False')}\n${NOTE('timeout', 'True')}`, graderWouldPass: true }, 'TIMEOUT'],
  ['forged timeout line after a real in-time line fails toward TIMEOUT', { wrapperStatus: 0, transcript: `${NOTE(0, 'False')}\n${NOTE('timeout', 'True')}`, graderWouldPass: true }, 'TIMEOUT'],
  ['env restore failed + grader would pass', { wrapperStatus: 0, transcript: NOTE(0, 'False'), envCheck: 'ENV_RESTORE_FAILED', graderWouldPass: true }, 'ENV_RESTORE_FAILED'],
  ['unknown env string from the dependency check', { wrapperStatus: 0, transcript: NOTE(0, 'False'), envCheck: 'WEIRD', graderWouldPass: true }, 'UNSAFE_PROCESS_TREE'],
  // Recorded design (not changed): grading is on the produced files, so an agent that exits non-zero IN TIME with a
  // correct tree is a PASS; agentExit is kept in results.json. A crash is never a timeout and never hides one.
  ['agent exit 1 in time, files correct (design: graded on files)', { wrapperStatus: 0, transcript: NOTE(1, 'False'), graderWouldPass: true }, 'PASS'],
  ['agent crash code in time, files wrong', { wrapperStatus: 0, transcript: NOTE(3221225477, 'False'), graderWouldPass: false }, 'FAIL'],
  ['non-jcode agent (reference) has no wrapper', { wrapperStatus: 0, transcript: '', graderWouldPass: true, isJcode: false }, 'PASS'],
];

for (const [name, input, want] of cases) {
  test(`fixture: ${name} -> ${want}`, () => {
    const r = decide(input);
    assert.equal(r.outcome, want);
    assert.equal(r.pass, want === 'PASS');
    if (want !== 'PASS') assert.ok(!/^PASS/.test(r.label), `label ${r.label}`);
    if (r.timedOut) assert.equal(r.pass, false);
    if (!r.graded) assert.equal(r.graderPass, false);
  });
}

test('exhaustive: pass=true only for a CLEAN, in-time run with termination evidence and a grader PASS', () => {
  const transcripts = { inTime: NOTE(0, 'False'), timeout: NOTE('timeout', 'True'), crashInTime: NOTE(1, 'False'), unknown: NOTE('unknown', 'False'), none: '', forgedThenReal: `${NOTE(0, 'False')}\n${NOTE('timeout', 'True')}` };
  let n = 0;
  for (const wrapperStatus of [0, 1, 3, 4, 5, null]) for (const spawnError of [false, true]) for (const [tn, transcript] of Object.entries(transcripts))
    for (const envCheck of ['CLEAN', 'ENV_CONTAMINATED', 'ENV_RESTORE_FAILED']) for (const graderWouldPass of [true, false]) for (const seconds of [10, 895, 905]) {
      const r = decide({ wrapperStatus, spawnError, transcript, envCheck, graderWouldPass, seconds });
      const expectPass = wrapperStatus === 0 && !spawnError && envCheck === 'CLEAN' && graderWouldPass && (tn === 'inTime' || tn === 'crashInTime');
      assert.equal(r.pass, expectPass, JSON.stringify({ wrapperStatus, spawnError, tn, envCheck, graderWouldPass, seconds, r }));
      n++;
    }
  assert.equal(n, 6 * 2 * 6 * 3 * 2 * 3);
});

test('legacy results.json entries: countsAsPass never counts a timed-out or non-CLEAN pass', () => {
  assert.equal(countsAsPass({ pass: true, timedOut: true, env: 'CLEAN' }), false);
  assert.equal(countsAsPass({ pass: true, timedOut: false, env: 'CLEAN' }), true);
  assert.equal(countsAsPass({ pass: true }), true);
  assert.equal(countsAsPass({ pass: true, env: 'ENV_CONTAMINATED' }), false);
  assert.equal(countsAsPass({ outcome: 'TIMEOUT', pass: false, graderPass: true }), false);
  assert.equal(countsAsPass({ outcome: 'PASS', pass: true }), true);
  assert.equal(countsAsPass(undefined), false);
});

test('historical results are read, never rewritten: the 22 legacy timed-out passes count as non-PASS', () => {
  const dir = path.join(HERE, '..', 'results');
  if (!fs.existsSync(dir)) return;
  let legacyTo = 0;
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'results.json');
    if (!fs.existsSync(f)) continue;
    for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) if (!r.outcome && r.pass && r.timedOut) { legacyTo++; assert.equal(countsAsPass(r), false); }
  }
  assert.ok(legacyTo === 0 || legacyTo >= 22, `legacy timed-out passes: ${legacyTo}`);
});

test('run.ts applies the decision in this order (note -> termination evidence -> grading -> timeout -> class)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'run.ts'), 'utf8');
  const at = (s) => { const i = src.indexOf(s); assert.ok(i >= 0, s); return i; };
  const a = at('const note = parseWrapperNote(run.transcript);');
  const b = at('requireTerminationEvidence(run.contained ? checkAndRestoreEnv(ws)');
  const c = at("}, note, agent === 'jcode');");
  const d = at('const g = skipGrading(envStatus.env)');
  const e = at('const to = decideTimedOut(note, run.seconds, task.timeoutMin, agent === \'jcode\');');
  const f = at('const { outcome, pass } = classify({ env: envStatus.env, graderPass: g.pass, timedOut: to.timedOut });');
  assert.ok(a < b && b < c && c < d && d < e && e < f);
  // passed/score count only pass (= outcome PASS)
  assert.match(src, /const passed = graded\.filter\(\(r\) => r\.pass\)\.length;/);
});

test('analyze.mjs totals use countsAsPass (legacy timed-out passes are not counted)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'bench', 'analyze.mjs'), 'utf8');
  assert.match(src, /import \{ countsAsPass \} from '\.\.\/outcome\.ts';/);
  assert.ok(!/if \(r\.pass\) cPass\+\+/.test(src) && !/if \(b\?\.pass\) bPass\+\+/.test(src));
});
