#!/usr/bin/env bash
# t05x6.sh — T05 only, 3 contained + 3 control, interleaved C,D,C,D,C,D so machine drift spreads across both arms.
#   evals/bench/t05x6.sh --out <dir> [--ref <effective-config.json>] [--expect-head <sha>]
# Same gate and per-task fingerprint check as reduced.sh (this is reduced.sh with fixed tasks and labels).
set -u
exec bash "$(dirname "$0")/reduced.sh" --tasks T05 "$@" C-a:contain D-a:control C-b:contain D-b:control C-c:contain D-c:control
