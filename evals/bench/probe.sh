#!/usr/bin/env bash
# probe.sh — meter + watchdog, then streamprobe.ps1 in both modes through the real wrapper.
#   evals/bench/probe.sh --out <dir> [REPS=2 in env]
set -u
source "$(dirname "${BASH_SOURCE[0]}")/node.sh" || exit 3
[ "${1:-}" = "--out" ] && [ -n "${2:-}" ] || { echo "usage: probe.sh --out <dir>" >&2; exit 2; }
BENCH=$(cd "$(dirname "$0")" && pwd); WBENCH=$(cygpath -m "$BENCH")
mkdir -p "$2"; OUT=$(cd "$2" && pwd); WOUT=$(cygpath -m "$OUT"); EV=$OUT/ev-probe
rm -rf "$EV"; mkdir -p "$EV" "$OUT/outside"
METER_LISTEN=${METER_LISTEN:-127.0.0.2:11439}
METER_LOG="$WOUT/ev-probe/meter.jsonl" METER_RAW="$WOUT/ev-probe/raw" METER_LISTEN=$METER_LISTEN "$NODE_BIN" "$WBENCH/meter.mjs" &
MB=$!; sleep 2
MPID=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalAddress ${METER_LISTEN%:*} -LocalPort ${METER_LISTEN##*:} -State Listen).OwningProcess" | tr -d '\r')
[ -n "$MPID" ] || { echo "meter not listening"; kill $MB 2>/dev/null; exit 1; }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WBENCH/watch.ps1" -Out "$(cygpath -w "$EV/watch.log")" -Stop "$(cygpath -w "$EV/STOP")" -MeterPid "$MPID" \
  -OutsideDir "$(cygpath -w "$OUT/outside")" -MeterAddr "${METER_LISTEN%:*}" -MeterPort "${METER_LISTEN##*:}" &
WB=$!
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WBENCH/streamprobe.ps1" -Out "$(cygpath -w "$OUT")" -Meter "$METER_LISTEN" -Reps "${REPS:-2}"
touch "$EV/STOP"; sleep 12
kill $MB 2>/dev/null; powershell.exe -NoProfile -Command "Stop-Process -Id $MPID -Force" 2>/dev/null; wait $WB 2>/dev/null
echo "watch TRIPs: $(grep -c TRIP "$EV/watch.log")"; grep TRIP "$EV/watch.log" | head -5
"$NODE_BIN" -e "for(const l of require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n')){const x=JSON.parse(l);if(!x.id)continue;console.log('METER',x.id,x.t,x.status,'ttfb',x.ttfb_ms,'total',x.total_ms,'finish',x.finish||'-','usage',!!x.usage,'DONE',x.done_marker,'closer',x.first_closer,'::',x.events.map(e=>e.join('@')).join(','))}" "$WOUT/ev-probe/meter.jsonl"
echo PROBE-DONE
