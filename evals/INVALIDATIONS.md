# Evaluation invalidations

Append-only record of evaluation results that must not be treated as valid
capability results.

Rules:
- Add new entries at the bottom. Never edit or delete an existing entry.
- An entry does not change the original evidence. The original run directory
  under `evals/results/` and its `history.csv` row stay exactly as recorded.
- To correct an entry, append a new entry that references it.

---

## INV-001: T12, run 2026-09-29-13-09_ollama-hermes-local-32k

- Recorded: 2026-09-29
- Run: `evals/results/2026-09-29-13-09_ollama-hermes-local-32k`
- Task: T12, Verify gate (real spec)
- Originally recorded as: PASS (results.json `"pass": true`; history.csv row `1,1`)
- Classification: INVALID as a capability result
- Timeout: the run hit the 45-minute limit (results.json `"seconds": 2700`,
  `"timedOut": true`).
- Cause: the original T12 grader checked verify exit codes and that
  `docs/verify.log` exists. It never tested lint behaviourally, so it
  accepted a hollow lint implementation.
- Evidence: manual inspection of the transcript and the kept sandbox showed
  that the candidate's lint step in its `verify` script was only
  `echo 'Lint: PASSED'`. No linter ran.
- Grader fix: commit d0fa88c, "evals: harden T12 lint grader". The hardened
  grader adds a syntax-invalid `.js` lint probe, which verify must reject. When
  the same kept sandbox was re-graded with it, the result was
  `T12 FAIL  verify still passes with a file ESLint cannot parse (lint step not real)`.
- Preserved unchanged: the original transcript, results.json, summary.md,
  baseline.txt and the history.csv row.
- This invalidation does not retroactively rewrite the original result. No
  replacement score is assigned.
