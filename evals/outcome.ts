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

/**
 * Termination evidence. tools/run-in-job.ps1 writes its "agent exit=... timedOut=..." line on every path that exits 0
 * (and on exit 3/5). So a jcode run whose wrapper exited 0 (env CLEAN or ENV_CONTAMINATED after the dependency check)
 * but whose transcript has no such line has lost the evidence of how the agent ended: it may have timed out. It is
 * classified AGENT_STATUS_UNKNOWN (not graded), never graded on the elapsed-time guess. Other env values pass through.
 */
export function requireTerminationEvidence(env: { env: string; envDetail: string }, note: WrapperNote | null, isJcode: boolean): { env: string; envDetail: string } {
  // A note whose exit is not a number or "timeout" (unknown / not-started) does not show how the agent ended either;
  // the real wrapper never exits 0 with one, so this only fires on inconsistent evidence. Fail closed.
  const ended = !!note && (note.timedOut || /^-?\d+$/.test(note.agentExit));
  if (!isJcode || ended || (env.env !== 'CLEAN' && env.env !== 'ENV_CONTAMINATED')) return env;
  return { env: 'AGENT_STATUS_UNKNOWN', envDetail: `wrapper exited 0 but no valid "agent exit=<code|timeout> timedOut=..." line (termination evidence missing; was ${env.env}${env.envDetail ? `: ${env.envDetail}` : ''})` };
}

/**
 * Does a results.json entry count as a PASS? New entries carry `outcome`. Entries written before outcome.ts (326ba4e)
 * may say pass=true with timedOut=true; those are TIMEOUT as documented, so they never count as PASS here. Read-only:
 * the recorded files are not rewritten.
 */
export function countsAsPass(r: { outcome?: string; pass?: boolean; timedOut?: boolean; env?: string } | undefined | null): boolean {
  if (!r) return false;
  if (r.outcome) return r.outcome === 'PASS';
  return r.pass === true && r.timedOut !== true && (!r.env || r.env === 'CLEAN');
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
