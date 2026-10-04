#!/usr/bin/env bash
# gates.sh - every pre-run gate, machine-checked; one PASS/FAIL line each, exit 0 only if all pass.
# Run before any evidence run and after every re-pin (evals/REPIN.md). Never skip a gate because an older pin passed it.
#   JCODE_BIN=<pinned jcode.exe> bash evals/bench/gates.sh --out <dir> [--refuse <jcode.exe>]... [--bare-node <node.exe>]
#     --refuse     a NON-pinned agent binary that run.ts must refuse (repeatable; default: the superseded 1fbb2e1b4 pin)
#     --bare-node  a NON-pinned node.exe that run.ts must refuse (default: Hermes's bundled node)
# Refuses to start (exit 9) while any jcode.exe runs or any client holds a connection to Ollama: the meter-abort
# gate measures Ollama latency, and a competing client would make it meaningless.
# Writes only under --out (and run.ts's usual evals/results for a refused run: none, refusal happens first).
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 3
OUT=; REFUSE=(); BARE=C:/Users/cierra/AppData/Local/hermes/node/node.exe
while [ $# -gt 0 ]; do case $1 in
  --out) OUT=$2; shift 2;; --refuse) REFUSE+=("$2"); shift 2;; --bare-node) BARE=$2; shift 2;;
  *) echo "unknown arg $1"; exit 3;; esac; done
