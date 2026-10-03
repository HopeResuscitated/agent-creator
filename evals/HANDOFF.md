# Handoff: pick up here

Updated 2026-10-03. Full plan and status: `evals/PLAN.yaml`. Evidence: `C:\Users\cierra\hermes-bench-archive` (cycle9 = A2).

## Where we are
- Containment is proven (all invariants hold; decision rule passed). Harness HEAD `d650c95` on `cierra-wip-2026-09-29`.
- COMPLETE: A0 (node pin; reduced.sh, t05x6.sh, probe.sh run end to end), A0b (model-server pin; one host setting is
  yours), A1 (jcode retry investigation), **A2 (incomplete-stream retry; validated on real tasks, clean run VALID)**.
- PARTIALLY COMPLETE: B (needs the 5th T05 rep per mode, plus T08 post-A2 in both modes).
- BLOCKED on your hardware decision (H): C re-baseline.

## Pins (run.ts refuses, exit 2, on any mismatch)
| What | Pin |
|---|---|
| Node | patched node 26.7.0 (A0) |
| jcode | `C:\Users\cierra\jcode-evalpin-a2-bin\jcode.exe`, jcode v0.88.64-dev (`7ed7403f8`), sha256 `f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3` (gate `3f9df6c`) |
| jcode, superseded | `C:\Users\cierra\jcode-evalpin-bin\jcode.exe`, v0.88.63-dev (`1fbb2e1b4`), sha256 `7d467704...` (now refused) |
| Model server | Ollama 0.34.4; hermes-local-32k digest `1ef2c71e...` |

Runs before `3f9df6c` are not fingerprint-comparable (the jcode hash changed on purpose).

