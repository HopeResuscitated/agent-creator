// outcome.ts - the single place where a task's final result class is decided (used by run.ts; unit-tested in
// evals/test/outcome.test.mjs). Pure functions, no I/O.
//
// Precedence (first match wins), matching the documented classification in PLAN.yaml / HANDOFF.md:
//   1. SETUP_FAILED / UNSAFE_PROCESS_TREE / AGENT_STATUS_UNKNOWN  (wrapper exit 4 / 3-or-other / 5: never graded)
//   2. ENV_RESTORE_FAILED / ENV_CONTAMINATED                       (dependency tree changed; never a PASS)
//   3. TIMEOUT                                                     (the agent hit its time limit; the grader's verdict
//                                                                   is kept as graderPass but never makes it a PASS)
//   4. PASS / FAIL                                                 (grader verdict on a CLEAN, in-time run)
// The agent's own exit code does not change the class (grading is on the produced files) but is recorded.

export type Outcome = 'PASS' | 'FAIL' | 'TIMEOUT' | 'SETUP_FAILED' | 'UNSAFE_PROCESS_TREE' | 'AGENT_STATUS_UNKNOWN' | 'ENV_CONTAMINATED' | 'ENV_RESTORE_FAILED';
export type WrapperNote = { agentExit: string; timedOut: boolean };

/**
 * The wrapper's authoritative result line (tools/run-in-job.ps1):
 *   [run-in-job <ms>] agent exit=<code|timeout|unknown|not-started> timedOut=<True|False> killed=... members-left=...
 * Returns null when the transcript has no such line (agent none/reference, or a wrapper exit before it was written).
 * If the line appears more than once (it should not), any timedOut=True wins: fail toward TIMEOUT, never toward PASS.
 */
export function parseWrapperNote(transcript: string): WrapperNote | null {
  const re = /^\[run-in-job \d+\] agent exit=(\S+) timedOut=(\S+)/gm;
  let found: WrapperNote | null = null;
  for (let m = re.exec(transcript); m; m = re.exec(transcript)) {
    const t = /^true$/i.test(m[2]) || m[1] === 'timeout';
    found = found ? { agentExit: found.timedOut ? found.agentExit : m[1], timedOut: found.timedOut || t } : { agentExit: m[1], timedOut: t };
  }
  return found;
}

/**
 * Did the agent hit its time limit? The wrapper's note is authoritative. Without it, a jcode run falls back to the
 * old elapsed-time heuristic (seconds >= limit - 5), which errs toward TIMEOUT; non-jcode agents cannot time out.
 */
export function decideTimedOut(note: WrapperNote | null, seconds: number, timeoutMin: number, isJcode: boolean): { timedOut: boolean; source: 'wrapper' | 'elapsed' | 'n/a' } {
  if (note) return { timedOut: note.timedOut, source: 'wrapper' };
  if (isJcode) return { timedOut: seconds >= timeoutMin * 60 - 5, source: 'elapsed' };
  return { timedOut: false, source: 'n/a' };
}

const NOT_GRADED = new Set(['SETUP_FAILED', 'UNSAFE_PROCESS_TREE', 'AGENT_STATUS_UNKNOWN', 'ENV_RESTORE_FAILED']);
/** True when the env status means the grader must not run at all. */
export function skipGrading(env: string): boolean { return NOT_GRADED.has(env); }

export function classify(input: { env: string; graderPass: boolean; timedOut: boolean }): { outcome: Outcome; pass: boolean } {
  const { env, graderPass, timedOut } = input;
  const known: Outcome[] = ['SETUP_FAILED', 'UNSAFE_PROCESS_TREE', 'AGENT_STATUS_UNKNOWN', 'ENV_RESTORE_FAILED', 'ENV_CONTAMINATED'];
  if (env !== 'CLEAN') {
    // Unknown env strings are treated as the most conservative not-graded class, never as CLEAN.
    return { outcome: (known as string[]).includes(env) ? (env as Outcome) : 'UNSAFE_PROCESS_TREE', pass: false };
  }
  if (timedOut) return { outcome: 'TIMEOUT', pass: false };
  return graderPass ? { outcome: 'PASS', pass: true } : { outcome: 'FAIL', pass: false };
}

/** Result-column text for summary.md. */
export function resultLabel(r: { outcome: Outcome; graderPass: boolean }): string {
  if (r.outcome === 'PASS' || r.outcome === 'FAIL') return r.outcome;
  if (skipGrading(r.outcome)) return `${r.outcome} (not graded)`;
  return `${r.outcome} (grader: ${r.graderPass ? 'PASS' : 'FAIL'})`;
}
