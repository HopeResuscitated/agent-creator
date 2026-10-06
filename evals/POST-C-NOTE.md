# Post-C design note: criterion 4 (2026-10-05)

**FINAL STATUS (frozen 2026-10-06): EVALUATION COMPLETE. C: COMPLETE / VALID / DECISION RULE NOT MET. D: COMPLETE / GATE B CONDITIONS MET - Gate B was approved separately by the human, post hoc, and does NOT change C's failed registered rule. CPU-only target; A3 jcode 710560f91 authoritative; Ollama 0.34.4; hermes-local-32k Q4_K_M. No C-prime planned; no further evaluation pending.**

Project status: EVALUATION COMPLETE - C FAILED ITS REGISTERED RULE. The CPU-only machine is the intended target; no
hardware work is pending; A3 is the authoritative pin. C is VALID / DECISION RULE NOT MET. Containment did not cause the
failure, and the current evidence does not establish a containment regression. CPU/model limitations are documented (PLAN
`C_rebaseline.result.analysis`). No C-prime is planned. D: Gate B approved by the human 2026-10-05 as a post-hoc rule that does NOT change C; D ran 2026-10-05/06 and its Gate B conditions hold, which still does not change C (`evals/D-GATES.md`).

This note documents a lesson. It does not change C. C's authoritative result stays **COMPLETE / DECISION RULE NOT MET / VALID**
(PLAN `C_rebaseline`). The registered criterion stays as written, and no replacement criterion is adopted here.

## Criterion 4 as registered
"contained-vs-control disagreement <= contained-vs-contained disagreement". It is computed per task over 3 contained and
3 control runs, using the definition registered in PLAN `C_rebaseline.preregistration`:
- contained-vs-contained = differing (run, run) pairs among the 3 contained runs, out of 3 pairs x 8 tasks = 24
- contained-vs-control = differing pairs across modes, out of 3 x 3 x 8 = 72

## Observed
- T05: contained PPP, control PPN. T17: contained PPP, control NPP. The other 6 tasks were identical in both modes.
- contained-vs-contained = 0/24 = 0.0%; contained-vs-control = 6/72 = 8.3%. So 8.3% <= 0.0% is false and criterion 4 FAILS.
- The other four criteria hold.
- Both disagreements are single model events in control runs, verified from the raw requests (`hermes-bench-archive/cycle10-C/post-analysis/ANALYSIS.md`):
  - T05 C3-control: tests were green at +159 s, then the model looped until the 1200 s kill.
  - T17 C1-control: one-shot CSV with three rows mis-sorted, never verified.
- No containment violation occurred, and containment lowered no score.

## Simulation (`post-analysis/decision-rule-simulation.txt`, 100k trials, fixed seed)
- Assumption: each (run, task) PASS is independent, and the probability is the SAME in both modes (no containment effect).
- Result with C's own pass rates, at 3 runs per mode:
  - criterion 4 alone fails in 35.5% of trials when using the pass rates observed in C
  - it fails in 41.5% of trials with moderate pass rates (no task treated as certain)
  - when containment really harms a task, criterion 4 catches it in only ~64% of trials
- The reason: one non-pass on any task whose contained runs happen to agree perfectly is enough to fail the
  criterion, because the contained baseline is often exactly 0.
- With 3 runs per mode, the criterion mostly measures the model's ordinary variability, not containment.

## Why re-running C under the same rule would be pass-chasing
- The rule fails ~35-43% of the time when containment has no effect at all.
- Another run would mainly re-sample that model variance. A pass would not show more than C already shows, and a
  second failure would not either.
- Re-running until it passes, then treating the pass as authoritative, is selective reporting. C is not re-run.

## Why a C-prime would need a new hypothesis and pre-registration
- A different rule asks a different question, for example "does containment cause any task-level regression?"
  instead of "is cross-mode disagreement no larger than within-mode disagreement?".
- So it needs its own registered hypothesis, rule, design, ID and evidence folder, all fixed before any run. Its
  analysis would be compared against C and could not overwrite or replace C.
- No C-prime is planned. Starting one requires explicit human authorization.
