# D gates: decision-ready options (2026-10-05)

D has not run and is not approved. Hermes has not chosen between the two gates below.

Each gate is **PROPOSED — REQUIRES HUMAN APPROVAL**. Neither changes C. C stays COMPLETE / VALID / DECISION RULE NOT MET.

`evals/bench/dgate.mjs` (with tests in `evals/test/dgate.test.mjs`) only reads evidence and reports what each gate says.
It starts nothing.

Both commands below use `NODE_BIN=C:/Users/cierra/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node.exe`.

## Gate A: C must pass its existing registered rule
**PROPOSED — REQUIRES HUMAN APPROVAL**

- **Prerequisite.** PLAN `phases.C_rebaseline.status` records `DECISION RULE MET` for C's pre-registered rule.
- **Command.** `"$NODE_BIN" evals/bench/dgate.mjs --gate A`
- **Evidence required.** C's recorded result (PLAN `C_rebaseline.result`, `hermes-bench-archive/cycle10-C`).
- **Expected result on the current evidence.** `Gate A: BLOCKED - C is recorded as DECISION RULE NOT MET`, exit 1.
- **What blocks D.** C is final and failed its rule. Under Gate A, D cannot proceed on the existing evidence.
  - Only a new study that you explicitly authorize could change that, and such a study is not planned.
  - C itself is not re-run or amended.

## Gate B: D proceeds under a separately approved containment-regression criterion
**PROPOSED — REQUIRES HUMAN APPROVAL**

The candidate criterion is shown below. It is not adopted, and approving it is part of this decision.

- **B1.** No task where the contained runs are majority not-PASS while the control runs are majority PASS.
  - TIMEOUT, FAIL and SETUP_FAILED count as not-PASS.
  - A TIMEOUT whose grader passed is still not-PASS.
- **B2.** Same-mode disagreement is at most 25% (pooled pairs of runs within each mode).
- **B3.** These three hold, taken from the evidence set's own recorded analysis:
  - invariants hold in every contained run;
  - fingerprints match within mode;
  - no failure occurs only in contained mode with a containment-specific error.

Details:

- **Prerequisite.** You approve the criterion text above, or your own version, AND the evidence it applies to.
- **Command.** `"$NODE_BIN" evals/bench/dgate.mjs --gate B --archive C:/Users/cierra/hermes-bench-archive/cycle10-C`
  - This checks B1 and B2.
  - B3 for C is PLAN `C_rebaseline.result.decision_rule` criteria 1-3, which all HOLD.
- **Evidence required.** The six C runs: `cycle10-C/run-*.log`, which point to `evals/results/2026-10-04-23-26 .. 2026-10-05-12-16`.
- **Expected result on the current evidence.**
  - `B1+B2 MET - B1 regressions=[] B2 same-mode 4/48 = 8.3%`, exit 0. B3 holds.
- **What blocks D.**
  - You have not approved the criterion.
  - Or any of B1, B2 or B3 fails on the evidence named in the approval.
- **Caveat (must be part of the decision).** This criterion was written after C's outcome was known.
  - Applying it to C's data would be a post-hoc analysis, not a confirmatory test.
  - It would not change C's own result, which stays DECISION RULE NOT MET.

## If either gate is approved and met: the D run (NOT authorized; listed only so the decision is concrete)
Still missing, and each needs your approval first:

1. **A D pre-registration in PLAN** covering tasks T01-T18, reps, order, decision rule and the existing `tasks.json`
   timeouts unchanged. Those are 15/20/30/45 min per task; worst case 495 min per mode per rep.
2. **A D preflight.**
   - None exists: `cpreflight.mjs` is C-specific and now refuses with `plan-c-not-started`.
   - Its machine and live checks (pins, Ollama version, model digest, AC, free meter port, no stray clients) would be reused.

Run shape, mirroring C's driver:
```
export JCODE_BIN=C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe
O=C:/Users/cierra/hermes-bench-archive/cycle11-D; H=$(git rev-parse HEAD)
bash evals/bench/reduced.sh --out "$O" --expect-head "$H" \
  --tasks T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T11,T12,T13,T14,T15,T16,T17,T18 D1-contain:contain
bash evals/bench/reduced.sh --out "$O" --expect-head "$H" --ref <D1-contain results dir>/effective-config.json \
  --tasks T01,...,T18 D1-control:control
```

Runtime on this CPU:
- C's 8 tasks took about 2.5 h per mode.
- 18 tasks take up to about 8 h per mode at the timeout ceiling, so about 16 h for one contained and one control run.
