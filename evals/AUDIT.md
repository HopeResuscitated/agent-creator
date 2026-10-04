# Harness audit (2026-10-04, post hardware-ready checkpoint)

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
| Analysis | `bench/analyze.mjs`, `classify.mjs`, `reanalyze.mjs`, `coverage.mjs`, `perfreport.mjs` |
| Re-pin / C | `bench/gates.sh`, `t01x4.ps1`, `editstring.mjs`, `a3offline.mjs` + `fakeprov.mjs`, `quanttrial.mjs`, `hwprofile.ps1`, `perfsample.ps1`, `repin.mjs`, `cpreflight.mjs`, `status.mjs` |
| Offline tests | `test/*.test.mjs` (69 tests, seconds), `test/lint.sh`, `test/docrefs.mjs`; real-process: `test/suite-lifecycle.sh`, `test/watch-smoke.sh` |
| Records | `PLAN.yaml`, `HANDOFF.md`, `REPIN.md`, `INVALIDATIONS.md`, `README.md`, `RESUME.md`, `perf/` (CPU baseline), `baseline-env.json` (pins) |

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
- timeout source: the wrapper's `agent exit=... timedOut=...` line, not elapsed time (elapsed is the fallback when
  the line is missing). Of 202 historical results with a wrapper line, 1 disagrees with the recorded flag: cycle-8 T03
  contained, 901 s on a 900 s limit, recorded timedOut, wrapper "agent exit=0 timedOut=False". The record is kept and
  documented as TIMEOUT; it is pre-A2 historical evidence.
- missing evidence -> pass: not possible; a missing wrapper note uses the conservative elapsed fallback; an unknown env
  string classifies as UNSAFE_PROCESS_TREE.
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
| Ctrl+C / terminal closed (TERM/HUP) | suite exits 130, stops meter/watch/keepawake, writes INTERRUPTED; run.ts's Job Object kills the agent tree with the wrapper | rerun the suite; no partial results.json (written at the end) |
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
| `%TEMP%\agent-evals` | 114 sandbox roots (2026-09-28 on) | may be pruned after C if the archive is complete; not now |
| `%TEMP%\editstring-*` etc. | small test leftovers | safe to delete any time |
| evidence archive | `C:\Users\cierra\hermes-bench-archive` 1.4 GB | keep |
| Ollama 0.35.1 installer staged | `%LOCALAPPDATA%\Ollama\updates_v2\...` | leave until you decide on auto-update; deleting does not stop a future download |