[ -n "$OUT" ] || { echo "usage: JCODE_BIN=<pinned> gates.sh --out <dir> [--refuse <bin>]... [--bare-node <node>]"; exit 3; }
[ ${#REFUSE[@]} -gt 0 ] || REFUSE=(C:/Users/cierra/jcode-evalpin-bin/jcode.exe)
[ -n "${JCODE_BIN:-}" ] || { echo "JCODE_BIN (the pinned jcode.exe) is not set"; exit 3; }
mkdir -p "$OUT"; R="$OUT/gates.txt"; : > "$R"
source evals/bench/node.sh || exit 3
ENV=evals/baseline-env.json
j=$(tasklist 2>/dev/null | grep -ci '^jcode.exe'); c=$(netstat -ano 2>/dev/null | grep -E '127\.0\.0\.1:[0-9]+ +127\.0\.0\.1:11434 +ESTAB' | wc -l)
[ "$j" = 0 ] && [ "$c" = 0 ] || { echo "BUSY: running jcode.exe=$j, Ollama client connections=$c; not starting" | tee -a "$R"; exit 9; }
FAILS=0
gate() { if [ "$2" = 1 ]; then echo "PASS $1 | $3" | tee -a "$R"; else echo "FAIL $1 | $3" | tee -a "$R"; FAILS=$((FAILS + 1)); fi; }
pinval() { grep -m1 "\"$1\":" "$ENV" | sed 's/.*": *"\([^"]*\)".*/\1/'; }
RUN=(--agent jcode --provider ollama --model hermes-local-32k --model-upstream 127.0.0.1:11434 --only T01)
echo "gates $(date -Iseconds) HEAD $(git rev-parse --short HEAD) JCODE_BIN=$JCODE_BIN" | tee -a "$R"

# 1. positive pins: the binaries/runtime we are about to use are exactly the pinned ones
have=$(sha256sum "$JCODE_BIN" | cut -c1-64); want=$(pinval jcode_sha256)
gate jcode-pin-match "$([ "$have" = "$want" ] && echo 1)" "sha256 ${have:0:16} vs pin ${want:0:16}; $("$JCODE_BIN" --version 2>/dev/null | tr -d '\r')"
ver=$(curl -s -m 10 http://127.0.0.1:11434/api/version | sed 's/.*"version":"\([^"]*\)".*/\1/'); wver=$(pinval ollama_version)
gate ollama-version-match "$([ "$ver" = "$wver" ] && echo 1)" "running $ver vs pin $wver"
dig=$(curl -s -m 10 http://127.0.0.1:11434/api/tags | grep -o '"name":"hermes-local-32k:latest"[^}]*"digest":"[0-9a-f]*"' | sed 's/.*"digest":"\([0-9a-f]*\)"/\1/'); wdig=$(pinval hermes-local-32k)
gate model-digest-match "$([ -n "$dig" ] && [ "$dig" = "$wdig" ] && echo 1)" "hermes-local-32k ${dig:0:16} vs pin ${wdig:0:16}"

# 2. negative pins: run.ts refuses (exit 2) before anything is staged
bsha=$(sha256sum "$BARE" 2>/dev/null | cut -c1-64)
if [ -z "$bsha" ] || [ "$bsha" = "$(pinval node_sha256)" ]; then gate node-pin-refusal "" "--bare-node $BARE missing or IS the pinned node: cannot test the refusal"
else out=$("$BARE" evals/run.ts "${RUN[@]}" --jcode-bin "$JCODE_BIN" 2>&1); rc=$?
     gate node-pin-refusal "$([ $rc = 2 ] && grep -q 'REFUSING TO RUN' <<<"$out" && echo 1)" "$("$BARE" --version | tr -d '\r') -> exit $rc"; fi
out=$("$NODE_BIN" evals/run.ts "${RUN[@]}" --jcode-bin "$JCODE_BIN" --ollama-api 127.0.0.1:1 2>&1); rc=$?
gate model-server-refusal "$([ $rc = 2 ] && grep -q 'REFUSING TO RUN' <<<"$out" && echo 1)" "unreachable model-server API -> exit $rc"
for b in "${REFUSE[@]}"; do
  if [ "$(sha256sum "$b" 2>/dev/null | cut -c1-64)" = "$want" ] || [ ! -f "$b" ]; then gate "jcode-pin-refusal $b" "" "missing or IS the pinned binary: cannot test the refusal"; continue; fi
  out=$("$NODE_BIN" evals/run.ts "${RUN[@]}" --jcode-bin "$b" 2>&1); rc=$?
  gate "jcode-pin-refusal" "$([ $rc = 2 ] && grep -q 'REFUSING TO RUN' <<<"$out" && echo 1)" "$b -> exit $rc"
done

# 3. containment / security
out=$("$NODE_BIN" evals/tools/contained-child-test.mjs 2>&1); echo "$out" > "$OUT/contained-child.txt"
gate contained-child "$(grep -q 'all 10 cases passed' <<<"$out" && echo 1)" "$(grep -E 'cases' <<<"$out" | tail -1 | tr -d '\r')"
out=$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$PWD/evals/bench/secprobe.ps1")" -Out "$(cygpath -w "$OUT/sec")" 2>&1); echo "$out" > "$OUT/secprobe.txt"
gate secprobe "$(grep -q 'RESULT 0 failures of 20' <<<"$out" && echo 1)" "$(grep -E '^RESULT' <<<"$out" | tr -d '\r')"

# 4. relay / broker byte tests
out=$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$PWD/evals/bench/relaytest/harness.ps1")" -Repo "$(cygpath -w "$PWD")" -Out "$(cygpath -w "$OUT/relay")" 2>&1 | tr -d '\r'); echo "$out" > "$OUT/relay.txt"
gate relay-bytes "$(grep -qx 'TOTAL 12/12' <<<"$out" && echo 1)" "transfers through broker + relay"
gate relay-after-stop "$(grep -A1 -x 'after Stop():' <<<"$out" | grep -qx 'TOTAL 0/3' && echo 1)" "no transfer after ModelBroker.Stop()"
gate relay-port-range "$(grep -q 'port 99999: refused at start' <<<"$out" && echo 1)" "out-of-range upstream port refused"
out=$("$NODE_BIN" evals/bench/relaytest/contained-e2e.mjs 2>&1 | tr -d '\r'); echo "$out" > "$OUT/contained-e2e.txt"
gate contained-e2e "$(grep -q 'TOTAL 9/9' <<<"$out" && grep -q 'contained transfer: wrapper exit=0' <<<"$out" && echo 1)" "9 contained transfers"
gate contained-e2e-busy-port "$(grep -q 'relay port already in use: wrapper exit=4' <<<"$out" && echo 1)" "busy relay port -> SETUP_FAILED (exit 4)"

# 5. meter aborts upstream when the agent disconnects (real Ollama)
out=$("$NODE_BIN" evals/bench/meterabort.mjs 2>&1 | tr -d '\r'); echo "$out" > "$OUT/meterabort.txt"
gate meter-kill-abort "$(grep -q '^METERABORT PASS' <<<"$out" && echo 1)" "$(grep '^METERABORT' <<<"$out" | cut -c1-120)"

echo "GATES $([ $FAILS = 0 ] && echo PASS || echo "FAIL ($FAILS failed)") $(date -Iseconds)" | tee -a "$R"
[ $FAILS = 0 ]
