#!/usr/bin/env bash
# watch-smoke.sh - real-process test of evals/bench/watch.ps1 + tripclass.mjs. No model, no network egress.
#   bash evals/test/watch-smoke.sh <scratch dir>
# A copy of node.exe named jcode.exe (no evalbroker profile -> root=external) holds three connections:
#   127.0.0.2:<meter port>  -> TRIP meter-connection-from-non-broker (VIOLATION when contained)
#   127.0.0.3:<port>        -> loopback: must NOT be reported as agent-nonloopback-connection
#   <LAN IPv4>:<port>       -> agent-nonloopback-connection ... root=external (UNATTRIBUTED); skipped if no LAN IPv4
#   ::ffff:127.0.0.4:<port> -> IPv4-mapped loopback (dual-stack socket): must NOT be reported as non-loopback
#   127.0.0.5:<ollama port> -> a client of the Ollama port on an address other than 127.0.0.1: must be reported
set -u
S=${1:?scratch dir}; HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$HERE/../bench/node.sh" || exit 3
source "$HERE/scratch.sh"; scratch_dir "$S" || exit 2; mkdir -p "$S/outside"; WS=$(cygpath -m "$S")
cp "$NODE_BIN" "$S/jcode.exe"
LAN=$("$NODE_BIN" -e "const n=require('os').networkInterfaces();for(const k in n)for(const a of n[k])if(a.family==='IPv4'&&!a.internal){console.log(a.address);process.exit(0)}")
P=$(( 30000 + RANDOM % 20000 ))
cat > "$S/servers.js" <<EOF
const net=require('net');const s=(h,p)=>net.createServer(c=>c.on('error',()=>{})).listen(p,h);
s('127.0.0.2',$P);s('127.0.0.3',$P);s('::',$((P+2)));s('127.0.0.5',$((P+3)));${LAN:+s('0.0.0.0',$((P+1)));}setTimeout(()=>process.exit(0),30000);
EOF
cat > "$S/client.js" <<EOF
const net=require('net');const k=[];const c=(h,p)=>{const x=net.connect(p,h);x.on('error',()=>{});k.push(x)};
c('127.0.0.2',$P);c('127.0.0.3',$P);c('::ffff:127.0.0.4',$((P+2)));c('127.0.0.5',$((P+3)));${LAN:+c('$LAN',$((P+1)));}setTimeout(()=>process.exit(0),12000);
EOF
"$NODE_BIN" "$WS/servers.js" & SV=$!; sleep 1
"$S/jcode.exe" "$WS/client.js" & CL=$!; sleep 2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$HERE/../bench/watch.ps1")" -Out "$(cygpath -w "$S/watch.log")" -Stop "$(cygpath -w "$S/STOP")" \
  -MeterPid 1 -OutsideDir "$(cygpath -w "$S/outside")" -IntervalSec 1 -OllamaPort $((P+3)) -MeterAddr 127.0.0.2 -MeterPort $P & WP=$!
sleep 4
# the dual-stack client to ::ffff:127.0.0.4 must exist (Windows reports it as 127.0.0.4: Get-NetTCPConnection
# normalizes IPv4-mapped remotes; watch.ps1/tripclass.mjs still accept the mapped form defensively)
MAPPED=$(powershell.exe -NoProfile -Command "@(Get-NetTCPConnection -RemotePort $((P+2)) -State Established -ErrorAction SilentlyContinue | Where-Object { \"\$(\$_.RemoteAddress)\" -in @('127.0.0.4', '::ffff:127.0.0.4') }).Count" | tr -d '\r')
sleep 2; touch "$S/STOP"; wait $WP; kill $CL $SV 2>/dev/null; wait 2>/dev/null
F=0; chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; F=$((F+1)); fi; }
chk meter-client-trip 'grep -q "TRIP meter-connection-from-non-broker .*name=jcode.exe" "$S/watch.log"'
chk mapped-loopback-present '[ "${MAPPED:-0}" -ge 1 ]'
chk no-mapped-loopback-trip '! grep -q "agent-nonloopback-connection .*remote=::ffff:127." "$S/watch.log"'
chk ollama-port-any-address 'grep -q "TRIP ollama-connection-from-non-meter .*name=jcode.exe" "$S/watch.log"'
chk no-sample-failure '! grep -q "watch-sample-failed" "$S/watch.log"'
chk no-127.0.0.3-trip '! grep -q "agent-nonloopback-connection .*remote=127\." "$S/watch.log"'
if [ -n "$LAN" ]; then chk lan-trip-root-external 'grep -q "agent-nonloopback-connection .*remote=$LAN:$((P+1)) name=jcode.exe root=external" "$S/watch.log"'; else echo "SKIP lan-trip (no LAN IPv4)"; fi
"$NODE_BIN" "$(cygpath -m "$HERE/../bench/tripclass.mjs")" --ev "$WS" --mode contain > "$S/tripclass.txt"; TC=$?
chk tripclass-flags-it '[ $TC = 1 ] && grep -q "VIOLATION=" "$S/tripclass.txt"'
[ -n "$LAN" ] && chk tripclass-external-unattributed 'grep -q "UNATTRIBUTED=" "$S/tripclass.txt"'
chk watch-clean-stop 'grep -q "watch stop samples=" "$S/watch.log"'
[ $F = 0 ] && { echo "WATCH-SMOKE PASS"; exit 0; } || { echo "WATCH-SMOKE FAIL ($F)"; cat "$S/watch.log"; exit 1; }
