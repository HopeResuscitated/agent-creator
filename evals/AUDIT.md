# Harness audit (2026-10-04, post hardware-ready checkpoint; second pass in section 21)

Scope: everything in `evals/` that can affect evidence, done without hardware, without a re-pin and without changing any
acceptance criterion. Every defect below was fixed in its own commit with a test; nothing in the evidence archive or in
`evals/results/` was rewritten. Status of the project itself: `evals/PLAN.yaml`, `evals/HANDOFF.md`
(`node evals/bench/status.mjs` derives it; `--check` verifies consistency).

## 1. Inventory

| Area | Files |
|---|---|
| Runner + classification | `run.ts` (gates, staging, sandbox from tag `eval-baseline-v1`, fingerprint, grading), `outcome.ts` (final class), `checks.ts` + `hidden/*.hidden.test.ts` (graders), `tasks.json`, `reference/solve.ts` (reference agent) |
| Containment | `tools/run-in-job.ps1` (Job Object, AppContainer, ACLs, fixed env, broker), `tools/model-relay.mjs`, `tools/contained-child-test.mjs` |
| Suites | `bench/suite.sh`, `bench/reduced.sh`, `bench/t05x6.sh`, `bench/probe.sh`, `bench/node.sh` / `node.ps1` (runner-node pin) |
| Model path / meter | `bench/meter.mjs`, `bench/meterabort.mjs`, `bench/ollamaenv.mjs` + `ollama-server-env.observed.json` |
| Monitoring | `bench/watch.ps1`, `bench/tripclass.mjs`, `bench/attrmon.ps1`, `bench/keepawake.ps1`, `bench/sleepcheck.ps1` |
| Integrity | `bench/fp.mjs` / `fpcmp.mjs` (repo), `bench/evfp.mjs` (~/.jcode) |
| Security / byte tests | `bench/secprobe.*`, `bench/killprobe.mjs`, `bench/streamprobe.*`, `bench/relaytest/*` |
| Analysis | `bench/analyze.mjs`, `classify.mjs`, `reanalyze.mjs`, `coverage.mjs`, `perfreport.mjs`, `hwreport.mjs` |
| Re-pin / C | `bench/gates.sh`, `t01x4.ps1`, `editstring.mjs`, `a3offline.mjs` + `a3stress.mjs` + `fakeprov.mjs`, `quanttrial.mjs`, `hwprofile.ps1`, `perfsample.ps1`, `repin.mjs`, `cpreflight.mjs`, `status.mjs` |
| Offline tests | `test/*.test.mjs` (158 tests, seconds), `test/lint.sh`, `test/docrefs.mjs`; real-process: `test/suite-lifecycle.sh` (6 cases), `test/watch-smoke.sh`, `test/suite-midrun.sh` + `fakeupstream.mjs` (real contained suite vs a stand-in upstream); helper `test/scratch.sh` |
| Records | `PLAN.yaml`, `HANDOFF.md`, `REPIN.md`, `INVALIDATIONS.md`, `README.md`, `RESUME.md`, `RUNBOOK-POST-HARDWARE.md`, `perf/` (CPU baseline, HARDWARE-REPORT.md), `baseline-env.json` (pins) |

Findings that are not defects (kept, nothing deleted):
- No TODO/FIXME in harness code (the `TODO` hits are task fixture content).
- Standalone or historical tools with a single reference: `bench/killprobe.mjs`, `bench/reanalyze.mjs` (both in
  `bench/README.md`), `tools/probe.sh` + `tools/kill-sandbox-procs.ps1` (one-off jcode tool-call probe, unrelated to
  `bench/probe.sh`), `tools/ollama-toolcall-proxy.mjs` (cycle-era proxy, referenced only by `RESUME.md`). Not used by any
  suite; kept as history.
- Duplication: the fake-provider config exists in `editstring.mjs` (validated re-pin step, left untouched) and
  `fakeprov.mjs`; `test/fakeprov.test.mjs` asserts they are byte-identical.
- 21 `catch {}` / `|| true` sites in the harness: all are best-effort reads whose failure is reported elsewhere
  (e.g. a missing file shows as "unreadable"/null and fails the check that needs it). None turns an error into PASS.
- Documentation references: `test/docrefs.mjs` resolves every path, machine path and commit hash in the evals docs.

## 2. Run lifecycle (suite.sh -> run.ts -> run-in-job.ps1 -> jcode -> meter -> Ollama)

