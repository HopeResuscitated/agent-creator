#!/usr/bin/env bash
# suite.sh — one benchmark run with full trusted-side evidence.
#
#   evals/bench/suite.sh --out <dir> <label> <contain|control> [extra run.ts args, e.g. --only T01,T05]
#
# Env: JCODE_BIN   pinned agent binary passed to run.ts --jcode-bin (unset: run.ts resolves `jcode` on PATH)
#      MODEL       default hermes-local-32k
#      METER_LISTEN / METER_UPSTREAM   default 127.0.0.2:11439 / 127.0.0.1:11434
# Both modes use the meter as the model upstream (contained: broker -> meter; control: agent -> meter directly)
# and the generated agent config (config-equivalent control), so containment is the only variable.
# Writes <out>/ev-<label>/ (meter.jsonl, raw/, watch.log, fp-*.txt, ev-*.txt, suite.out, ...),
# <out>/run-<label>.log is the caller's job; analysis-<label>.txt and classify-<label>.txt go to <out>.
set -u
source "$(dirname "${BASH_SOURCE[0]}")/node.sh" || exit 3
[ "${1:-}" = "--out" ] || { echo "usage: suite.sh --out <dir> <label> <contain|control> [run.ts args...]" >&2; exit 2; }
OUT=$2; LABEL=$3; MODE=$4; shift 4
case "$MODE" in contain|control) ;; *) echo "mode must be contain or control" >&2; exit 2 ;; esac
BENCH=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$BENCH/../.." && pwd)
WBENCH=$(cygpath -m "$BENCH"); WREPO=$(cygpath -m "$REPO")
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd); WOUT=$(cygpath -m "$OUT")
EV=$OUT/ev-$LABEL; WEV=$WOUT/ev-$LABEL
MODEL=${MODEL:-hermes-local-32k}
METER_LISTEN=${METER_LISTEN:-127.0.0.2:11439}; METER_UPSTREAM=${METER_UPSTREAM:-127.0.0.1:11434}
MHOST=${METER_LISTEN%:*}; MPORT=${METER_LISTEN##*:}
rm -rf "$EV"; mkdir -p "$EV" "$OUT/outside"
# Power integrity: keep the machine from idle-sleeping for the whole suite (best effort, process-scoped), and after
# the run check the System log for any sleep in the window (sleepcheck.ps1): a run that slept is not evidence (exit 7).
PSTART=$(date -Iseconds)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WBENCH/keepawake.ps1" -Stop "$(cygpath -w "$EV/KASTOP")" > "$EV/keepawake.out" 2>&1 & KAPID=$!
"$NODE_BIN" "$WBENCH/fp.mjs" "$WEV/fp-pre.txt" >/dev/null
"$NODE_BIN" "$WBENCH/evfp.mjs" "$WEV/ev-pre.txt" >/dev/null
( cd "$REPO" && git rev-parse HEAD > "$EV/head.txt" && git status --short > "$EV/status-pre.txt" )
JARGS=()
if [ -n "${JCODE_BIN:-}" ]; then sha256sum "$JCODE_BIN" > "$EV/jcode-sha.txt"; JARGS=(--jcode-bin "$JCODE_BIN"); else echo "JCODE_BIN unset: run.ts resolves jcode on PATH (not pinned)" | tee "$EV/jcode-sha.txt"; fi
METER_LOG="$WEV/meter.jsonl" METER_RAW="$WEV/raw" METER_LISTEN=$METER_LISTEN METER_UPSTREAM=$METER_UPSTREAM "$NODE_BIN" "$WBENCH/meter.mjs" > "$EV/meter.out" 2>&1 & MPID_BASH=$!
sleep 2
MPID=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalAddress $MHOST -LocalPort $MPORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" | tr -d '\r')
echo "meter pid=$MPID"
[ -n "$MPID" ] || { echo "meter not listening on $METER_LISTEN"; kill $MPID_BASH 2>/dev/null; exit 1; }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WBENCH/watch.ps1" -Out "$(cygpath -w "$EV/watch.log")" -Stop "$(cygpath -w "$EV/STOP")" \
  -MeterPid "$MPID" -OutsideDir "$(cygpath -w "$OUT/outside")" -MeterAddr "$MHOST" -MeterPort "$MPORT" -OllamaPort "${METER_UPSTREAM##*:}" & WPID=$!
date -Iseconds > "$EV/suite-start.txt"
# Warm the model directly (outside the meter) so neither arm's first task pays the cold load.
curl -s -m 600 "http://$METER_UPSTREAM/api/generate" -d "{\"model\":\"$MODEL\",\"prompt\":\"ok\",\"stream\":false,\"options\":{\"num_predict\":1}}" > "$EV/warmup.json"; echo "warmup rc=$?"
EXTRA=()
[ "$MODE" = control ] && EXTRA=(--no-contain-unsafe)
( cd "$REPO" && "$NODE_BIN" evals/run.ts --agent jcode --provider ollama --model "$MODEL" --model-upstream "$METER_LISTEN" "${JARGS[@]}" "${EXTRA[@]}" "$@" ) 2>&1 | tee "$EV/suite.out"
date -Iseconds > "$EV/suite-end.txt"
# The meter is every task's model upstream: if it died mid-run, every later task was graded against a refused
# connection (a harness failure, not a model result). Say so loudly; the run is not evidence.
METER_ALIVE=1; kill -0 $MPID_BASH 2>/dev/null || METER_ALIVE=0
touch "$EV/STOP"; sleep 15
kill $MPID_BASH 2>/dev/null; powershell.exe -NoProfile -Command "Stop-Process -Id $MPID -Force -ErrorAction SilentlyContinue" 2>/dev/null
wait $WPID 2>/dev/null
"$NODE_BIN" "$WBENCH/fp.mjs" "$WEV/fp-post.txt" >/dev/null
"$NODE_BIN" "$WBENCH/evfp.mjs" "$WEV/ev-post.txt" >/dev/null
( cd "$REPO" && git status --short > "$EV/status-post.txt" )
"$NODE_BIN" "$WBENCH/fpcmp.mjs" "$WEV/fp-pre.txt" "$WEV/fp-post.txt"
cmp -s "$EV/ev-pre.txt" "$EV/ev-post.txt" && echo "~/.jcode fingerprint UNCHANGED" || echo "~/.jcode fingerprint DIFFERS"
echo "TRIP lines: $(grep -c ' TRIP ' "$EV/watch.log")"
grep -h "Effective-config fingerprint" "$EV/suite.out"
RUNDIR=$(grep -h "^Report: " "$EV/suite.out" | sed 's/^Report: //; s/\r$//; s/[\\/]summary\.md$//')
if [ -n "$RUNDIR" ]; then
  "$NODE_BIN" "$WBENCH/analyze.mjs" --run "$RUNDIR" --ev "$WEV" --out "$WOUT/analysis-$LABEL.txt" >/dev/null && echo "analysis: $WOUT/analysis-$LABEL.txt"
  "$NODE_BIN" "$WBENCH/classify.mjs" --run "$RUNDIR" --out "$WOUT/classify-$LABEL.txt" >/dev/null && echo "classify: $WOUT/classify-$LABEL.txt"
  echo "results: $RUNDIR"
fi
touch "$EV/KASTOP"; wait $KAPID 2>/dev/null
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WBENCH/sleepcheck.ps1" -From "$PSTART" -To "$(date -Iseconds)" > "$EV/power.txt" 2>&1; SLEPT=$?
grep -E "^(power now|POWER WARNING|SLEEP DETECTED)" "$EV/power.txt" | tr -d '\r'
if [ $METER_ALIVE = 0 ]; then echo "METER DIED DURING THE RUN (see $EV/meter.out): results are NOT evidence"; tail -5 "$EV/meter.out"; echo SUITE-DONE; exit 6; fi
if [ $SLEPT != 0 ]; then echo "MACHINE SLEPT DURING THE RUN (see $EV/power.txt): results are NOT evidence"; echo SUITE-DONE; exit 7; fi
echo SUITE-DONE
