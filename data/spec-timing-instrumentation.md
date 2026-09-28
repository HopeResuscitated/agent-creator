# SPEC 2 — Timing Instrumentation

Docs-only spec.

## Goal
Turn "it seems faster" into numbers.

## Scope
- Wrap every tool dispatch in orchestrator `executeTool()` with a
  `Date.now()` elapsed measurement.
- Append one line per call to `docs/tool-timing.log`:
  `timestamp | tool | taskId | durationMs | status`
- Optional: a timing summary field on task results.

## Bench script
`packages/agent/scripts/bench-tools.ts`
- Run each real tool 5x against a temp dir.
- Write averages to `docs/BENCH.md`.
- Clean up the temp dir.

## Notes
- `runCommand` will dominate timings. That is expected, not a bug.

## Verification
- `npm run verify` passes.
- Run a task that calls at least two tools; `docs/tool-timing.log` has one
  line per call with a plausible durationMs.
- `bench-tools.ts` runs to completion, prints the averages, and leaves no
  temp files behind. Paste the bench output.