| Stage | Can fail by | Result / exit | Propagated? (after this audit) |
|---|---|---|---|
| suite.sh args | bad mode/label | 2, nothing created | yes; label could escape `<out>` before `dc281ad` |
| meter port | port in use | 1 | **was adopted as "the meter"**: fixed `ef0c8df` |
| node pin (`node.sh`) | other node | 3 | yes |
| fingerprints pre | - | fp/ev-pre.txt | - |
| Ollama settings + start time | unreadable | recorded | restart detection added `8336189` (exit 11) |
| meter start | dies at start / mid-run | 1 / 6 | yes (`170cbd5`) |
| keepawake / sleep | machine slept | 7 | yes (`5d3e8fe`) |
| run.ts gates (node, jcode sha, Ollama version, model digest) | mismatch | run.ts 2 | **was lost in `| tee`; suite said done**: fixed `ef0c8df` (exit 8) |
| sandbox | prepare/extract fails | run.ts error | exit 8 |
| run id | same-minute second run | - | **overwrote the first run, deleted its sandboxes**: fixed `f26e6ff` |
| run-in-job.ps1 | setup fail / unsafe tree / status lost / anything else | 4 / 3 / 5 / other | SETUP_FAILED (excluded) / UNSAFE_PROCESS_TREE / AGENT_STATUS_UNKNOWN / UNSAFE_PROCESS_TREE; never graded |
| jcode | crash, timeout, hallucinated tool | exit code in wrapper note | graded on files; timeout -> TIMEOUT |
| env integrity | node_modules changed | ENV_CONTAMINATED / ENV_RESTORE_FAILED | never PASS |
| grading | grader verdict | graderPass | **TIMEOUT + grader PASS was PASS**: fixed `326ba4e` |
| repo / ~/.jcode post | changed | printed only | **now exit 10** (`ef0c8df`) |
| interrupt | Ctrl+C / TERM / HUP | - | **meter/watch/keepawake left running**: now exit 130 + cleanup (`ef0c8df`) |
| reduced.sh | any suite exit != 0 | stops with that code | yes |

Cleanup cannot hide the original failure: every check prints before the exit code is chosen, and the exit code is
chosen by a fixed precedence (11, 7, 8, 10) after all evidence files are written.

## 3. Result classification (integrity)

All paths now go through `outcome.ts` (`evals/test/outcome.test.mjs`, 16 tests):
- timeout -> pass: **was possible** (22 historical results.json entries have `pass: true, timedOut: true`; documents
  already called them TIMEOUT; files not rewritten). Now TIMEOUT; the grader verdict is kept as `graderPass`.
- timeout source: the wrapper's `agent exit=... timedOut=...` line, not elapsed time (elapsed time only for non-jcode
  agents; a jcode run without the line is AGENT_STATUS_UNKNOWN since `8e7ec62`). Of 202 historical results with a wrapper line, 1 disagrees with the recorded flag: cycle-8 T03
  contained, 901 s on a 900 s limit, recorded timedOut, wrapper "agent exit=0 timedOut=False". The record is kept and
  documented as TIMEOUT; it is pre-A2 historical evidence.
- missing evidence -> pass: **was possible until `8e7ec62`**: a jcode run whose wrapper exited 0 without its
  termination line fell back to elapsed time and could be graded. Now AGENT_STATUS_UNKNOWN (not graded); none of the
  202 historical jcode CLEAN/CONTAMINATED results lacks the line. An unknown env string classifies as
  UNSAFE_PROCESS_TREE. Fixtures: `evals/test/timeout-integrity.test.mjs` (section 21.2).
- contaminated -> authoritative: ENV_* never pass; contaminated suite runs are not evidence (exit 10/11/6/7/8).
- process crash -> success: any wrapper status other than 0/4/5, spawn error or outer timeout -> UNSAFE_PROCESS_TREE.
- partial response -> complete: jcode retries incomplete streams (A2); discarded text never re-sent (a3offline S6).
- quanttrial: a transport failure after the 200 status was counted as a malformed tool call; now `stream_error`.

## 4. Pinning and reproducibility

| Item | Class | Where |
|---|---|---|
| runner node 26.7.0 (+ staged copy) | PINNED | baseline-env.json `node`, `node_sha256`, `node_staged_sha256` |
| jcode binary | PINNED (A2 sha256) | `jcode_sha256`; run.ts refuses others |
| Ollama version | PINNED | `model_server.ollama_version` |
| model weights + Modelfile parameters/template | PINNED (digest covers them) | `model_server.models` |
| task tree | PINNED | tag `eval-baseline-v1` (sandboxes extracted from the tag) |
| node_modules | PINNED | `packages` + golden fingerprint, checked per task |
| agent config / args / env | PINNED by fingerprint | `effective-config.json` per run |
| Ollama server settings (KV q8_0, flash attention, NUM_PARALLEL, CONTEXT_LENGTH, KEEP_ALIVE, Vulkan/iGPU) | UNPINNED, recorded (REQUIRES-DELIBERATE-BASELINE to pin) | `ollamaenv.mjs`, `ollama-server-env.observed.json` |
| Ollama auto-update | EXTERNAL (manual off) | `cpreflight` checks `auto_update_enabled` |
| harness code (run.ts, suite.sh, ...) | UNPINNED, recorded per run (`head.txt`) | git |
| CPU, RAM, GPU, drivers, CUDA/Vulkan, placement | HARDWARE-DEPENDENT | `hwprofile.ps1` |
| sampling (temperature 0.15, no seed) | stochastic by design | reps in C |
| jcode telemetry | EXTERNAL, opted out | wrapper env; fake-provider tools since `1fc6f7f` |

