#!/usr/bin/env bash
# suite-midrun.sh - real suite.sh lifecycle with a REAL contained T01 run (pinned A2 jcode, wrapper, broker, meter,
# watchdog, keep-awake) against a stand-in upstream (evals/test/fakeupstream.mjs), so no model inference is spent.
#   bash evals/test/suite-midrun.sh <scratch dir> [model-fail|meter-dies|trip-review|all]   (default model-fail)
# Needs the A2 binary; Ollama is not used. Do not edit the repository while it runs: suite.sh fingerprints the repo
# before and after, and a change makes the run "not evidence" (exit 10), which this test then reports as a failure.
# Cases:
#   model-fail  (~2 min) upstream answers with text only -> the task FAILs; suite exit 0 (a FAIL is a result, not a
#               harness failure); results.json outcome FAIL, pass=false; no harness process survives
#   meter-dies  upstream hangs; the meter is killed while the agent waits -> the suite must exit 6 "METER DIED DURING
#               THE RUN" (not evidence), with no PASS and no surviving harness process. The time from the kill to the
#               suite's end is printed (outer limit 1500 s). Measured 2026-10-04: exit 6 about 2 min after the kill.
#   trip-review (~2 min, control mode) a stray client holds a connection to the model port during the run -> watch
#               TRIP, tripclass UNATTRIBUTED; suite exit stays 0 (policy unchanged) but ev-<label>/TRIP-NEEDS-REVIEW
#               exists and the last line reads "SUITE-DONE (TRIP NEEDS REVIEW: ...)".
# Results dirs the cases create under evals/results are moved into the scratch dir (they are not evidence).
set -u
cd "$(dirname "$0")/../.."
N=${NODE_BIN:-C:/Users/cierra/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node.exe}
A2=${JCODE_BIN:-C:/Users/cierra/jcode-evalpin-a2-bin/jcode.exe}
S=${1:?scratch dir}; CASES=${2:-model-fail}
case "$CASES" in model-fail|meter-dies|trip-review|all) ;; *) echo "case must be model-fail, meter-dies, trip-review or all" >&2; exit 2 ;; esac
source "$(dirname "$0")/scratch.sh"; scratch_dir "$S" || exit 2
PORT=11551
F=0; chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; F=$((F+1)); fi; }
# real harness processes only: node/powershell/jcode (not bash wrappers, not this query itself)
survivors() { powershell.exe -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { \$_.ProcessId -ne \$PID -and \$_.Name -ne 'bash.exe' -and \"\$(\$_.CommandLine)\" -match 'bench[\\\\/](meter\\.mjs|watch\\.ps1|keepawake\\.ps1)|run-in-job\\.ps1|evals[\\\\/]run\\.ts|jcode-evalpin-a2-bi[n]' }).Count" | tr -d '\r'; }
newest_results() { ls -1d evals/results/*_ollama-hermes-local-32k* 2>/dev/null | sort | tail -1; }
[ "$(survivors)" = 0 ] || { echo "SUITE-MIDRUN SKIP: harness processes already running"; exit 2; }
FP=; trap '[ -n "$FP" ] && kill $FP 2>/dev/null' EXIT

if [ "$CASES" = model-fail ] || [ "$CASES" = all ]; then
  before=$(newest_results)
  "$N" evals/test/fakeupstream.mjs $PORT done > "$S/fake-done.out" 2>&1 & FP=$!
  sleep 1
  JCODE_BIN=$A2 METER_UPSTREAM=127.0.0.1:$PORT timeout 600 bash evals/bench/suite.sh --out "$S/o1" mf contain --only T01 > "$S/model-fail.log" 2>&1; RC=$?
  kill $FP 2>/dev/null; wait $FP 2>/dev/null; FP=
  R1=$(newest_results)
  chk model-fail-suite-exit-0 "[ $RC = 0 ]"
  chk model-fail-new-results "[ -n '$R1' ] && [ '$R1' != '$before' ]"
  chk model-fail-outcome-FAIL "grep -q '\"outcome\": \"FAIL\"' '$R1/results.json' && grep -q '\"pass\": false' '$R1/results.json'"
  chk model-fail-agent-reached-fake "grep -q 'chat/completions' '$S/fake-done.out'"
  sleep 2; chk model-fail-no-survivors "[ \"\$(survivors)\" = 0 ]"
  [ -n "$R1" ] && [ "$R1" != "$before" ] && mv "$R1" "$S/"
fi

if [ "$CASES" = meter-dies ] || [ "$CASES" = all ]; then
  before=$(newest_results)
  "$N" evals/test/fakeupstream.mjs $PORT hang > "$S/fake-hang.out" 2>&1 & FP=$!
  sleep 1
  JCODE_BIN=$A2 METER_UPSTREAM=127.0.0.1:$PORT timeout 1500 bash evals/bench/suite.sh --out "$S/o2" md contain --only T01 > "$S/meter-dies.log" 2>&1 & SP=$!
  for i in $(seq 1 180); do grep -q 'chat/completions' "$S/fake-hang.out" 2>/dev/null && break; sleep 1; done
  MP=$(powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { \"\$(\$_.CommandLine)\" -match 'bench[\\\\/]meter\\.mjs' } | Select-Object -First 1).ProcessId" | tr -d '\r')
  t0=$(date +%s)
  [ -n "$MP" ] && powershell.exe -NoProfile -Command "Stop-Process -Id $MP -Force" > /dev/null 2>&1   # not taskkill: git-bash mangles /F
  sleep 2; MGONE=$(powershell.exe -NoProfile -Command "@(Get-Process -Id ${MP:-0} -ErrorAction SilentlyContinue).Count" | tr -d '\r')
  wait $SP; RC=$?; dt=$(( $(date +%s) - t0 ))
  kill $FP 2>/dev/null; wait $FP 2>/dev/null; FP=
  R2=$(newest_results)
  chk meter-dies-meter-found "[ -n '$MP' ]"
  chk meter-dies-meter-killed "[ '$MGONE' = 0 ]"
  chk meter-dies-suite-exit-6 "[ $RC = 6 ]"
  chk meter-dies-not-evidence-line "grep -q 'METER DIED DURING THE RUN' '$S/meter-dies.log'"
  chk meter-dies-no-pass "! grep -q '\"pass\": true' '$R2/results.json' 2>/dev/null"
  sleep 2; chk meter-dies-no-survivors "[ \"\$(survivors)\" = 0 ]"
  [ -n "$R2" ] && [ "$R2" != "$before" ] && mv "$R2" "$S/"
  echo "meter-dies: suite ended ${dt}s after the meter was killed"
fi
if [ "$CASES" = trip-review ] || [ "$CASES" = all ]; then
  # a stray client holds a connection to the model port during the run -> watch TRIP, tripclass UNATTRIBUTED ->
  # suite exit unchanged (0) but the TRIP-NEEDS-REVIEW marker exists and the last line says so
  before=$(newest_results)
  "$N" evals/test/fakeupstream.mjs $PORT done > "$S/fake-trip.out" 2>&1 & FP=$!
  sleep 1
  "$N" -e "const s=require('net').connect($PORT,'127.0.0.1');s.on('error',()=>{});setTimeout(()=>process.exit(0),240000)" & ST=$!
  JCODE_BIN=$A2 METER_UPSTREAM=127.0.0.1:$PORT timeout 600 bash evals/bench/suite.sh --out "$S/o3" tr control --only T01 > "$S/trip-review.log" 2>&1; RC=$?
  kill $ST $FP 2>/dev/null; wait $ST $FP 2>/dev/null; FP=
  R3=$(newest_results)
  chk trip-review-suite-exit-0 "[ $RC = 0 ]"
  chk trip-review-marker "[ -f '$S/o3/ev-tr/TRIP-NEEDS-REVIEW' ]"
  chk trip-review-last-line "tail -1 '$S/trip-review.log' | grep -q 'SUITE-DONE (TRIP NEEDS REVIEW'"
  chk trip-review-unattributed "grep -q 'UNATTRIBUTED' '$S/o3/ev-tr/tripclass.txt'"
  sleep 2; chk trip-review-no-survivors "[ \"\$(survivors)\" = 0 ]"
  [ -n "$R3" ] && [ "$R3" != "$before" ] && mv "$R3" "$S/"
fi
[ $F = 0 ] && echo "SUITE-MIDRUN PASS ($CASES)" || echo "SUITE-MIDRUN FAIL ($F, $CASES)"
exit $([ $F = 0 ] && echo 0 || echo 1)
