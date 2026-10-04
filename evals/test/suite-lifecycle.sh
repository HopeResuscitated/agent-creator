#!/usr/bin/env bash
# suite-lifecycle.sh - failure-path tests for evals/bench/suite.sh. No task runs; Ollama is touched only by the
# suite's own 1-token warm-up. Needs: Ollama up, nothing else on the meter port, JCODE_BIN unset or any path.
#   bash evals/test/suite-lifecycle.sh <scratch dir> <refused jcode.exe>
# Cases:
#   refused   a non-pinned jcode -> run.ts exits 2 -> suite.sh exit 8, meter/watch/keepawake stopped
#   busy      something already listens on the meter port -> suite.sh exit 1 before starting anything
#   interrupt TERM during startup -> suite.sh exit 130, INTERRUPTED marker, meter/watch/keepawake stopped
#   also: labels (5 unsafe labels refused with the label message), meter-addr (8 malformed addresses refused with the
#   address message), restart (simulated Ollama restart -> exit 11)
# Prints one PASS/FAIL line per case and "SUITE-LIFECYCLE PASS|FAIL"; exit 0 only if all pass.
set -u
S=${1:?scratch dir}; REFUSED=${2:?refused jcode.exe}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); SUITE=$HERE/../bench/suite.sh
source "$HERE/../bench/node.sh" || exit 3
source "$HERE/scratch.sh"; scratch_dir "$S" || exit 2; FAILS=0
ok() { echo "PASS $1 | $2"; }
bad() { echo "FAIL $1 | $2"; FAILS=$((FAILS + 1)); }
# processes this suite starts and must not leave behind: meter.mjs (node), watch.ps1 / keepawake.ps1 (powershell)
# No other suite may run concurrently (checked below), so every live bench meter/watch/keepawake process is ours.
leftovers() { powershell.exe -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { \"\$(\$_.CommandLine)\" -match 'bench[\\\\/](meter\\.mjs|watch\\.ps1|keepawake\\.ps1)' }).Count" | tr -d '\r'; }
listening() { powershell.exe -NoProfile -Command "@(Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort 11439 -State Listen -ErrorAction SilentlyContinue).Count" | tr -d '\r'; }

[ "$(listening)" = 0 ] || { echo "meter port 127.0.0.2:11439 busy before the test; not starting"; exit 9; }

# 0. unsafe labels are refused before anything is deleted (ev-<label> is rm -rf'd)
mkdir -p "$S/keep"; touch "$S/keep/precious"; LF=0
for l in "../keep" "a/../../keep" "" ".." "-x"; do bash "$SUITE" --out "$S/o" "$l" contain --only T01 > "$S/label.err" 2>&1; [ $? = 2 ] && grep -q "label must match" "$S/label.err" || LF=1; done
if [ $LF = 0 ] && [ -e "$S/keep/precious" ]; then ok labels "5 unsafe labels -> exit 2, sibling dir intact"; else bad labels "an unsafe label was not refused"; fi
# 0b. meter addresses are interpolated into PowerShell: anything but 127.x.x.x:<port> is refused before any process starts
MF=0; for v in "127.0.0.2:11439; Remove-Item x" "0.0.0.0:11439" "127.0.0.2" ":1"; do METER_LISTEN=$v bash "$SUITE" --out "$S/o" M contain --only T01 > "$S/maddr.err" 2>&1; [ $? = 2 ] && grep -q "must be 127.x.x.x" "$S/maddr.err" || MF=1; METER_UPSTREAM=$v bash "$SUITE" --out "$S/o" M contain --only T01 > "$S/maddr.err" 2>&1; [ $? = 2 ] && grep -q "must be 127.x.x.x" "$S/maddr.err" || MF=1; done
if [ $MF = 0 ] && [ ! -e "$S/o/ev-M" ]; then ok meter-addr "8 malformed METER_LISTEN/METER_UPSTREAM values -> exit 2, nothing created"; else bad meter-addr "a malformed meter address was not refused"; fi

# 1. refused run
JCODE_BIN=$REFUSED bash "$SUITE" --out "$S/refused" R contain --only T01 > "$S/refused.log" 2>&1; rc=$?
sleep 2; L=$(leftovers | tr -d ' ')
if [ $rc = 8 ] && grep -q "REFUSING TO RUN" "$S/refused.log" && grep -q "run.ts exit=2" "$S/refused.log" && [ "$L" = 0 ] && [ "$(listening)" = 0 ]; then
  ok refused "suite exit 8, run.ts exit 2, no leftover processes"; else bad refused "suite exit $rc, leftovers=$L (see $S/refused.log)"; fi

# 2. busy meter port
"$NODE_BIN" -e "require('net').createServer().listen(11439,'127.0.0.2',()=>console.log('listening'));setTimeout(()=>process.exit(0),20000)" > "$S/busy-listener.out" 2>&1 & BL=$!
sleep 2
JCODE_BIN=$REFUSED bash "$SUITE" --out "$S/busy" B contain --only T01 > "$S/busy.log" 2>&1; rc=$?
kill $BL 2>/dev/null; wait $BL 2>/dev/null; sleep 1
if [ $rc = 1 ] && grep -q "already in use" "$S/busy.log" && [ ! -e "$S/busy/ev-B/meter.out" ]; then
  ok busy "suite exit 1 before starting a meter"; else bad busy "suite exit $rc (see $S/busy.log)"; fi

# 2b. Ollama restart during the run (simulated: a copy of server.log gains a new "server config" line after suite.sh
#     has read the server start time); must be exit 11 and must win over the refused run's exit 8
REAL_LOG="$(cygpath -u "$LOCALAPPDATA")/Ollama/server.log"; FAKE_LOG="$S/server.log"
grep 'msg="server config"' "$REAL_LOG" | tail -1 > "$FAKE_LOG"
OLLAMA_SERVER_LOG="$(cygpath -m "$FAKE_LOG")" JCODE_BIN=$REFUSED bash "$SUITE" --out "$S/restart" X contain --only T01 > "$S/restart.log" 2>&1 & SP=$!
for i in $(seq 1 150); do grep -q "OLLAMAENV" "$S/restart/ev-X/ollama-server-env.txt" 2>/dev/null && break; sleep 0.2; done
sleep 1; sed 's/^time=[^ ]*/time=2099-01-01T00:00:00.000-05:00/' "$FAKE_LOG" | tail -1 >> "$FAKE_LOG"
wait $SP; rc=$?; sleep 2
if [ $rc = 11 ] && grep -q "OLLAMA SERVER RESTARTED" "$S/restart.log" && [ "$(listening)" = 0 ]; then
  ok restart "simulated Ollama restart -> suite exit 11 (not evidence)"; else bad restart "suite exit $rc (see $S/restart.log)"; fi

# 3. interrupt during startup
JCODE_BIN=$REFUSED bash "$SUITE" --out "$S/int" I contain --only T01 > "$S/int.log" 2>&1 & SP=$!
for i in $(seq 1 100); do [ -e "$S/int/ev-I/meter.out" ] && break; sleep 0.2; done
sleep 1; RUNNING=$(leftovers | tr -d ' ')
kill -TERM $SP; wait $SP; rc=$?
sleep 3; L=$(leftovers | tr -d ' ')
# RUNNING >= 2 proves the leftover probe actually sees this suite's processes (meter + keepawake at least)
if [ $rc = 130 ] && [ -e "$S/int/ev-I/INTERRUPTED" ] && grep -q "INTERRUPTED" "$S/int.log" && [ "$L" = 0 ] && [ "$(listening)" = 0 ] && [ "${RUNNING:-0}" -ge 2 ]; then
  ok interrupt "suite exit 130, marker written, $RUNNING bench processes before the signal, 0 after"; else bad interrupt "suite exit $rc, before=$RUNNING leftovers=$L (see $S/int.log)"; fi

[ $FAILS = 0 ] && { echo "SUITE-LIFECYCLE PASS"; exit 0; } || { echo "SUITE-LIFECYCLE FAIL ($FAILS)"; exit 1; }
