#!/usr/bin/env bash
# One jcode tool-call probe in a fresh folder. Exit 0 only if test.txt == "hi" and no jcode is left running afterwards.
# jcode leaves helper jcode.exe processes behind after `jcode run`. This script kills the ones it started
# (see kill-sandbox-procs.ps1) and fails only if some survive.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SWEEP="$(cygpath -w "$HERE/kill-sandbox-procs.ps1")"
sweep() { powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SWEEP" "$@" | tr -d '\r'; }
count_jcode() { tasklist 2>/dev/null | grep -ci "^jcode.exe"; }

# Pre-existing jcode.exe might be your interactive session, so don't kill it blindly. Set PROBE_KILL_ALL=1 to clear them.
if [ "$(count_jcode)" != "0" ]; then
  if [ "${PROBE_KILL_ALL:-0}" = "1" ]; then echo "killing pre-existing jcode:"; MSYS2_ARG_CONV_EXCL='*' taskkill /F /T /IM jcode.exe 2>&1 | tr -d '\r'; sleep 1
  else echo "STRAY jcode already running (not started by this probe). Close it, or rerun with PROBE_KILL_ALL=1:"; tasklist | grep -i jcode; exit 2; fi
fi

DIR="$LOCALAPPDATA/Temp/jcode-probe-$(date +%s)-$RANDOM"; mkdir -p "$DIR"; cd "$DIR" || exit 2
WDIR="$(cygpath -w "$DIR")"
SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start=$(date +%s)
printf '\n' | timeout 900 jcode -p ollama -m hermes-local-32k run --no-update "Create a file test.txt containing hi" > out.log 2>&1
rc=$?
sleep 2
before=$(count_jcode)
swept=$(sweep -Path "$WDIR" -Name jcode.exe -SinceUtc "$SINCE")
sleep 1
left=$(count_jcode)
got=$(tr -d '\r\n ' < test.txt 2>/dev/null)
echo "dir=$DIR rc=$rc secs=$(( $(date +%s)-start )) content='$got' jcode_after_run=$before jcode_after_sweep=$left"
echo "$swept" | sed 's/^/  sweep: /'
[ "$got" = "hi" ] && [ "$left" = "0" ] && { echo PASS; exit 0; }
echo FAIL; [ "$left" != "0" ] && tasklist | grep -i jcode; tail -c 800 out.log; exit 1
