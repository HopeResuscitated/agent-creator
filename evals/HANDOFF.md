# Handoff: pick up here

Updated 2026-10-04 (HARDWARE-READY CHECKPOINT, re-confirmed after the second pre-hardware audit: all non-hardware work
done; C not started). Audit of the harness: `evals/AUDIT.md`. Full plan and status: `evals/PLAN.yaml`. Re-pin procedure:
`evals/REPIN.md`; exact post-hardware sequence: `evals/RUNBOOK-POST-HARDWARE.md`. Evidence: `C:\Users\cierra\hermes-bench-archive` (cycle9 = A2, Phase B, A3 candidate, final
regression, pre-C tooling checks).

## Where we are
Containment is proven (all invariants hold; decision rule passed). Last harness-code commit `9c9bf85` (2026-10-04
hardening and second audit: classification, failure propagation, monitoring, re-pin automation; see "Post-checkpoint
hardening" and "Second pre-hardware audit"). No
evidence was produced by the new code: every authoritative result predates it and is unchanged. All work is local (branch `cierra-wip-2026-09-29`); nothing has been pushed.
**C has not started and must not start before the hardware decision.**

### Evidence classes (how to read every result in this file)
| Class | What belongs here |
|---|---|
| **Authoritative** | Produced on the current pins (A2 jcode `7ed7403f8`/`f76eff11...`, Ollama 0.34.4, model `1ef2c71e...`), AC, no sleep, no external activity: clean A2 validation 2026-10-02, b6 (the authoritative Phase B run), final regression 2026-10-03, gates.sh + T01 x4 2026-10-03, reference agent 18/18 |
| **Historical** | Kept on record, not reinterpreted, not used for authoritative timing: cycles 6-8 (pre-A2 jcode), b5 (battery + sleep), the two CONTAMINATED A2 attempts, superseded pins |
| **Candidate fix** | A3 (`710560f91`, `42ed4012...`): ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE, not pinned; only fake-server and unit evidence |
| **Hardware-dependent (not done)** | REPIN.md steps 1-12, quant trial, C, everything after C |
| **Proposed, not approved** | D gate definition (see Coverage); no other proposal is in force |
| **Known limitations** | CPU/model-throughput and model-behaviour items below; recorded as measured (TIMEOUT stays TIMEOUT) |

### Completed
| Item | Evidence |
|---|---|
| A0 runner-node pin, A0b model-server pin, A1 retry investigation | PLAN.yaml phases |
| A2 incomplete-stream retry | clean validation 2026-10-02 VALID (no sleep, no external activity) |
| Power/sleep protection (`5d3e8fe`) | caught the real b5 sleep; clean A2 window re-checked: no sleep |
| Phase B | COMPLETE; b6 (AC) authoritative |
| T01 | PASS both modes (clean A2 run; 2026-10-03 T01 x4 check below) |
| T05 contained | 5/5 PASS in the 10 authoritative runs |
| probe.sh | PASS both modes |
| Containment / security gates | contained-child 10/10, secprobe 20/20, relay 12/12, contained e2e 9/9, meter kill-abort; all pin refusals (exit 2) |
| Fingerprint validation | 0 mismatches in every comparison; T01 fingerprint `df1332d7...` identical on 2026-10-02 and 2026-10-03, 4 launch paths |
| Reference agent | 18/18 (every grader passable) |
| Pre-C preparation | A3 adopted as candidate (not pinned), `REPIN.md`, re-pin tooling built and exercised, AGENTS.md corrected |
| Hermes compression on the main provider | operational config only (see "Hermes compression model"); not an evaluation input |
| Post-checkpoint hardening (2026-10-04) | 8 harness defects fixed, re-pin + C preflight automated, offline test suite (see below; `evals/AUDIT.md`) |

### Known limitations (kept on record; none is hidden or reclassified)
CPU / model throughput (this machine):
- **T08**: TIMEOUT in all 4 post-A2 runs. CPU/model throughput (continuous progress, decode 3.9-4.8 tok/s, first token
  up to 274 s, reference passes). Timeout unchanged (30 min).
- **T13**: TIMEOUT both modes post-A2 (2700 s). CPU/model throughput; A2 removed the early exit on partial prose.
- **T03 / T14 / T17** (cycle 8, pre-A2, as recorded): contained PASS(to) in all three (= TIMEOUT as recorded; for T03 the wrapper's own line says the
  agent exited by itself at 901 s on its 900 s limit, the record is kept);
  control T03 PASS, T14 FAIL(to) = TIMEOUT (also build errors), T17 PASS. Slow-but-progressing generation, no truncated
  streams. Historical CPU-throughput limitation; not run on the A2 pin (they are C tasks).
- **T05 control timing**: 2 of 5 authoritative control runs are TIMEOUT at 1201 s (tests passed when graded; recorded
  as TIMEOUT, not PASS). T05 sits at its limit on this CPU.

Model behaviour (independent of hardware):
- **Model rewrites protected tests**: b5 T05 contained FAIL (battery run, kept on record): the agent rewrote the
  protected test file, failed to revert it, and claimed it never touched it. The grader caught it and is unchanged.
  Model behaviour; not reproduced in b6.
- **Malformed tool arguments**: the model sometimes emits malformed tool calls. Ollama-side XML failures are handled by
  A2 (retry). `edits` sent as a string (2 of 24 edit calls) is fixed on the jcode side by A3 (adopted, not yet pinned).
  Fused key names stay rejected (model output corruption).
- **Hallucinated tool name**: a call to a tool that does not exist ends the jcode run (`Error: Tool 'x' is not
  allowed`, exit 1) instead of returning an error result to the model; identical on A2 and A3 (a3offline T4,
  2026-10-04). Recorded, not changed; it would show up as a task FAIL, never as a PASS.

### Pending, hardware-dependent (none of this is done)
- A3 authoritative re-pin (`REPIN.md` steps 4-11)
- new-hardware performance validation (`REPIN.md` steps 1, 3, 12)
- quant trial (`REPIN.md` step 12)
- C re-baseline
- D gate (after C; definition only PROPOSED, not adopted: see Coverage)
- remaining task coverage on the final pin (see Coverage)

## Pins (run.ts refuses, exit 2, on any mismatch)
| What | Pin |
|---|---|
| Node | patched node 26.7.0 (A0) |
| jcode (validated, authoritative) | `C:\Users\cierra\jcode-evalpin-a2-bin\jcode.exe`, jcode v0.88.64-dev (`7ed7403f8`), sha256 `f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3` (gate `3f9df6c`) |
| jcode, superseded | `C:\Users\cierra\jcode-evalpin-bin\jcode.exe`, v0.88.63-dev (`1fbb2e1b4`), sha256 `7d467704...` (refused) |
| jcode, A3 (adopted for the next re-pin, NOT pinned) | `C:\Users\cierra\jcode-evalpin-a3cand-bin\jcode.exe`, v0.88.65-dev (`710560f91`, branch `eval-pin-a3-candidate`), sha256 `42ed4012e129cc36e9d3f3c299b3015fbde5c8cb95cab36ed41f0d526fd0bab7` (refused by the gate today, verified 2026-10-03) |
| Model server | Ollama 0.34.4; hermes-local-32k digest `1ef2c71ed2065896...` = Qwen3-Coder 30B-A3B Instruct, Q4_K_M, num_ctx 32768, **num_gpu 0** |

Runs before `3f9df6c` are not fingerprint-comparable (the jcode hash changed on purpose).

## A3: ADOPTED AS CANDIDATE, NOT YET AUTHORITATIVE (prepared for the next re-pin, not pinned)
- **What**: jcode `710560f91` = the pinned A2 commit `7ed7403f8` + one change in `edit.rs`: a string `edits` that
  decodes to an array (strict JSON, or after escaping raw newline/CR/tab inside string literals) is used as the array;
  everything else errors as before.
- **Evidence so far**: 2 of 24 real edit calls had this shape; unit `tool::edit` 20/20 (3 new); fake-server scenarios:
  the pinned binary rejects both string forms, A3 applies them exactly like a native array and still rejects garbage;
  A2 scenarios unchanged. Now in the repo as `evals/bench/editstring.mjs` (`--expect fixed|unfixed`), re-run
  2026-10-03: A3 `EDITSTRING PASS` (fixed), A2 `EDITSTRING PASS` (unfixed).
- **Offline comparison (2026-10-04, `a3offline.mjs`)**: both REAL binaries against the same scripted fake provider, 18
  scenarios (normal, text+EOF, Ollama-rejected tail, HTTP 500 once/always, tool then EOF, partial text not in history,
  2 ordered tool calls, duplicate call ids, truncated JSON arguments, unknown tool, failed edit, arguments split across
  deltas, edit E1-E4): identical behaviour in 16, E2/E3 differ as designed, every per-build invariant holds (no
  duplicate tool execution, discarded text never re-sent, invalid calls are errors with the file untouched), ~/.jcode
  unchanged. Offline evidence only: it de-risks the re-pin, it does not make A3 authoritative.
- **Why it is not authoritative**: no real task has run on it, there is no fingerprint baseline for it, and pinning
  it now would force a CPU baseline that the hardware change discards anyway. Every validated result in this file
  was produced by the A2 binary.
- **Required validation after the hardware change** (`REPIN.md`): binary identity (step 4) + editstring both ways;
  pin edit committed alone (6); `gates.sh` all PASS with the A2 and 1fbb2e1b4 binaries refused (7-10); T01 x4 one new
  fingerprint, different from `df1332d7...` (11); then C, where A3 first meets real tasks.

## Re-pin tooling (new, in `evals/bench`, all exercised 2026-10-03 on the current pin)
| Tool | What | Check run |
|---|---|---|
| `gates.sh` | every pre-run gate, one PASS/FAIL line each; refuses to start if jcode/Ollama are busy | 15/15 PASS (A2 pin; 1fbb2e1b4 and A3 binaries refused) after fixing one defect it exposed in meterabort.mjs (path with a space) |
| `meterabort.mjs` | meter kill-abort check against real Ollama | PASS on the current meter (next request 185 ms); **FAIL** on the pre-`bab3a17` meter (next request still waiting at 30 s): it detects the incident |
| `t01x4.ps1` | T01 x 4 launch paths, fingerprints must be identical | see "T01 x4" below |
| `quanttrial.mjs` | replays real captured agent requests against one model; malformed-call classes, Wilson CI, first-token and decode rates (first token is cold-cache: replays get no prefix reuse, so compare quants with each other, not with agent-run meters) | offline 13/13 classification checks; real Ollama: 1 request (2,444-token prompt, first token 81 s, decode 10.9 tok/s, valid tool call) |
| `editstring.mjs` | A3 behaviour check (fake server, real jcode) | see A3 above |
| `attrmon.ps1` | attribution monitor (EXTERNAL-ACTIVITY lines) as used for b6, now in the repo | idle check: no false positives |
| `repin.mjs` (2026-10-04) | REPIN.md steps 1-12 as ordered, fail-closed stages with a record; `--dry-run` read-only | dry run: NOT READY as expected (no discrete GPU, CPU model, no quant decision); A3 identity checks pass |
| `cpreflight.mjs` (2026-10-04) | READY FOR C or BLOCKED with every reason | BLOCKED, 10 reasons (all hardware / re-pin / pre-registration / auto-update) |
| `a3offline.mjs` + `fakeprov.mjs` | A2 vs A3 offline behaviour (above) | PASS |
| `a3stress.mjs` (2026-10-04) | 16 edit-path stress scenarios, real A2 and A3 (candidate evidence only) | A3STRESS PASS; archive `a3-candidate-offline-2026-10-04` |
| `hwreport.mjs` (2026-10-04) | CURRENT MEASURED BASELINE vs FUTURE HARDWARE MEASUREMENTS table | `evals/perf/HARDWARE-REPORT.md`; future column NOT MEASURED |
| `hwprofile.ps1`, `perfreport.mjs`, `perfsample.ps1` | hardware profile; descriptive CPU-vs-GPU performance report (no thresholds) | CPU baseline recorded in `evals/perf/` |
| `ollamaenv.mjs` | running Ollama server's settings (observed, not pinned) and start time | matches `ollama-server-env.observed.json` |
| `tripclass.mjs` | attributes every watchdog TRIP line | archived b6 + a2val3 logs: 1,686 TRIP lines, all attributed, 0 VIOLATION |
| `status.mjs`, `coverage.mjs` | derived status + consistency gate; 18-task coverage matrix | STATUS-CHECK PASS; matrix agrees with "Coverage" |
| `quanttrial.mjs` (revised 2026-10-04) | transport faults are `stream_error`, not malformed; warm-only median ttfb; cache + model state | offline tests incl. an end-to-end fake-Ollama run |

**T01 x4 (2026-10-03, A2 pin, AC)**: PowerShell and git-bash x contained and control: 2 runs (8 launches), T01 PASS 8/8, environment CLEAN, every fingerprint `df1332d786b0ee3b57f58eb6e7eff90a69e366e5998efe8f9d3b6b5319d60e64` = the T01 entry of the clean A2 validation (2026-10-02), so DET-1 also holds across days. Pre-A2 `4dcba4e1...` reported DIFFERENT, as expected. The re-pin must replace this value. (A first attempt never launched: Windows PowerShell 5.1 turned node's stderr warning into a terminating error; fixed with Start-Process before both runs.)

## Hardware decision: technical requirements (facts only; the choice is yours)

### FACTS MEASURED
Summary (details below):
- Current Q4_K_M weights: ~17.3 GiB (17.28 GiB, model file size).
- Current 32k context cache: ~1.6 GiB at the configured q8_0 KV type (~3.0 GiB at f16); computed from the model
  architecture (48 layers x 4 KV heads x 256 x 32,768 tokens), not read from a GPU.
- Q8_0 weights: ~30 GiB, an estimate from 30.5B parameters (no Q8_0 file has been downloaded or measured).
- Additional working memory, MEASURED ON CPU only (2026-10-04, model loaded, `evals/perf/cpu-baseline-hwprofile.json`):
  KV 1,632 MiB (q8_0), compute buffer 240.1 MiB, output 0.58 MiB; Ollama reports the loaded model as 19.1 GiB; the
  runner holds 19.29 GiB private (weights are repacked for CPU: 4,258.8 + 13,432.5 MiB). GPU working memory: NOT MEASURED.
- Ollama server settings in force for all authoritative runs: KV cache q8_0, flash attention on, NUM_PARALLEL 1
  (observed, not pinned: `evals/bench/ollama-server-env.observed.json`).
- Current CPU throughput: ~3.9-4.8 tok/s decode on AC at 8-11.5k-token prompts.
- Long-prompt first-token latency: up to ~274 s (b6 T08; 282 s T13 in the clean A2 run; 357 s max in the A2 runs = b5,
  on battery, historical; 801 s once pre-A2).
- T08 and T13 (and historically T03/T14/T17) TIMEOUTs are CPU/model-throughput limited: progressing, not stalled.

**Current machine**: AMD Ryzen AI 7 PRO 350 (8 cores / 16 threads), 31.2 GiB RAM, integrated Radeon 860M, no discrete
GPU; Windows 11 Pro 10.0.26200. Inference is CPU-only by configuration (`num_gpu 0` in the model).

**Measured throughput (AC, Q4_K_M)**:
| Measure | Value | Source |
|---|---|---|
| decode | 3.9-4.8 tok/s at 8-11.5k-token prompts | b6 T08 meter; T13 3.7-4.7 (clean A2) |
| decode, battery | ~2.4 tok/s | b5 (not used for timing) |
| first token | 5 s -> 274 s as the prompt grows 2.5k -> 11.5k tokens (282 s T13; 801 s once in cycle 8; 357 s max in the A2 runs) | meters |
| longest single request | 534 s (C) / 750 s (D, incl. one A2 retry) | b6 T08 |
| short prompt | 2,444 tokens: first token 81 s, decode 10.9 tok/s | quanttrial smoke 2026-10-03 |
| one captured 15-message request (43 KB), replayed cold | not finished after 9 min (aborted); 157 s in its original b6 run, where the prefix cache was warm | quanttrial smoke |

**Why the machine is the bottleneck**: in every T03/T08/T13/T14/T17 timeout the agent was progressing (each turn ends
in a tool call, no stall, no truncated stream left unrecovered) and ~1600 of T08's 1800 s is spent waiting for
generation; the reference agent passes all 18 tasks; contained and control time out identically (not containment).

**What C requires**: tasks T13, T14, T17, T04, T05, T03, T08, T01; 3 reps per mode, alternating = 48 task runs on one
pinned model + quant. On this CPU an 8-task suite takes ~2-2.5 h per mode and 5 of the 8 tasks cannot finish in their
(unchanged) timeouts, so C here would measure CPU limits, not the agent.

### HARDWARE DECISION STILL REQUIRED (yours; Hermes does not select hardware)
**GPU / VRAM**: the project does **not** specify a minimum GPU or VRAM, and none is derived here. PLAN only says "local
NVIDIA GPU with enough VRAM for the chosen quant ... at 32k context, or remote inference via tunnel-to-loopback + egress
policy". The sizes in FACTS MEASURED are inputs to your decision, not a requirement or a recommendation.

**Must be measured after installation** (`REPIN.md`): `ollama ps` = 100% GPU for the pinned model (no CPU split);
first-token latency and decode tok/s at short and ~11k-token prompts (quanttrial summary, cold cache; in-agent values come from the C meters); malformed tool-call rate per
quant on 434 samples; VRAM in use (`nvidia-smi`); T01 x4; then C's own timings. Timeouts stay unchanged unless a new
value is pre-registered in PLAN.yaml before the first C run.

**Model change needed on any GPU**: the pinned model has `PARAMETER num_gpu 0`, so it would keep running on CPU. The
re-pin rebuilds it with that one line removed (same weights, same other parameters, new digest): `REPIN.md` step 3.

**UNKNOWN UNTIL MEASURED ON THE NEW HARDWARE** (2026-10-04 dossier; every row is NOT MEASURED in
`evals/perf/HARDWARE-REPORT.md`, which `evals/bench/hwreport.mjs` fills from the re-pin's stage-1 hwprofile and the
first GPU perfreport):
- whether Q4_K_M weights (~17.3 GiB) + the 32k q8_0 cache (~1.6 GiB) + GPU compute/output buffers fit entirely in the
  new GPU's memory (`ollama ps` 100% GPU, `offloaded N/N layers`); the GPU compute buffer size is not known (240.1 MiB
  is the CPU value)
- the same for Q8_0 (~30 GiB is an estimate from the parameter count; no Q8_0 file has been downloaded)
- GPU driver/runtime that Ollama 0.34.4 selects (CUDA / ROCm / Vulkan) and whether it sees the GPU at all
- model load time, first-token latency at ~2.5k and ~11.5k-token prompts, decode tok/s, total request duration
- malformed tool-call rate per quant (quant trial, 434 samples)
- per-task duration, timeout rate and completion rate of T03/T08/T13/T14/T17 (the tasks whose CPU runs time out
  while progressing); whether they finish inside the unchanged timeouts is exactly what C measures
None of these has a threshold in the project; the only hard conditions are REPIN.md's (100% GPU, gates, T01x4,
quant decision recorded).

