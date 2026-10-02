# Handoff: pick up here

Updated 2026-10-02. Full plan and status: `evals/PLAN.yaml`.

## Where we are
- Containment is proven (all invariants hold; decision rule passed). Harness HEAD `170cbd5`
  (node pinned `14f50f2`; meter aborts upstream on agent kill `bab3a17`; model server pinned `480ea05`/`ac49b52`;
  dead meter fails the run `170cbd5`).
- Done: A0 (node pin; reduced.sh, t05x6.sh and probe.sh all run end to end), A0b (model-server pin; one host
  setting left to you), A1 (jcode retry investigation).
- Next: **A2 (approved, not implemented)**, then B, then the hardware decision (H), then C.
- Main open problem: the model sometimes emits malformed tool calls; Ollama ends the stream without a finish
  reason, and jcode (A1) treats that as a finished answer and exits 0. That is T13's failure (and T05's flakiness).

## Meter incident (found and fixed in A0)
When a task hit its timeout, the agent was killed but meter.mjs kept its own request to Ollama open, so Ollama kept
generating for nobody and the next task queued behind it (R-C: 709 s of dead compute; T13's first turn waited 641 s).
Fixed in `bab3a17`; verified on real Ollama (the next request answers in ~150 ms). Separately, a meter that dies
mid-run is now detected (`170cbd5`, suite.sh exit 6) instead of being scored as model FAILs. That happened once in the
final gates; its cause is unrecoverable because the meter's output was not saved then (now it is, in
ev-<label>/meter.out). The identical rerun passed.

## Test status at 170cbd5 (2026-10-02)
| Test | Result |
|---|---|
| Node pin: bare v22 refused (run and --stage-tools-only) | PASS |
| Model-server pin: unreachable / unpinned / tampered version / tampered digest refused | PASS |
| contained-child-test | PASS 10/10 |
| security probe | PASS 20/20 |
| relay byte test | PASS 12/12 |
| contained end-to-end byte test | PASS 9/9 |
| meter abort on real Ollama | PASS |
| T01 contained (git-bash, suite.sh) | PASS, fingerprint 9609faa1, 0 TRIP, repo + ~/.jcode unchanged |
| T01 control (PowerShell, hostile env) | PASS, fingerprint 9609faa1 |
| suite.sh / reduced.sh meter-death stop | PASS (exit 6) |
| reduced.sh R-C / R-D (8 tasks each, pre-A0b) | RUN: contained 6/8, control 5/8, 8/8 fingerprints match |
| t05x6.sh (pre-A0b) | RUN: contained 2/3, control 2/3; both failures = incomplete stream |
| probe.sh contained + control | RUN: defect reproduced identically in both modes |
| T08, T13 | FAIL (both modes; also in baseline) |
| T03, T17 contained; T14 both modes | TIMEOUT (model still working; CPU) |
| One T01 contained in the first final-gate pass | FAIL: meter died (harness), rerun PASS; now caught by exit 6 |
| B validation, C re-baseline | NOT RUN (blocked on A2 / H) |

## Open decisions (yours)
1. **A2 fix**: APPROVED 2026-10-02, not yet implemented as of this commit: the jcode-native fix (treat a stream that ends without finish_reason/[DONE] as a retryable
   incomplete stream, cap 2, only when no tool executed). It changes the agent
   binary, so it means a new jcode pin and a re-baseline.
2. **Hardware** before the re-baseline: NVIDIA GPU? How much VRAM? (CPU at ~7 tok/s causes the T03/T08/T14/T17 timeouts
   and makes every benchmark take hours.) Timeouts are not raised to make tasks pass.
3. **Ollama auto-update**: turn it off in the Ollama app settings. v0.35.1 is already downloaded and installs on the
   next app restart; the new pin gate will then refuse to run until you re-pin deliberately.
4. **Push state**: origin already has this branch at `6ca495a` (another session pushed it), though the plan said
   "local only". Local is 7 commits ahead. Decide whether this branch should be on origin at all; Hermes has not pushed.
5. **Hermes compression model**: change `auxiliary.compression.model` in Hermes `config.yaml` away from the free OpenRouter model.

## To resume in a new Claude chat
Paste:
```
Read evals/PLAN.yaml and evals/HANDOFF.md in C:\Users\cierra\Desktop\agent creator. Then tell me in 3 lines where we are and what's next. Keep answers short; I'm cost-conscious.
```

## Next Hermes prompt (fresh session, Opus) - after you decide A2
```
Cost mode: fresh session. Read only evals/PLAN.yaml and evals/HANDOFF.md in C:\Users\cierra\Desktop\agent creator.
A2 decision: <approved option>. Implement it in C:\Users\cierra\jcode-evalpin (one commit), build a new pinned binary,
record its sha256, run the unit tests for the stream parser, then phase B per PLAN.yaml (probe.sh, T05 5+5, all gates).
Give me exact PowerShell commands for any long run so I run them myself. Stop after each step. Update PLAN.yaml status fields.
```

## Notes
- Evidence archive (safe from cache pruning): `C:\Users\cierra\hermes-bench-archive` (cycle8 = this validation).
- Chat UI specs (`data/spec-chat-ui-*.md`) are blocked on roadmap Step 2. A review found 10 gaps to close first:
  attach-vs-no-attachments conflict, border contrast ~1.3:1, missing meta/dark-mode colors, no `system` role style,
  no task-state UI, undefined retry, ambiguous group timestamp, hover-only actions on touch, untestable visual gate,
  "ready" status despite no UI existing.
- Auto mode is now the default permission mode in `~/.claude/settings.json` (backup: `settings.json.bak-before-automode`).
