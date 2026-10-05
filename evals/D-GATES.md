# D gates: final decision package (frozen 2026-10-05)

## Project status
**EVALUATION COMPLETE — C FAILED ITS REGISTERED RULE.**

- C is valid final evidence: COMPLETE / VALID / DECISION RULE NOT MET.
- The current evidence does not show that containment caused a regression.
- CPU and model limitations are documented in PLAN `C_rebaseline.result.analysis` and `evals/POST-C-NOTE.md`.
- No C-prime is planned.
- **D has not run. Starting D requires a human-approved D gate.**
- Hermes has not chosen between Gate A and Gate B.

Both gates are **PROPOSED — REQUIRES HUMAN APPROVAL**.

Read-only reports, with `NODE_BIN=C:/Users/cierra/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node.exe`:
- `"$NODE_BIN" evals/bench/dgate.mjs --gate A`
- `"$NODE_BIN" evals/bench/dgate.mjs --gate B --archive C:/Users/cierra/hermes-bench-archive/cycle10-C`

## Gate A — PROPOSED — REQUIRES HUMAN APPROVAL
**D requires the existing pre-registered C rule to PASS.**

- **Current evidence: BLOCKED.** C is final and recorded as DECISION RULE NOT MET.
  - Criterion 4 fails: contained-vs-control disagreement 6/72 = 8.3% is above contained-vs-contained 0/24 = 0.0%.
  - `dgate.mjs --gate A` prints `BLOCKED`, exit 1.
- **What it means.** Choosing Gate A means D does not run on the existing evidence.
  - C is not re-run or amended.
  - Only a new study that you explicitly authorize could ever satisfy it.

## Gate B — PROPOSED — REQUIRES HUMAN APPROVAL
**D uses the separately defined containment-regression criterion:**

- **B1.** No task where the contained runs are majority not-PASS while the control runs are majority PASS.
  - TIMEOUT, FAIL and SETUP_FAILED all count as not-PASS.
  - A TIMEOUT whose grader passed is still not-PASS.
- **B2.** Same-mode disagreement is at most 25% (pooled run pairs within each mode).
- **B3.** These hold, taken from the evidence set's recorded analysis:
  - invariants hold in every contained run;
  - fingerprints match within mode;
  - no failure occurs only in contained mode with a containment-specific error.

**Current C evidence: MEETS the proposed criterion.**

- B1: no task regresses. The only cross-mode differences are T05 and T17: contained 3/3 PASS, control 2/3 PASS.
- B2: 4/48 = 8.3%.
- B3: PLAN `C_rebaseline.result.decision_rule` criteria 1-3 HOLD.
- `dgate.mjs --gate B` prints `MEETS the proposed criterion`, exit 0.

**Explicitly:**

- Gate B was defined **after** C's outcome was known.
- Applying it to C is a **post-hoc** analysis, not a confirmatory test.
- It **does not change C's result**, which stays DECISION RULE NOT MET.
- Gate B **requires explicit human approval** of the criterion text before D.

## D start guard (D cannot start by accident)
- `evals/bench/reduced.sh` refuses (exit 2, before creating anything) any run label `D<digit>…`, `d<digit>…`, `D-…` or `d-…`.
  - The only exception is when `dgate.mjs --preflight` prints `READY FOR D`.
- `--preflight` fails closed. It requires:
  - (a) PLAN `phases.D_gate.approval` written by you: `{ gate: A|B, approved_by, date }`, plus `criterion_text` for Gate B;
  - (b) a filled PLAN `phases.D_gate.preregistration` with no TEMPLATE, TBD or `<…>` placeholders;
  - (c) the approved gate's condition holding.
- Committed state: `D BLOCKED: no human approval recorded; D not pre-registered`.
- Tests: `evals/test/dgate.test.mjs`.

## D preparation (ready, NOT executed)

**1. Pre-registration template.**
- PLAN `phases.D_gate.preregistration_template`.
- To use it, copy it to `phases.D_gate.preregistration` and replace every TEMPLATE value.
- Fields: tasks, reps, order, timeouts, decision_rule, evidence_dir, setup_failed policy and quant. For D, quant stays Q4_K_M.

**2. Approval record.** You add it yourself to PLAN `phases.D_gate`:
```
approval: { gate: B, approved_by: "<you>", date: "<YYYY-MM-DD>", criterion_text: "<the approved text>" }
```
For Gate A, use `gate: A` and omit `criterion_text`.

