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
                                                                   then analysis-<label>.txt / classify-<label>.txt;
                                                                   meter output in ev-<label>/meter.out; exit 6 if the
                                                                   meter died during the run (the run is not evidence);
                                                                   exit 7 if the machine slept during the run
                                                                   (keepawake.ps1 holds off idle sleep; sleepcheck.ps1
                                                                   reads the System log; ev-<label>/power.txt also
                                                                   warns on battery / power-source changes)
  reduced.sh --out <dir> [--tasks ..] [--ref f] [--expect-head sha] <label>:<mode> ...
                                                                   gated sequence of suite.sh runs; with --ref, stops
                                                                   when a task's effective-config fingerprint differs,
                                                                   and when a run's meter died (exit 6) or the machine slept (exit 7)
  t05x6.sh --out <dir> [...]                                       T05 x 3 contained + 3 control, interleaved
  JCODE_BIN=<pinned jcode.exe> selects the agent binary for all of the above; run.ts refuses unless its
  sha256 equals jcode_sha256 in evals/baseline-env.json (current pin: C:\Users\cierra\jcode-evalpin-a2-bin\jcode.exe).

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

Gates and re-pin (see evals/REPIN.md for the full sequence)
  JCODE_BIN=<pinned> gates.sh --out <dir> [--refuse <jcode.exe>]... [--bare-node <node.exe>]
                                  every pre-run gate, machine-checked: pins match, non-pinned node / jcode and an
                                  unreachable model server refused (exit 2), contained-child 10/10, secprobe 20/20,
                                  relay bytes + after-Stop + port range, contained e2e 9/9 + busy port, meter
                                  kill-abort. One PASS/FAIL line each, `GATES PASS` + exit 0 only if all pass.
                                  Exit 9 (does not start) while any jcode.exe runs or a client is connected to Ollama.
  meterabort.mjs [port] [model]   real-Ollama check that meter.mjs aborts its upstream request when the client goes
                                  away (METER_JS=<file> to test another meter build). METERABORT PASS/FAIL, exit 0/1.
  t01x4.ps1 -JcodeBin <bin> -Out <dir> [-Previous <fp>]   T01 from PowerShell and git-bash, contained and control:
                                  the 4 run fingerprints must be identical (T01X4 PASS). -Previous only reports
                                  EQUAL/DIFFERENT against an older baseline; it is never the new baseline.
  quanttrial.mjs --model <m> --requests <dir>... --out <f.jsonl> [--reps 2] [--limit N]
                                  replays captured agent requests (meter raw/*.req.json, de-duplicated) against one
                                  Ollama model; classes complete / eof_no_finish / http_500_parse / tool_xml_in_text /
                                  bad_tool_args; malformed rate + Wilson 95%, median first token, decode tok/s.
  editstring.mjs <jcode.exe> <label> --expect fixed|unfixed   A3 check with a fake model server: `edits` as array /
                                  strict-JSON string / raw-newline string / garbage. EDITSTRING PASS/FAIL.
  attrmon.ps1 -Log <f> -StopFile <f> [-Interval 20] [-Once]   attribution monitor for exclusive windows: every
                                  jcode.exe and Ollama client classified; EXTERNAL-ACTIVITY lines = contaminated run.

Rebuilt from cycle-6/7 notes (originals pruned with scratch): watch.ps1, fp.mjs, fpcmp.mjs, evfp.mjs, analyze.mjs,
classify.mjs. analyze/classify reproduce the archived cycle-6 C1, C2-R output byte-for-byte; for D1-R/D2-R
(control runs whose watch.log has >25 TRIP lines) analyze additionally prints the TRIP total and the watch-stop line.