## 5-6. A3 offline evidence; re-pin automation
`a3offline.mjs`: identical A2/A3 behaviour on 16 of 18 scenarios, E2/E3 differ as designed, invariants hold, ~/.jcode
unchanged. `repin.mjs` implements REPIN.md (ordered, fail-closed, record, `--dry-run`); `cpreflight.mjs` gates C.

## 7. Interruption and recovery

| Event | Behaviour now | Resumable? |
|---|---|---|
| Ctrl+C / terminal closed (TERM/HUP) | suite exits 130, stops meter/watch/keepawake, writes INTERRUPTED; run.ts's Job Object kills the agent tree with the wrapper. A TERM sent to suite.sh's bash process alone (not its process group) is handled only when the foreground run.ts returns: measured 910 s (T01's 15-min timeout), then exit 130, no surviving process. Ctrl+C in the terminal signals the whole group and stops at once | rerun the suite; no partial results.json (written at the end) |
| jcode dies | wrapper exit code recorded; task graded on files | per-task result stands |
| Ollama dies / restarts | **was silent**; now exit 11 | rerun |
| meter dies | exit 6 | rerun |
| broker/relay failure | wrapper setup fail -> exit 4 SETUP_FAILED (not graded) | rerun task |
| machine sleep | exit 7 | rerun |
| network loss | irrelevant to contained runs (loopback only); control-mode egress is recorded by watch | - |
| timeout | TIMEOUT (wrapper kills the tree; meter aborts upstream) | - |
| partial stream | jcode A2 retry (cap 2), meter records it | - |
No automatic retry was added (it could duplicate tool execution).

## 8. Temporary files

| Creator | Location | Cleanup | Risk / fix |
|---|---|---|---|
| run.ts | `%TEMP%\agent-evals\<runId>\<task>` + `_agent-tools` | kept (analysis reads them) | collision fixed (`f26e6ff`); 114 dirs from 2026-09-28 on |
| run.ts `--prepare` | `%TEMP%\agent-evals\manual\<task>` | replaced on the next `--prepare` of the same task | by design; do not keep manual work there |
| run.ts env restore | `<ws>.contaminated-node_modules-<t>` | kept as evidence | - |
| suite.sh / probe.sh | `<out>\ev-<label>`, `<out>\outside` | `rm -rf ev-<label>` at start | label validated (`dc281ad`) |
| editstring / a3offline / meterabort | `%TEMP%\{editstring,a3offline,meterabort}-*` (mkdtemp) | kept for inspection | own unique dirs; never touch user files |
| quanttrial test, repin dry-run, evfp helper | mkdtemp | removed | - |
None of these are inside the repo; `fp.mjs` ignores `evals/results`; sandboxes come from the tag, so cleanup cannot
change the baseline.

## 9. ~/.jcode
Contained and config-equivalent control runs use a generated agent home (JCODE_HOME); only the debug flag
`--control-user-config` uses the user's ~/.jcode (never used by suite.sh/t01x4/gates). Guards: suite.sh exit 10,
a3offline and re-pin stage 4 compare `evfp.mjs` before/after. Fingerprint after every jcode run of 2026-10-04:
`entries=656 tree=03835244f0155e66...` (unchanged).

## 10. Monitoring
`watch.ps1` treated 127.0.0.2 as non-loopback (false TRIP pairs in every control run) and could not tell the eval agent
from a manual jcode; fixed (`542d6c8`, loopback 127.0.0.0/8, `root=eval|external`). `tripclass.mjs` attributes every
TRIP (warm-up curl, vanished process inside the recorded warm-up window, run.ts pin query, probe, control traffic);
other Ollama clients and external jcode trees stay UNATTRIBUTED, contained meter clients are VIOLATION. Archive
re-attribution (b6 + a2val3, 1,686 TRIP lines): all attributed, 0 VIOLATION. `attrmon.ps1`: run.ts pin query is
`eval-gate`.

## 11. Windows specifics
No project script passes `/dev/null` or `/tmp` to a native tool (`lint.sh` enforces it; the exit-23 curl case was an
ad-hoc command). `.sh` files are LF (`.gitattributes`, checked by lint); every `.ps1` parses (lint). Fixed during this
audit: MSYS path handed to native node (test only), PowerShell one-element-array unrolling (hwprofile), node 26 `--test`
with a directory argument (cpreflight, `5fa5740`), keep-alive sockets left on Ollama by new tools (`agent: false`).
Timestamps: watch.ps1 (`Get-Date -Format s`, local) and `date -Iseconds` (offset) compare correctly.

## 12-19. Status, hardware, performance, quant trial, coverage, C, D
- `status.mjs` (derived status, `--check`), `hwprofile.ps1`, `perfreport.mjs` (no thresholds), CPU baseline in
  `evals/perf/`.
- `quanttrial.mjs`: cold-cache caveat kept; cache share and model start state now recorded; warm-only ttfb median.
- `coverage.mjs`: on the A2 pin only T01, T05, T08, T13 have runs; T03, T04, T14, T17 (C tasks) and the 10 non-C tasks
  were last run pre-A2. Consistent with HANDOFF "Coverage".
- C: `cpreflight.mjs` BLOCKED today (10 reasons, all hardware / re-pin / pre-registration / auto-update).
- D: PROPOSED only. Burden if adopted: no new harness code (suite.sh/reduced.sh with all 18 tasks); missing would be a
  D decision rule, timeouts for the 10 non-C tasks, and a preflight variant requiring C = PASS (PLAN
  `D_gate.preparation_if_adopted`).

## 20. Repository hygiene (recommendations; nothing deleted)

| Item | State | Recommendation |
|---|---|---|
| branches | `cierra-wip-2026-09-29` (ahead of origin, never pushed by Hermes), `main` (ahead of origin by 5) | push decision is yours |
| worktrees / stashes | one worktree; no stashes | - |
| jcode-evalpin | `eval-pin-74577fe83` (A2), `eval-pin-a3-candidate` (A3); clean; origin = upstream jcode | keep both until the re-pin is done |
| binaries | `jcode-evalpin-bin` (superseded 1fbb2e1b4; used as a refusal probe by gates.sh), `-a2-bin`, `-a3cand-bin`, `C:\Users\cierra\jcode.exe` (unrelated build) | keep: gates.sh needs the superseded binary |
| `evals/results/` | ignored by git; 72 jcode run dirs (36 archive-linked) + reference/none runs incl. 2026-10-04 smoke runs | the archive holds the evidence; local-only dirs are not evidence |
| `%TEMP%\agent-evals` | 131 sandbox roots (2026-09-28 on; 13 from this audit's real-process tests), ~36 GiB | keep; see 21.5 (re-analysis reads them) |
| `%TEMP%\editstring-*` etc. | small test leftovers | safe to delete any time |
| evidence archive | `C:\Users\cierra\hermes-bench-archive` 1.4 GB | keep |
| Ollama 0.35.1 installer staged | `%LOCALAPPDATA%\Ollama\updates_v2\...` | leave until you decide on auto-update; deleting does not stop a future download |
## 21. Second-pass audit (2026-10-04, before the hardware change)

### 21.1 The 20 commits since `bfad054`, re-reviewed by tracing (not by their tests)
| Commit | Intent | Tests | Finding on re-review | Affects evaluation semantics |
|---|---|---|---|---|
| `326ba4e` outcome.ts | TIMEOUT never PASS | outcome.test | **gap**: a jcode run whose wrapper exited 0 without its `agent exit=... timedOut=...` line fell back to elapsed time and could be graded PASS; **gap**: analyze.mjs totals/REGRESSION/IMPROVED used `r.pass`, so legacy timed-out passes still counted as PASS (2026-09-28 baseline printed 10/18, 7/18 in time). Both fixed (`8e7ec62`) | yes (stricter; no recorded result changes: all 202 historical jcode CLEAN/CONTAMINATED results carry a valid line) |
| `ef0c8df` suite exit codes, interrupt | failures not hidden by tee; cleanup on INT/TERM/HUP | suite-lifecycle | correct; **observed**: a TERM sent to suite.sh's bash alone is handled only after the foreground run.ts returns (bash defers traps while waiting), i.e. up to the task timeout (measured: 910 s, exit 130, no survivors). Ctrl+C in a terminal signals the whole process group and stops at once. Documented, not changed | no |
| `542d6c8` watch/tripclass | attribute every TRIP | tripclass.test, watch-smoke | **gaps** (fixed `83a0fdc`): unparsable TRIP lines silently dropped; warm-up curl attributed by command line at any time; streamprobe attributed outside probe dirs; run.ts pin query attributed for a sandbox copy; IPv4-mapped loopback; Ollama clients dialing an address other than 127.0.0.1 not watched; a failed sample looked clean. Archive re-check unchanged: 1,686 TRIPs, 0 VIOLATION, 0 UNATTRIBUTED | monitoring only |
| `e536696` lint.sh | syntax + portability | itself | ok | no |
| `dc281ad` unsafe labels | rm -rf stays inside `<out>` | suite-lifecycle | ok; same class of bug found in the test scripts' scratch dirs (fixed `eb4cb4f`) | no |
| `75c6faa` Ollama settings | recorded, not pinned | ollamaenv.test | ok; classification below (21.4) | no |
| `1fc6f7f` a3offline + telemetry opt-out | A2 vs A3 offline | fakeprov.test | ok; extended by a3stress (21.3) | no (candidate evidence) |
| `3c80c51` docrefs | docs vs tree | docrefs.test | ok; now also checks RUNBOOK-POST-HARDWARE.md | no |
| `0ff6333` hwprofile/perfreport | descriptive perf | perfreport.test | ok; hwreport.mjs added (21.5) | no |
| `3fa1a60` quanttrial | stream_error, warm median | quanttrial.test | ok | no (post-hardware tool) |
| `e2b60d0` repin/cpreflight | executable re-pin, fail-closed C gate | repin.test | **gaps** (fixed `cbb730e`): recorded stages could be re-run in place (evidence overwritten); 5-6 without --apply locked the record; a damaged record was replaced by an empty one; --restart left stage outputs to be overwritten; stage 12 did not compare the live digest with the pin; no artifact hashes | no (procedure only) |
| `630f57b` coverage | matrix | coverage.test | ok | no |
| `8223379` ~/.jcode guard | fake-provider runs leave ~/.jcode alone | a3offline/a3stress output | ok (656 entries, tree 03835244... after every run today) | no |
| `8336189` Ollama restart -> exit 11 | not evidence | suite-lifecycle | ok; unreadable start time also exits 11 (fail closed) | no |
| `f26e6ff` run id | no reuse | outcome.test | **race**: check ran before the pin gates; claim now atomic (`eb4cb4f`); 3 concurrent starts -> 3 ids | no |
| `5fa5740` cpreflight test glob | node 26 | repin.test | ok | no |
| `c77bc0f`, `e64d2f1` docs | sync | docrefs, status | one stale statement corrected here (21.2: "missing evidence -> pass not possible" was wrong until `8e7ec62`) | no |
| `974fff7` status.mjs | derived status | status.test | ok | no |
| `ac4a90b` quant switch | stage 3 --quant | repin.test | ok; stage 3 without --quant now also checks the quant is unchanged | no |

### 21.2 Timeout/PASS integrity (deep audit)
`evals/test/timeout-integrity.test.mjs` replays run.ts's per-task decision (wrapper status -> environment ->
termination evidence -> grading -> timeout -> class) with the real exported functions: 24 named fixtures (timeout +
grader PASS, timeout flag with exit 0, exit=timeout with timedOut=False, killed tree not proven dead, wrapper crash,
outer spawn timeout, result lost, setup failed, termination line missing at short and long elapsed time, agent text
imitating the wrapper line, forged line before/after the real one, contaminated/restore-failed env, unknown env
string, crash exit in time) and an exhaustive sweep of 1,296 combinations. PASS is possible only for: wrapper exit 0,
no spawn error, environment CLEAN, a valid termination line showing an in-time end, grader PASS. A test pins the
order of these calls in run.ts. Recorded design kept: an agent that exits non-zero in time with a correct tree is
PASS (graded on files; `agentExit` is in results.json). Historical results: read only; `countsAsPass()` makes every
reader treat the 22 legacy `pass: true, timedOut: true` entries as TIMEOUT.

### 21.3 A3 stress (candidate evidence only)
`a3stress.mjs`, 16 scenarios x real A2 and A3 (archive `a3-candidate-offline-2026-10-04/`): A3STRESS PASS. No call id
answered twice, no edit applied twice, discarded partial never re-sent, A2 == A3 wherever the string form is not
involved. Without the containment wrapper both builds edit an absolute path outside the sandbox through the native
array form; A3's string form reaches exactly the same, nothing more (A2 rejects the string form). Containment of real
runs is gates.sh's job at the re-pin.

### 21.4 Ollama server settings: what affects evaluation
| Setting | Class | Effect / evidence |
|---|---|---|
| Ollama version, model digest (weights, quant, template, num_ctx 32768, temperature 0.15, top_k 20, top_p 0.8, repeat_penalty 1.05, num_gpu 0) | PINNED | baseline-env.json; run.ts refuses a mismatch |
| OLLAMA_KV_CACHE_TYPE q8_0, OLLAMA_FLASH_ATTENTION true | RECORDED ONLY | change numerics (quantized cache) and memory; can change model output |
| OLLAMA_NUM_PARALLEL 1 | RECORDED ONLY | slots per model (memory per slot, concurrency); the harness sends one request at a time |
| OLLAMA_CONTEXT_LENGTH 32768 | RECORDED ONLY | server default; the model's own num_ctx 32768 (in the digest) is what applies to hermes-local-32k |
| OLLAMA_SCHED_SPREAD, OLLAMA_GPU_OVERHEAD, OLLAMA_LLM_LIBRARY, OLLAMA_VULKAN, OLLAMA_IGPU_ENABLE, CUDA/HIP/ROCR/GGML_VK visible devices, GPU_DEVICE_ORDINAL, HSA_OVERRIDE_GFX_VERSION | HARDWARE-DEPENDENT | decide which device/library runs the model; expected to change with the hardware |
| OLLAMA_KEEP_ALIVE 30m, OLLAMA_MAX_LOADED_MODELS 0, OLLAMA_LOAD_TIMEOUT 5m | OPERATIONAL | cold loads (first-token latency), load failures; not model semantics |
| auto-update, server start time | OPERATIONAL | cpreflight requires auto-update OFF; suite.sh exit 11 on a restart |
RECORDED ONLY becomes binding for C without a pin change: re-pin stage 1 records the settings and cpreflight refuses C
if the live settings differ. Pinning them in baseline-env.json remains a decision (HANDOFF "Open decisions").
Restart with auto-update ON: the app installs the staged 0.35.1 at the restart (or at its hourly check), so
`/api/version` becomes 0.35.1, run.ts refuses every run (suite exit 8), re-pin stage 2 and cpreflight fail; a restart
during a suite also makes that run not evidence (exit 11). A restart also re-reads the user's environment, so any
changed OLLAMA_* variable silently changes the RECORDED ONLY values (cpreflight catches it before C).

### 21.5 Cleanup safety (nothing deleted)
| Item | Facts | Safe to delete? | Value |
|---|---|---|---|
| `%TEMP%\agent-evals` | 131 roots (2026-09-28 .. 2026-10-04; 13 of them from this audit's real-process tests, which are not evidence); 35.7 GiB measured at 121 roots; 41 are named in archived logs (all authoritative runs among them); `analyze.mjs` reads `<task>.agent-home` broker/agent logs from them by default and defaults `--base` to `2026-09-28-16-05_...`, which is not archived; the archive keeps analysis outputs, not every raw agent-home log | **no** for archive-named roots and the analyze.mjs base (re-analysis needs them); dev/test-only roots could go, but the split needs a reviewed list first | low: C: has 199.8 GiB free |
| staged Ollama 0.35.1 installer (`%LOCALAPPDATA%\Ollama\updates_v2`, 1.47 GiB) | not referenced by any evidence | yes, but deleting it does not disable auto-update (the app downloads it again while auto-update is ON) | low; the real protection is turning auto-update off |
Recommendation: keep both until C is complete and archived; then prune dev/test sandbox roots from a reviewed list.

### 21.6 Static security review (files changed since `bfad054`)
Fixed (`eb4cb4f`): run-id race (atomic claim), METER_LISTEN/METER_UPSTREAM interpolated into PowerShell
unvalidated (now 127.x.x.x:port only), test scripts' unconditional `rm -rf <arg>` (marker-guarded scratch dirs).
Reviewed without change: constant-string `shell: true` calls in run.ts; argument-array spawns in repin/cpreflight;
rmSync only on own mkdtemp dirs; suite/probe `rm -rf` limited to `<out>/ev-<validated label>`; repin --out paths are
written only inside `<R>`. Recorded limitation: the eval/external tree split trusts the `--provider-profile evalbroker`
argument (an imitating manual run would be attributed as the eval agent in control mode; contained egress is a
VIOLATION regardless).

### 21.7 Failure propagation (task -> jcode -> run.ts -> run-in-job.ps1 -> suite.sh -> grading -> reporting)
| Failure | Where it lands | Suite exit | Verified by |
|---|---|---|---|
| refused run (pin gate) | run.ts exit 2 | 8 | suite-lifecycle `refused` |
| timeout | wrapper `exit=timeout timedOut=True` -> TIMEOUT, never PASS | 0 (a result) | timeout-integrity fixtures |
| model failure (wrong / no answer) | task FAIL | 0 (a result) | suite-midrun `model-fail` (real suite) |
| jcode crash | wrapper note `agent exit=<code>`; graded on files (design) | 0 | fixtures |
| wrapper/tree failure, result lost, setup failed | UNSAFE_PROCESS_TREE / AGENT_STATUS_UNKNOWN (fail) / SETUP_FAILED (excluded, listed "NOT RUN") | 0 | fixtures; PLAN status_contract |
| meter death | agent retries fail, task FAIL; run not evidence | 6 | suite-midrun `meter-dies`: exit 6 two minutes after the kill |
| broker failure | wrapper setup failure -> SETUP_FAILED | 0 | fixtures |
| security failure (TRIP VIOLATION / UNATTRIBUTED) | tripclass flags it | 0, but `ev-<label>/TRIP-NEEDS-REVIEW` + last line `SUITE-DONE (TRIP NEEDS REVIEW ...)` (`9c9bf85`) | suite-midrun `trip-review` |
| Ollama restart | start time differs | 11 | suite-lifecycle |
| repo or ~/.jcode changed | fingerprint differs | 10 | observed live: edits made during a test run gave exit 10 |
| interruption | trap | 130 | suite-lifecycle; TERM measured (section 7) |
| cleanup failure (env restore) | ENV_RESTORE_FAILED (fail) | 0 | fixtures |
Cleanup never replaces the exit code: suite.sh chooses it after every check with fixed precedence 6, 11, 7, 8, 10;
the interrupt trap exits 130 itself. Two outcomes stay exit 0 by the existing contract and are decisions, not bugs:
SETUP_FAILED tasks are excluded from the score (C's pre-registration should say whether they are re-run), and a TRIP
needing review does not change the exit code (policy: "not clean evidence until explained").

### 21.8 Process lifecycle (real processes, no inference)
`evals/test/suite-midrun.sh` runs the real contained suite (A2 jcode, wrapper, broker, meter, watchdog, keep-awake)
against `fakeupstream.mjs`; `suite-lifecycle.sh` (now 6 cases incl. malformed meter addresses) and `watch-smoke.sh`
cover refusal, busy port, Ollama restart, Ctrl+C, labels. Every case ends with no surviving meter/watch/keepawake/
wrapper/run.ts/jcode process. Run ids: 3 concurrent same-minute starts got 3 ids. Found while doing this: `taskkill
//F` (usual git-bash escape) does not work in Hermes' shell and plain `/F` does not work in git-bash; lint now flags
it (`f933a4e`).

### 21.9 Real-process test attempts, including the failed ones (kept as audit history)
All runs 2026-10-04 against `fakeupstream.mjs` (no inference); none is evidence, none changed a recorded result.
| Attempt | Result | Cause | Correction |
|---|---|---|---|
| suite-midrun, first two starts | SKIP (exit 2) | the leftover-process probe counted its own PowerShell query (and bash wrappers) as a harness process | probe excludes itself and bash.exe (in `2cd9a04`) |
| suite-midrun model-fail + meter-dies | FAIL (4 checks) | (a) model-fail: exit 10 because the repo was edited while it ran: the harness correctly declared the run not evidence; (b) meter-dies: `taskkill //F` silently did nothing in this shell, so the meter was never killed; the run "waited until the task timeout" because the upstream hung, not because of a meter death. The earlier note "the agent waits until the task timeout when the meter dies" was wrong and is withdrawn | (a) header: do not edit the repo during a run; (b) Stop-Process + meter-killed check, lint rule (`f933a4e`) |
| suite-midrun meter-dies (after `f933a4e`) | PASS | meter killed 20:10:34 -> agent retries fail -> T01 FAIL -> suite exit 6 "METER DIED" 120 s after the kill | - |
| TERM to suite.sh's bash only (manual probe) | exit 130 after 910 s, INTERRUPTED, no survivor | bash runs traps only after the foreground run.ts returns (T01 timeout 15 min); Ctrl+C signals the whole group | recorded (section 7 table), not changed |
| batch: lifecycle 6/6, watch-smoke, model-fail, trip-review | PASS | - | - |
| closeout review of `f933a4e` and siblings (`59ccb11`) | 5 weak assertions found | meter chosen by command line (could be another process); "no PASS" vacuous when results.json missing; no proof the fault was injected mid-run; trip-review accepted any UNATTRIBUTED line; 127.0.0.3 negative check without a positive control; label/address refusals accepted any exit 2 | meter = the single node.exe listening on the meter port; agent-reached-model, probe-sees-run, results-written, stray-client-is-the-TRIP, 127.0.0.3-present and refusal-message checks added |
| final battery on `59ccb11` (tree clean before and after) | all PASS | lifecycle 6/6 (labels, meter-addr, refused, busy, restart, interrupt); watch-smoke 11/11; midrun model-fail 5/5, meter-dies 9/9 (exit 6, 125 s after the kill), trip-review 5/5 | - |
After the final battery: no meter, watch, keepawake, wrapper, run.ts, broker, jcode or stand-in process; meter port and
stand-in port free; results dirs created by the tests moved to the scratch dir (with the 5 run.ts race-test dirs from
the security review); rows the tests appended to the untracked `evals/results/history.csv` were left. Nothing deleted.

### 22 CPU target reinstated and A3 re-pinned on it (2026-10-04, code + docs; no evidence rewritten)
The user decided the current CPU-only machine IS the evaluation environment (no dedicated GPU planned). The GPU
prerequisites had been duplicated in three places: the re-pin stages, the preflight, and the docs. All three now ask
the DECLARED target (PLAN `H_hardware.target_environment.placement`) instead of assuming one:
| Change | Where | Why |
|---|---|---|
| `targetOf` / `placementOk` / `requiredModelDigest` / `hardwareCheck` | new `evals/bench/target.mjs` | one definition of the target, shared; unknown/missing target never passes |
| stage 1 `target-hardware (CPU)`: same CPU + RAM as the CPU baseline profile | `repin.mjs` | the old check demanded a discrete GPU, which was never a requirement of C |
| stage 3 CPU branch: model UNCHANGED (validated digest, `num_gpu 0`, Q4_K_M, `size_vram 0`) | `repin.mjs` | the rebuild only ever existed to put the model on a GPU |
| record stores its target; later stages refuse a different one | `repin.mjs` | a CPU record can never be continued as a GPU attempt |
| GPU visibility, VRAM minimum, 100%-GPU placement and "not the CPU model" blockers REMOVED | `cpreflight.mjs` | GPU-only, from the abandoned plan |
| `live-placement-target` (CPU: `size_vram == 0`), `pin-model-fits-target` (CPU: the validated digest) | `cpreflight.mjs` | placement and the model pin are still checked - against the real target |
| `plan-target-declared`, `repin-target-matches`, `repin-target-hardware` | `cpreflight.mjs` | a missing/unknown target fails closed instead of defaulting |
| H_hardware DECIDED + `target_environment`; quant decision; C preregistration PROPOSED | `PLAN.yaml` | the target, quant and preregistration live in the single source of truth |
| RUNBOOK-POST-HARDWARE.md and perf/HARDWARE-REPORT.md marked OPTIONAL, NOT PLANNED | docs | no fake future baseline; nothing to fill in |
Kept unchanged: jcode/model/Ollama pin checks, containment, security, reproducibility, power/sleep, clean evidence,
task baseline, fingerprints, timeout and contamination rules. Offline suite 163/163 (target logic, hardware check,
target-mismatch and target-placement blockers added); lint PASS.
Re-pin on this machine (steps 1-12, archive `cycle10-cpu-repin`): all PASS - 100% CPU placement confirmed by
`/api/ps` (`size_vram 0 of 20,514,361,834`), A3 identity + editstring + a3offline 18/18 + `~/.jcode` unchanged, pin
commit `8295bb7`, `gates.sh` PASS, T01 x4 reproducible `90862fc1...` and DIFFERENT from the A2 `df1332d7...`,
quant Q4_K_M. No quant trial was run (not feasible here - a feasibility fact, not a measurement; PLAN
`quant_decision.numbers`); A0-A2 values stay as they were.

### 23 C executed as pre-registered (2026-10-04 18:26 -> 2026-10-05 09:50; no code changed during the run)
Gate before: cpreflight `--warm` READY FOR C at `3d710ab` (clean). Run: 6 suites (C1..C3 x contained/control), all
reduced.sh exit 0; no meter death, no sleep (power.txt each run), AC throughout, Ollama never restarted, repo and
`~/.jcode` fingerprints UNCHANGED after every run, `--ref` config mismatches 0. Outcomes 48: PASS 28, FAIL 5, TIMEOUT 15
(6 with grader PASS, classified TIMEOUT per outcome.ts), SETUP_FAILED/BLOCKED/CONTAMINATED/INCONCLUSIVE/NOT RUN 0.
Decision rule (PLAN `C_rebaseline.preregistration`): 4 HOLD, criterion 4 FAILS (contained-vs-control 8.3% > contained-vs-
contained 0.0%), computed by the definition registered before the run (`cycle10-C/c-analysis-raw.txt`). Not reinterpreted.
| Finding | Class | Evidence |
|---|---|---|
| T13 x4, T08 x1, T05 x1 correct but past the limit | CPU throughput | grader PASS at TIMEOUT, run-*.log |
| T14 0/6 (rootDir/TS2307 never fixed; POSIX `ls`/`rm` in cmd.exe) | model | classify-*.txt, results T14 detail |
| T08 grader FAILs (hidden registered/file/dir/escape), no test run (bash=0) | model | classify-*.txt |
| T13 C3 x2 finished in time, hidden runTask tests fail | model | run-C3-*.log |
| T17 C1-control CSV mismatch | model (variance) | run-C1-control.log |
| C1-control 1 UNATTRIBUTED TRIP: pid 36180 `name=?`, same pid = pinned jcode.exe (T04, control) 10 s later | harness observability; not a violation | ev-C1-control/TRIP-REVIEW.md |
| contained-only "Access is denied" (`dir /s`, `cd /d` absolute) in T03 (PASS) and T14 (fails in control too) | containment working as designed; no contained-only failure | classify-C2/C3-contain |
| run order T01..T17 (suite order), not the preregistration's written order | doc correction; same in all 6 runs | run-*.log |
Proposal (not done; changing classification tooling after the run would touch evidence handling): tripclass could attribute
a `name=?` line whose pid resolves to an expected process in the next sample.
