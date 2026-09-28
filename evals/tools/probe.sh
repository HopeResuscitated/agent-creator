#!/usr/bin/env bash
# One jcode tool-call probe in a fresh folder. Exit 0 only if test.txt == "hi" and no jcode is left running.
set -u
if tasklist | grep -qi '^jcode.exe'; then echo "STRAY jcode running:"; tasklist | grep -i jcode; exit 2; fi
DIR="$LOCALAPPDATA/Temp/jcode-probe-$(date +%s)-$RANDOM"; mkdir -p "$DIR"; cd "$DIR" || exit 2
start=$(date +%s)
printf '\n' | timeout 900 jcode -p ollama -m hermes-local-32k run --no-update "Create a file test.txt containing hi" > out.log 2>&1
rc=$?
sleep 2
stray=$(tasklist | grep -ci '^jcode.exe')
got=$(cat test.txt 2>/dev/null | tr -d '\r\n ')
echo "dir=$DIR rc=$rc secs=$(( $(date +%s)-start )) content='$got' stray_jcode=$stray"
[ "$got" = "hi" ] && [ "$stray" = "0" ] && { echo PASS; exit 0; }
echo FAIL; tail -c 800 out.log; exit 1
