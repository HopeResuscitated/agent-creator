#!/usr/bin/env bash
# scratch.sh - sourced by the real-process test scripts. scratch_dir <dir>: make <dir> a fresh scratch directory, but
# only delete it if it is empty or was created by a previous test run (it carries the .evals-test-scratch marker).
# A typo such as `bash watch-smoke.sh ~` therefore refuses instead of deleting a directory the tests never made.
scratch_dir() {
  local d=$1
  [ -n "$d" ] || { echo "scratch dir is empty" >&2; return 2; }
  if [ -e "$d" ]; then
    if [ -n "$(ls -A "$d" 2>/dev/null)" ] && [ ! -f "$d/.evals-test-scratch" ]; then
      echo "refusing to delete $d: not empty and not a test scratch dir (no .evals-test-scratch marker)" >&2; return 2
    fi
    rm -rf "$d" || return 2
  fi
  mkdir -p "$d" && : > "$d/.evals-test-scratch"
}
