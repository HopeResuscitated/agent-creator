#!/usr/bin/env bash
# reduced.sh — a sequence of suite.sh runs with a pre-run gate and a post-run fingerprint check.
#
#   evals/bench/reduced.sh --out <dir> [--tasks T13,T14,T17,T04,T05,T03,T08,T01] [--ref <effective-config.json>]
#                          [--expect-head <sha>] <label>:<contain|control> ...
#
# Gate before each run: repo HEAD (if --expect-head), no tracked changes, no client connected to Ollama, no
# jcode.exe running. After each run, with --ref: every task's effective-config fingerprint must equal the
# reference run's for the same task, else the sequence stops (exit 4). Any non-zero suite.sh exit (6 meter died,
# 7 slept, 8 run.ts failed/refused, 10 integrity, 11 Ollama restarted, 130 interrupted, ...) also stops it with that code. Log: <out>/reduced.log.
# Cycle-6 reduced benchmark: reduced.sh --out <dir> --ref <C1>/effective-config.json D1-R:control C2-R:contain D2-R:control
set -u
source "$(dirname "${BASH_SOURCE[0]}")/node.sh" || exit 3
BENCH=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$BENCH/../.." && pwd)
OUT=; TASKS=T13,T14,T17,T04,T05,T03,T08,T01; REF=; HEAD_WANT=; RUNS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT=$2; shift 2 ;; --tasks) TASKS=$2; shift 2 ;; --ref) REF=$2; shift 2 ;; --expect-head) HEAD_WANT=$2; shift 2 ;;
    *:contain|*:control) RUNS+=("$1"); shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] && [ ${#RUNS[@]} -gt 0 ] || { echo "usage: reduced.sh --out <dir> [--tasks ..] [--ref f] [--expect-head sha] <label>:<mode> ..." >&2; exit 2; }
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd); LOG=$OUT/reduced.log
gate() {
  echo "--- gate $1 $(date -Iseconds)" | tee -a "$LOG"
  local head br dirty conns jc
  head=$(cd "$REPO" && git rev-parse --short HEAD); br=$(cd "$REPO" && git branch --show-current)
  dirty=$(cd "$REPO" && git status --porcelain --untracked-files=no | wc -l)
  conns=$(powershell.exe -NoProfile -Command "@(Get-NetTCPConnection -RemotePort 11434 -State Established -ErrorAction SilentlyContinue).Count" | tr -d '\r')
  jc=$(tasklist 2>/dev/null | grep -ci "^jcode.exe")
  echo "head=$head branch=$br dirty_tracked=$dirty ollama_client_conns=$conns running_jcode=$jc" | tee -a "$LOG"
  [ -n "${JCODE_BIN:-}" ] && echo "jcode sha=$(sha256sum "$JCODE_BIN" | cut -c1-16) version=$("$JCODE_BIN" --version 2>&1)" | tee -a "$LOG"
  if [ -n "$HEAD_WANT" ] && [ "${head}" != "${HEAD_WANT:0:${#head}}" ]; then echo "GATE FAIL: HEAD $head != $HEAD_WANT" | tee -a "$LOG"; exit 3; fi
  [ "$dirty" = 0 ] && [ "$conns" = 0 ] && [ "$jc" = 0 ] || { echo "GATE FAIL: dirty tree or unrelated Ollama/jcode activity" | tee -a "$LOG"; exit 3; }
}
fpcheck() {
  [ -n "$REF" ] || return 0
  local dir; dir=$(grep -h "^Report: " "$OUT/run-$1.log" | sed 's/^Report: //; s/\r$//; s/[\\/]summary\.md$//')
  "$NODE_BIN" -e "
    const fs=require('fs');
    const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8')), b=JSON.parse(fs.readFileSync(process.argv[2]+'/effective-config.json','utf8'));
    const keys=['agent_config','agent_args','env_names','env_values','jcode_sha256','model','task_prompt','tools_root','baseline','model_server'];
    const A=Object.fromEntries(a.tasks.map(t=>[t.id,t])); let bad=0;
    for (const t of b.tasks) { const diff=keys.filter(k=>A[t.id]?.[k]!==t[k]); if(diff.length) bad++; console.log(t.id, diff.length? 'MISMATCH '+diff.join(','):'match ref'); }
    console.log('mode='+b.mode+' tasks='+b.tasks.length+' mismatches='+bad); process.exit(bad?1:0);
  " "$REF" "$dir" | tee -a "$LOG"
  return "${PIPESTATUS[0]}"
}
for r in "${RUNS[@]}"; do
  L=${r%%:*}; M=${r##*:}
  gate "$L"
  echo "=== $(date -Iseconds) start $L ($M) tasks=$TASKS" | tee -a "$LOG"
  bash "$BENCH/suite.sh" --out "$OUT" "$L" "$M" --only "$TASKS" > "$OUT/run-$L.log" 2>&1; SRC=$?
  echo "=== $(date -Iseconds) end $L :: $(grep -E '^Score|TRIP lines|TRIP NEEDS REVIEW|fingerprint (UNCHANGED|DIFFERS)|UNCHANGED|DIFFERS' "$OUT/run-$L.log" | tr '\n' ' ' | cut -c1-300)" | tee -a "$LOG"
  [ $SRC = 6 ] && { echo "STOP: meter died during $L ($OUT/ev-$L/meter.out); $L is not evidence" | tee -a "$LOG"; exit 6; }
  [ $SRC = 7 ] && { echo "STOP: machine slept during $L ($OUT/ev-$L/power.txt); $L is not evidence" | tee -a "$LOG"; exit 7; }
  [ $SRC = 8 ] && { echo "STOP: run.ts failed or refused during $L ($OUT/ev-$L/suite.out); $L is not evidence" | tee -a "$LOG"; exit 8; }
  [ $SRC = 10 ] && { echo "STOP: repo or ~/.jcode changed during $L ($OUT/ev-$L/fp-*.txt, ev-*.txt); $L is not evidence" | tee -a "$LOG"; exit 10; }
  [ $SRC != 0 ] && { echo "STOP: suite exit $SRC during $L; $L is not evidence" | tee -a "$LOG"; exit $SRC; }
  fpcheck "$L" || { echo "STOP: fingerprint mismatch in $L" | tee -a "$LOG"; exit 4; }
done
echo REDUCED-DONE | tee -a "$LOG"
