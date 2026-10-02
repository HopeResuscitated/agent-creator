# evals/bench — benchmark and containment-evidence tooling

Everything here resolves paths relative to the repo (`evals/bench/../..`) or to an explicit `--out` / `-Out`
directory. Nothing writes into the repo except `evals/run.ts` itself (evals/results/, as always).

Runner node: every script runs node by ABSOLUTE path (node.sh / node.ps1; override with NODE_BIN), never `node`
from PATH, and refuses a binary whose version or sha256 differs from evals/baseline-env.json. run.ts enforces the
same pin for contained and control jcode runs and --stage-tools-only (it copies its own node into the agent's
tools root); --allow-node-drift is a recorded debugging override only. Run the regression tests with the same
binary, e.g. "$NODE_BIN" evals/tools/contained-child-test.mjs.

Benchmark runs
  suite.sh --out <dir> <label> <contain|control> [run.ts args]   one run + meter + watchdog + fingerprints,
                                                                   then analysis-<label>.txt / classify-<label>.txt
  reduced.sh --out <dir> [--tasks ..] [--ref f] [--expect-head sha] <label>:<mode> ...
                                                                   gated sequence of suite.sh runs; with --ref, stops
                                                                   when a task's effective-config fingerprint differs
  t05x6.sh --out <dir> [...]                                       T05 x 3 contained + 3 control, interleaved
  JCODE_BIN=<pinned jcode.exe> pins the agent binary for all of the above.

Evidence and analysis
  meter.mjs        trusted-side HTTP meter between broker/agent and Ollama (METER_LOG, METER_RAW, METER_LISTEN, METER_UPSTREAM)
  watch.ps1        watchdog: TRIP on Ollama/meter connections from the wrong process, agent non-loopback
                   connections, writes to the outside canary dir
  fp.mjs / fpcmp.mjs   repo fingerprint and comparison (runner-owned evals/results ignored)
  evfp.mjs         ~/.jcode fingerprint
  analyze.mjs      tasks vs baseline, failures, model meter stats, per-task containment, watchdog
  classify.mjs     per-task bash-call classification from transcripts
  reanalyze.mjs    incomplete-stream analysis cross-checked against Ollama's server.log

Probes and byte tests
  secprobe.ps1 -Out <dir>         Part 1 containment probe through the real wrapper (20 checks)
  killprobe.mjs                   taskkill /T /F inside the measured environment
  probe.sh --out <dir>            meter + watchdog + streamprobe.ps1 (malformed/well-formed stream cases, both modes)
  relaytest/harness.ps1 -Repo <repo> [-Out d]  broker/relay byte test (12 cases + port range)
  node relaytest/contained-e2e.mjs [repo]     contained end-to-end byte test (9 cases + busy-port setup failure)

Rebuilt from cycle-6/7 notes (originals pruned with scratch): watch.ps1, fp.mjs, fpcmp.mjs, evfp.mjs, analyze.mjs,
classify.mjs. analyze/classify reproduce the archived cycle-6 C1, C2-R output byte-for-byte; for D1-R/D2-R
(control runs whose watch.log has >25 TRIP lines) analyze additionally prints the TRIP total and the watch-stop line.