## Coverage: what has not run on the current pin, and what it is needed for
C's task list is T13, T14, T17, T04, T05, T03, T08, T01. D has no adopted definition beyond "after C (foundation
complete -> infrastructure phase)". Every "proposed" entry below is a PROPOSAL, NOT APPROVED.

| Item | Last run | Needed by C | Needed by D | Superseded by newer evidence | After A3/hardware |
|---|---|---|---|---|---|
| C re-baseline | never | is C | yes (D follows C) | no | run (it is C) |
| D gate | never | no | is D | no | run after C; definition PROPOSED, not adopted (below) |
| T04 | cycle 8 PASS both modes (pre-A2) | yes (C task) | via C | partly: A2 only changes truncated-stream handling and T04 had none | rerun inside C |
| T02 | cycle 6 contained PASS | no | proposed | no | full-suite run before D (proposal) |
| T06 | cycle 6 FAIL (agent's own tests: ERR_MODULE_NOT_FOUND) | no | proposed | no | same |
| T07 | cycle 6 FAIL (same error) | no | proposed | no | same |
| T09, T10 | cycle 6 PASS (graded at timeout) | no | proposed | no | same |
| T11, T12, T15 | cycle 6 FAIL (timeout) | no | proposed | no | same (T12's earlier PASS is INVALID, INV-001) |
| T16, T18 | cycle 6 PASS | no | proposed | no | same |

The 10 non-C tasks stay historical evidence (pre-A2 jcode, CPU, cycle 6) and are not reinterpreted.

**D gate: PROPOSED, NOT ADOPTED** (Hermes proposal; yours to adopt, change or reject before D; not needed for C):
1. C must pass (its pre-registered decision rule);
2. then one 18-task contained + control run on the final pin
(the infrastructure phase re-checks only the 8-task set, so the other 10 would otherwise never run on the final pin).

## Ollama auto-update (manual action, yours; NOT done)
Validated runtime: **Ollama 0.34.4** (running, `/api/version` 2026-10-04 11:50). Auto-update is still ON: Ollama's
settings DB has `auto_update_enabled=1` (read-only checks 2026-10-03 and 2026-10-04 11:50), the app checks hourly, and
the 0.35.1 installer is already staged (`%LOCALAPPDATA%\Ollama\updates_v2\d5a1390e...\OllamaSetup.exe`, 1.58 GB). It
installs when the Ollama app restarts. Hermes did not change the setting, did not restart Ollama, did not upgrade, and
did not delete the staged installer (deleting it is not established as necessary once the setting is off, and it is
outside the repo). **Before the next Ollama restart**, to keep 0.34.4:
1. Ollama tray icon -> Settings -> disable automatic updates. Do not quit or restart Ollama before that.
2. Optional, your call: deleting the staged folder
   `%LOCALAPPDATA%\Ollama\updates_v2\d5a1390e1510962fac384c97d09b6e4febbffa2797435085c39a80b809b3be06` removes the
   bundle; whether the app would install an already-staged bundle with the setting off is not verified.
3. Check: `curl http://127.0.0.1:11434/api/version` still `0.34.4`; `app.log` stops logging "New update available".
If 0.35.1 ever installs, the pin gate refuses every run (exit 2): reinstall 0.34.4 or re-pin deliberately (REPIN step 2).

## Hermes compression model (operational configuration, NOT an evaluation-baseline change)
- **Now (changed 2026-10-04 at your instruction)**: `C:\Users\cierra\AppData\Local\hermes\config.yaml`,
  `auxiliary.compression`: provider `main`, model `''` (empty = main chat model). Set with
  `hermes config set auxiliary.compression.provider main` and `hermes config set auxiliary.compression.model ""`; only
  those two lines changed (backup: `config.yaml.bak-before-compression-main`). Unchanged: timeout 120 s and the
  fallback chain (`openrouter inclusionai/ling-3.0-flash-fin:free`, then `together meta-llama/Llama-3.3-70B-Instruct-Turbo`),
  which is used only if the main provider fails, so conversation text can still reach those endpoints in that case.
- **Was**: provider `openrouter`, model `stepfun/step-3.7-flash:free`.
- **Verified (no API call, no benchmark)**: Hermes's `load_config` reads `main` / `''`; the compression task resolver
  maps `main` -> `nous` and builds the client: Nous Portal `https://inference-api.nousresearch.com/v1/`, model
  `anthropic/claude-opus-5.5` (= the main chat model). `hermes doctor` reports
  "auxiliary.compression.provider 'main' does not resolve": a doctor false positive (its check uses the main-agent
  resolver, which has no `main` alias; the docs list `main` as valid for `auxiliary.compression`, and the task
  resolver above accepts it). Cost: each compaction is billed at the main model's rate.
- **Effect on evaluation validity: none on the measurements.** It only summarises Hermes's own conversation when the
  context fills. The evaluated agent is jcode -> broker -> meter -> Ollama on loopback; grading is run.ts on disk files.
  Two indirect risks: (a) a summary can drop details the operator then mis-reports: this session's summarizer failed
  several times (deterministic fallback), which is why PLAN/HANDOFF and the archive are the source of truth; (b) data
  egress: the conversation (paths, logs, evidence) goes to a free third-party endpoint.
- With `main`, risk (b) applies only on the fallback path; risk (a) applies to any summarizer.
- **Not touched by this change**: the repo, run.ts, suite.sh, gates, `baseline-env.json`, the jcode pin, Ollama and the
  model. Hermes's config.yaml is outside the repo and is not a pinned input of any evaluation run.
- To revert: `hermes config set auxiliary.compression.provider openrouter` and
  `hermes config set auxiliary.compression.model stepfun/step-3.7-flash:free` (or restore the backup).

## AGENTS.md
Line 3 said "LM Studio, Omnicoder 9B" with 10-30 tok/s: stale (the agent runs on Ollama 0.34.4, hermes-local-32k,
CPU, ~3-5 tok/s). Corrected in its own commit (`2a8c443`) to describe the current validated environment (no future hardware).
**Finding**: eval sandboxes are built from the `eval-baseline-v1` tag's blobs (run.ts `extractTree`), not from HEAD, and
the tag holds the old text. So the HEAD correction does not change what the evaluated agent reads, and the validated
baseline is untouched. C keeps `eval-baseline-v1` (same text in every mode and rep, so it cannot bias contained vs
control). Moving the agent's copy too would mean a new baseline tag, with reference-agent 18/18 and new fingerprints,
as a separate deliberate change.

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

## Power integrity (5d3e8fe)
The b5 Phase B run went on battery and the laptop slept 00:54-11:14 unnoticed. Now `keepawake.ps1` holds off idle
sleep for a whole suite (best effort; a battery-critical or power-button sleep still happens), and `sleepcheck.ps1`
reads the System log for the run window: **a run that slept exits 7 and is not evidence**; AC/battery and power-source
changes are recorded in `ev-<label>/power.txt` with a POWER WARNING (battery timings are not comparable with AC).
Re-checked: the clean A2 window had no sleep, so that validation stays VALID. The b5 battery/sleep run is kept on
record but is not timing evidence. **Keep the laptop plugged in for runs.**

## Phase B (COMPLETE)
Accept rule: no T05 failure ends on an unrecovered incomplete stream; retries bounded and logged. Met.

| Run | Result |
|---|---|
| T05, 10 authoritative runs (validation_a2_clean 4+4, b6 1+1) | contained 5/5 PASS; control 3 PASS + 2 TIMEOUT at 1201 s (tests passed when graded); 6 A2 retries, 0 gave up |
| b6 (2026-10-03 11:25-12:50, AC, no sleep, no external activity): VALID | T05 contained PASS 497 s (2 retries); T05 control PASS 373 s |
| b6 T08 contained / control | TIMEOUT 1806 s / TIMEOUT 1801 s (1 retry, recovered) |
| b6 gates, fingerprints, repo, ~/.jcode | PASS; 0 mismatches; unchanged; unchanged. TRIPs: contained 0, control 407 all attributed |
| b5 (battery, slept after the last task): not authoritative for timing | T05 contained **FAIL** (model, below); T05 control PASS 657 s; T08 TIMEOUT both |

- **b5 T05 contained FAIL is model behaviour and stays on record.** The agent fixed the bug, then rewrote the protected
  test file, failed to revert it (it sent `edits` as a string; even parsed, its old_string would have broken the file),
  and then claimed it never touched the test. The grader caught it. No truncated stream. Not reproduced in b6.
- **T08 is a CPU-throughput TIMEOUT.** The reference agent passes it (18/18), so the grader is passable. In b6 both modes
  progress continuously (every turn ends in a tool call; no stall), first token grows to 274 s as the prompt reaches
  11.5k tokens, decode 3.9-4.8 tok/s, one request took 534-750 s; at 1800 s the agent had made 1-2 of the needed file
  changes. Contained and control behave the same. Battery was slower (2.4 tok/s). The pre-A2 control failure (exit 0 on a
  truncated stream) did not recur: A2 retried it. Timeout left at 30 min.

## Other test status
| Test | Result |
|---|---|
| T03, T14, T17 (cycle 8, pre-A2) | as recorded: contained PASS(to) x3 (= TIMEOUT; T03 at 901 s: wrapper says the agent exited by itself, record kept); control T03 PASS, T14 FAIL(to) (= TIMEOUT; also build errors), T17 PASS. CPU: slow but progressing; no truncated streams, so A2 cannot change them |
| T08 contained (cycle 8, pre-A2) | TIMEOUT 1803 s (one turn waited 801 s for the first token) |
| T08 control (cycle 8, pre-A2) | FAIL at 948 s on the A2 defect, not a timeout |
| T08 post-A2 | TIMEOUT both modes (b6 AC, b5 battery); see Phase B |
| Reference agent, all 18 tasks (2026-10-03) | PASS 18/18 (every grader passable) |
| T04 (cycle 8) | PASS both modes; NOT RUN after A2 (in C) |
| T02, T06, T07, T09-T12, T15, T16, T18 with jcode | NOT RUN since cycle 6 (see Coverage) |
| jcode stream unit tests | PASS 42/42 (7 new) |
| jcode runtime crate unit tests | 4 FAIL, pre-existing: identical on the pre-A2 and A2 source (provider-profile / API-key autodetection; untouched) |
| A2 scenario tests (fake server, old vs new binary) | PASS (intended behaviour in all 7 scenarios) |
| One T01 contained in the first final-gate pass (cycle 8) | FAIL: meter died (harness); cause unknown (output not saved then). Identical rerun PASS. Not reproduced since; a recurrence now stops the run with exit 6 and keeps ev-<label>/meter.out |
| jcode edit-tool unit tests (A3) | PASS 20/20 (3 new) |
| A3 scenario tests (fake server, pinned vs A3) | PASS; re-run 2026-10-03 as `editstring.mjs` both ways |
| Final regression (2026-10-03 13:17) | PASS (see "Final regression") |
| gates.sh (2026-10-03 evening) | 15/15 PASS |
| C re-baseline | NOT RUN, blocked on H |
| Offline harness tests (2026-10-04) | `node --test "evals/test/*.test.mjs"` 158/158, `lint.sh` PASS, `suite-lifecycle.sh` 6/6, `watch-smoke.sh` PASS, `suite-midrun.sh` model-fail / meter-dies / trip-review PASS |
| A2 vs A3 offline (`a3offline.mjs`, 2026-10-04) | PASS (see A3) |

## Final regression (2026-10-03 13:17-13:22, HEAD 5d3e8fe, AC, no external activity)
| Check | Result |
|---|---|
| Gates: bare v22 node / unreachable model server / old jcode / **unpinned A3 candidate** | each refused, exit 2 |
| contained-child 10/10, security probe 20/20, relay 12/12, contained e2e 9/9 | PASS |
| Meter kill-abort | PASS (request after a killed generation: ttfb 176 ms; meter_aborted_upstream) |
| Zero-task suites, contained + control (power path, keepawake set/released) | exit 0; power.txt AC, no sleep; TRIP 0 |
| Repo fingerprint, git status, ~/.jcode (656 entries, tree 03835244...) | unchanged |

Per-task fingerprint reproducibility: shown in b6 (control vs contained, 0 mismatches) and again by the T01 x4 check.
Archive: `cycle9/final-regression`.

## Meter incident (found and fixed in A0)
When a task hit its timeout, the agent was killed but meter.mjs kept its own request to Ollama open, so Ollama kept
generating for nobody and the next task queued behind it. Fixed in `bab3a17` (re-verified in the clean run: request
after a killed generation answers in 173 ms). A meter that dies mid-run is detected (`170cbd5`, exit 6).
`meterabort.mjs` now checks this as a gate and fails on the pre-fix meter.

## Open decisions (yours)
1. **Hardware / GPU / VRAM** (H), before C: the only decision blocking progress. No minimum is specified by the project;
   see "Hardware decision".
2. **Push**: whether/where `cierra-wip-2026-09-29` (origin has `6ca495a`; local is ahead) and the jcode-evalpin branches
   (no upstream) should go. Hermes has not pushed.
3. **D gate definition** (adopt / change / reject the PROPOSAL in Coverage): needed before D, not before C. If adopted,
   the implementation burden is small (existing suite.sh/reduced.sh with all 18 tasks); what it would still need is a D
   decision rule and timeouts for the 10 non-C tasks (PLAN `D_gate.preparation_if_adopted`).
4. **Ollama server settings**: keep them observed-only, or pin them (KV q8_0, flash attention, ...) as part of the re-pin.
5. **After the re-pin**: the quant (step 12) and C's pre-registration (reps, order, timeouts, decision rule).
6. **Housekeeping** (optional; `evals/AUDIT.md` 21.5): 131 sandbox roots under `%TEMP%\agent-evals` (~36 GiB; re-analysis
   reads them; 13 are from the 2026-10-04 real-process tests), the staged Ollama 0.35.1 installer. Recommendation: keep
   both until C is archived. Nothing has been deleted.
7. **Suite policy**: a TRIP needing review (VIOLATION/UNATTRIBUTED) now writes `ev-<label>/TRIP-NEEDS-REVIEW` and the
   last line says so, but the exit code is still 0. Decide whether it should fail the suite (own exit code).
8. **C pre-registration detail**: SETUP_FAILED tasks are excluded from the score (status contract); say whether C re-runs
   them.

Manual action, not a decision: disable Ollama automatic updates before the next Ollama restart ("Ollama auto-update").
Already decided: A3 adopted as candidate for the next re-pin; compression on the main provider.

## Post-checkpoint hardening (2026-10-04)
Autonomous non-hardware backlog; details and the full audit in `evals/AUDIT.md`. Defects fixed (none touched a pin, a
baseline, a grader, a timeout or any recorded result):
1. A run that hit its time limit was scored PASS when the grader passed (22 historical results.json entries say
   `pass: true, timedOut: true`; the documents already counted them as TIMEOUT). Now TIMEOUT, never PASS (`326ba4e`).
2. suite.sh dropped run.ts's exit status (a refused run looked done), left meter/watch/keepawake running after Ctrl+C,
   and could adopt a leftover meter (`ef0c8df`); an unsafe label could make its `rm -rf` leave the output dir (`dc281ad`).
3. The watchdog called 127.0.0.2 non-loopback (every control-run TRIP pair) (`542d6c8`).
4. Fake-provider jcode runs had no telemetry opt-out (`1fc6f7f`).
5. quanttrial counted transport faults as malformed calls and put 0 s timeouts into the ttfb median (`3fa1a60`).
6. An Ollama restart mid-suite turned later tasks into model FAILs; now exit 11, not evidence (`8336189`).
7. Two runs started in the same minute shared a run id: the second overwrote the first (`f26e6ff`; archive check: it
   never happened to archived evidence).
8. cpreflight's own test step used an argument form node 26 rejects (`5fa5740`).

## Second pre-hardware audit (2026-10-04, after the checkpoint)
Re-review of the 20 commits since `bfad054` by tracing, plus fuzzing, fixtures and real-process tests (no inference,
no pin/baseline/grader/timeout/result change). Details: `evals/AUDIT.md` section 21. Defects found and fixed:
1. Missing termination evidence: a jcode run whose wrapper exited 0 without its `agent exit=... timedOut=...` line
   could still be graded PASS (elapsed-time fallback); now AGENT_STATUS_UNKNOWN. analyze.mjs still counted legacy
   `pass: true, timedOut: true` entries as PASS in its totals (2026-09-28 baseline printed 10/18; in time it is 7/18
   + 3 TIMEOUT); now TIMEOUT (`8e7ec62`). 1,296-combination fixture sweep: PASS only for CLEAN + in-time + grader PASS.
2. Monitoring: unparsed TRIP lines were dropped; warm-up, probe and pin-query attribution were too broad; IPv4-mapped
   loopback; Ollama clients on other addresses; failed samples looked clean (`83a0fdc`). Archive unchanged: 1,686
   TRIPs, 0 VIOLATION, 0 UNATTRIBUTED.
3. repin.mjs: a recorded stage could be re-run in place (evidence overwritten); 5-6 without --apply locked the record; a
   damaged record was silently replaced; --restart left outputs to be overwritten; stage 12 did not check the live
   digest (`cbb730e`). cpreflight: 33 single-prerequisite fixtures BLOCKED, a full future-state fixture READY.
4. Security review: run-id race, unvalidated METER_LISTEN/UPSTREAM in a PowerShell command, unguarded `rm -rf` of test
   scratch args (`eb4cb4f`); `taskkill /F` portability (`f933a4e`).
5. A flagged TRIP was easy to miss (exit 0, mid-output line); now a marker file and the last line (`9c9bf85`).
New: `evals/RUNBOOK-POST-HARDWARE.md` (exact post-hardware sequence), `evals/perf/HARDWARE-REPORT.md` + `hwreport.mjs`,
`a3stress.mjs` (A3 candidate evidence: PASS), `test/suite-midrun.sh` (real contained suite: model failure -> FAIL /
exit 0; meter killed -> exit 6 in ~2 min; stray Ollama client -> TRIP-NEEDS-REVIEW; no surviving process).

## Hardware-ready checkpoint (2026-10-04, re-confirmed)
Done: everything not needing new hardware. Not started: C, re-baseline, A3 pin, Ollama change, hardware selection.
Next step after your hardware decision and installation: follow `evals/RUNBOOK-POST-HARDWARE.md` (step 0, auto-update off, is possible now); its core is `evals/bench/repin.mjs --out <R> --stage 1` (= `evals/REPIN.md`
step 1; `--dry-run` shows every stage first), then the stages in order, then `evals/bench/cpreflight.mjs --repin <R>`.

## To resume in a new Claude chat
Paste:
```
Read evals/PLAN.yaml, evals/HANDOFF.md and evals/REPIN.md in C:\Users\cierra\Desktop\agent creator. Then tell me in 3 lines where we are and what's next. Keep answers short; I'm cost-conscious.
```

## Notes
- Rebuilding jcode: see `pins.jcode_build` in PLAN.yaml (GNU toolchain first on PATH; set `JCODE_BUILD_GIT_HASH`).
- Benchmarks: machine on AC and exclusive; running jcode/Ollama by hand during a run contaminates it (happened twice).
- Chat UI specs (`data/spec-chat-ui-*.md`) are blocked on roadmap Step 2. A review found 10 gaps to close first:
  attach-vs-no-attachments conflict, border contrast ~1.3:1, missing meta/dark-mode colors, no `system` role style,
  no task-state UI, undefined retry, ambiguous group timestamp, hover-only actions on touch, untestable visual gate,
  "ready" status despite no UI existing.
- Auto mode is now the default permission mode in `~/.claude/settings.json` (backup: `settings.json.bak-before-automode`).