## A2 (what changed and why)
- When Ollama's tool-call parser rejects malformed model output after text was streamed, it ends the HTTP 200 stream
  cleanly with no `finish_reason`, no usage and no `[DONE]`. jcode used to treat that as a finished answer and exit 0
  on partial prose (T13's failure, T05's flakiness, and, found 2026-10-03, T08's control failure in cycle 8).
- Now jcode treats such an ending as an incomplete stream **if that response handed out no tool call** and retries
  the request, **at most 2 times**, then fails loudly. Every other ending and HTTP 500 handling are unchanged.
- "No tool has run" is checked **per response, not per run**. Every real truncation came 11-15 messages into a
  conversation, after earlier tools had run, so a run-wide rule would never fire. It is safe because tools are dispatched
  only after a stream ends, and the retried request is byte-identical, so nothing runs twice (tested).
- Retrying resamples the model; pass-rate gains are partly resampling.

## Clean A2 validation (2026-10-02 19:31-22:58, VALID)
Started after 3 quiet minutes, with a monitor sampling every 20 s: no external jcode or Ollama client in the window.
Two earlier attempts are **CONTAMINATED** (manual jcode runs on the same Ollama) and are not used.

| Test | Result |
|---|---|
| Gates: node pin, model-server pin, jcode pin (old binary refused) | PASS |
| contained-child 10/10, security probe 20/20, relay 12/12, contained e2e 9/9, meter kill-abort | PASS |
| probe.sh both modes | PASS (ran end to end; Ollama-side defect unchanged, as expected: probe bypasses jcode) |
| T01 contained / control | PASS 135 s / PASS 80 s |
| T05 contained / control | PASS 422 s / TIMEOUT 1201 s (tests passed when graded) |
| t05x6 contained (C-a, C-b, C-c) | PASS / PASS / PASS (pre-A2: 2/3) |
| t05x6 control (D-a, D-b, D-c) | PASS / TIMEOUT 1201 s (tests passed when graded) / PASS (pre-A2: 2/3) |
| T13 contained / control | TIMEOUT 2704 s / TIMEOUT 2701 s |
| Per-task fingerprints | match (0 mismatches, control vs contained and all 6 t05x6 runs) |
| Repo, git status, ~/.jcode | unchanged |

- A2 retries fired 7 times across those tasks; every truncated stream recovered (0 gave up).
- **T13 is not fixed.** It no longer quits early on partial prose; it keeps working (meter: continuous progress, 3.7-4.7
  tok/s at ~9.7k-token prompts, first token up to 282 s, one edit took 643 s) until the 2700 s timeout, identically in
  both modes, and now passes 1 of 3 hidden cases (was 0). The remaining failure is CPU/model throughput.
- **TRIP lines**: 1,089, all attributed: control agents dialing the meter (633 + 633, documented control pattern), the
  harness warm-up curl (12), probe.sh's control client (1). Contained stages: 0 from agents. No containment violation.

## Other test status
| Test | Result |
|---|---|
| T03, T14, T17 (cycle 8, pre-A2) | TIMEOUT (CPU: slow but progressing; no truncated streams, so A2 cannot change them; T14 control also had build errors) |
| T08 contained (cycle 8) | TIMEOUT 1803 s (one turn waited 801 s for the first token) |
| T08 control (cycle 8) | FAIL at 948 s on the A2 defect, not a timeout (earlier docs said CPU timeout: corrected) |
| T08 post-A2 | NOT RUN (B, pending) |
| T04 (cycle 8) | PASS both modes; not re-run after A2 |
| jcode stream unit tests | PASS 42/42 (7 new) |
| jcode runtime crate unit tests | 4 FAIL, pre-existing: identical on the pre-A2 and A2 source (provider-profile / API-key autodetection; untouched) |
| A2 scenario tests (fake server, old vs new binary) | PASS (intended behaviour in all 7 scenarios) |
| One T01 contained in the first final-gate pass (cycle 8) | FAIL: meter died (harness); cause unknown (output not saved then). Identical rerun PASS. Not reproduced since; a recurrence now stops the run with exit 6 and keeps ev-<label>/meter.out |
| C re-baseline | BLOCKED (H) |

## Meter incident (found and fixed in A0)
When a task hit its timeout, the agent was killed but meter.mjs kept its own request to Ollama open, so Ollama kept
generating for nobody and the next task queued behind it. Fixed in `bab3a17` (re-verified in the clean run: request
after a killed generation answers in 173 ms). A meter that dies mid-run is detected (`170cbd5`, exit 6).

## Open decisions (yours)
1. **Hardware (H)**, before C: NVIDIA GPU? How much VRAM? CPU inference (~4-10 tok/s) causes the T03/T08/T13/T14/T17
   timeouts and leaves T05 at its limit. Timeouts are not raised to make tasks pass.
2. **Ollama auto-update**: still ON (`auto_update_enabled=1` in Ollama's settings DB) and the 0.35.1 installer is already
   downloaded (`%LOCALAPPDATA%\Ollama\updates_v2\d5a1390e...\OllamaSetup.exe`); it installs on the next Ollama app restart.
   The pin gate will then refuse every run until you re-pin deliberately (a new environment + baseline). To keep 0.34.4:
   Ollama app Settings -> turn off automatic updates.
3. **Push state**: origin has this branch at `6ca495a` (pushed by another session); local is ahead. jcode-evalpin has no
   upstream. Decide whether either belongs on a remote. Hermes has not pushed.
4. **Exclusive machine during benchmarks**: running jcode/Ollama by hand during a run contaminates it (happened twice).
5. **Hermes compression model**: change `auxiliary.compression.model` in Hermes `config.yaml` away from the free OpenRouter model.

## To resume in a new Claude chat
Paste:
```
Read evals/PLAN.yaml and evals/HANDOFF.md in C:\Users\cierra\Desktop\agent creator. Then tell me in 3 lines where we are and what's next. Keep answers short; I'm cost-conscious.
```

## Notes
- Rebuilding jcode: see `pins.jcode_build` in PLAN.yaml (GNU toolchain first on PATH; set `JCODE_BUILD_GIT_HASH`).
- Chat UI specs (`data/spec-chat-ui-*.md`) are blocked on roadmap Step 2. A review found 10 gaps to close first:
  attach-vs-no-attachments conflict, border contrast ~1.3:1, missing meta/dark-mode colors, no `system` role style,
  no task-state UI, undefined retry, ambiguous group timestamp, hover-only actions on touch, untestable visual gate,
  "ready" status despite no UI existing.
- Auto mode is now the default permission mode in `~/.claude/settings.json` (backup: `settings.json.bak-before-automode`).
