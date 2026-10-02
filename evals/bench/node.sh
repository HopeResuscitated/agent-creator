# node.sh — sourced by the evals/bench shell scripts. Resolves the pinned runner node by ABSOLUTE path, never
# `node` from PATH (run.ts copies its own node into the agent's tools root, so the runner node is an agent input).
#   NODE_BIN=<path to node.exe>   override (must still match evals/baseline-env.json, or run.ts refuses)
# Fails (exit 3) unless NODE_BIN's version and sha256 equal the pin in evals/baseline-env.json.
_BENCH_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
_PIN_FILE="$_BENCH_DIR/../baseline-env.json"
NODE_BIN=${NODE_BIN:-C:/Users/cierra/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node.exe}
_pin_ver=$(grep -m1 '"node":' "$_PIN_FILE" | sed 's/.*"node": *"\([^"]*\)".*/\1/')
_pin_sha=$(grep -m1 '"node_sha256":' "$_PIN_FILE" | sed 's/.*"node_sha256": *"\([^"]*\)".*/\1/')
if [ ! -f "$NODE_BIN" ]; then echo "pinned node not found: NODE_BIN=$NODE_BIN" >&2; exit 3; fi
_have_ver=$("$NODE_BIN" --version | tr -d '\r'); _have_sha=$(sha256sum "$NODE_BIN" | cut -c1-64)
if [ "$_have_ver" != "$_pin_ver" ] || [ "$_have_sha" != "$_pin_sha" ]; then
  echo "NODE_BIN=$NODE_BIN is $_have_ver sha256=$_have_sha; pinned $_pin_ver sha256=$_pin_sha (evals/baseline-env.json)" >&2; exit 3
fi
export NODE_BIN
echo "runner node: $NODE_BIN $_have_ver sha256=${_have_sha:0:16}"