**3. Preflight requirements.** All of these are existing, fail-closed checks; no new criterion is added.

| Check | Enforced by |
|---|---|
| approval + pre-registration + gate condition | `dgate.mjs --preflight` |
| repo HEAD = `--expect-head`, tracked tree clean, no Ollama client, no jcode.exe running | `reduced.sh` gate before each run |
| jcode sha256 = A3 pin, Ollama 0.34.4, model digest `1ef2c71e…`, patched node | `run.ts` pin gate (exit 2) |
| meter port free, AC power, no sleep, meter alive, repo and `~/.jcode` fingerprints unchanged, Ollama not restarted | `suite.sh` (exit 1/6/7/10/11) |
| Ollama auto-update OFF, machine on AC | check before starting: `ollamaenv.mjs`, `Win32_Battery`; same as before C |

**4. Command sequence.** Not authorized; run only after steps 1-3.
```
cd "C:/Users/cierra/Desktop/agent creator"
export JCODE_BIN=C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe
"$NODE_BIN" evals/bench/dgate.mjs --preflight            # must print READY FOR D
O=C:/Users/cierra/hermes-bench-archive/cycle11-D; H=$(git rev-parse HEAD)
TASKS=T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T11,T12,T13,T14,T15,T16,T17,T18
bash evals/bench/reduced.sh --out "$O" --expect-head "$H" --tasks "$TASKS" D1-contain:contain
REF="$(grep -h '^Report: ' "$O/run-D1-contain.log" | sed 's/^Report: //; s/\r$//; s/[\\/]summary\.md$//')/effective-config.json"
cp "$REF" "$O/ref-D1-contain.effective-config.json"
bash evals/bench/reduced.sh --out "$O" --expect-head "$H" --ref "$O/ref-D1-contain.effective-config.json" --tasks "$TASKS" D1-control:control
```
- Further reps alternate in the same way (`D2-contain:contain D2-control:control …`), as pre-registered.
- Any non-zero `reduced.sh` exit stops the run. That stop is an integrity or environment event, not a result.

**5. Evidence directory.**
- `C:/Users/cierra/hermes-bench-archive/cycle11-D`: `reduced.log`, `run-<label>.log`, `ev-<label>/`, `classify-*` and `analysis-*`.
- Results go to `evals/results/<UTC stamp>_ollama-hermes-local-32k/`.
- C's `cycle10-C` is never written to.

**6. Timeouts.**
- The existing `tasks.json` values, unchanged: T01-T04 15, T05 20, T06-T11 30, T12-T15 45, T16-T17 20, T18 15 (minutes).
- Ceiling: 495 min per mode per rep.
- Expected time on this CPU: C's 8 tasks took about 2.5 h per mode, so 18 tasks could take up to about 8 h per mode, about 16 h for one rep of each mode.

**7. Contained/control structure.**
- Same pins, same generated agent config, and the meter as upstream in both modes; containment is the only variable.
- The first contained run is the fingerprint reference (`--ref`).

**8. Scoring and output.**
- `outcome.ts` classes are unchanged: PASS, FAIL, TIMEOUT, SETUP_FAILED, BLOCKED, CONTAMINATED, INCONCLUSIVE, NOT RUN.
- A grader-PASS TIMEOUT stays TIMEOUT.
- Trip-line attribution: `tripclass.mjs`.
- The D decision rule is evaluated exactly as pre-registered. For Gate B, `dgate.mjs --gate B --archive "$O"` reports B1 and B2 on D's own runs.

**9. Cleanup.**
- `reduced.sh` and `suite.sh` stop the meter and watcher themselves.
- Afterwards, verify: no jcode, meter, watch or keep-awake processes; meter port free; `~/.jcode` fingerprint unchanged; tree clean.
- D's sandbox roots under `%TEMP%\agent-evals` are evidence; keep them.

**10. Final report format.** Record it in PLAN `phases.D_gate.result`, mirroring `C_rebaseline.result`:
- run window, HEAD and preflight line;
- per-run scores;
- a per-task table across runs;
- counts per class;
- each decision-rule criterion with HOLDS or FAILS and its arithmetic;
- trip review;
- the analysis split: CPU throughput, model, harness;
- evidence paths.

Never edit C's record.
