# SPEC 3 — Verify Gate

Docs-only spec.

## Goal
One command that proves the build is healthy.

## Scope
- Single `npm run verify` (build + lint + test) in the root `package.json`.
- One integration test: submit a task through the orchestrator and assert the
  real file side effects happened.
- Output goes to `docs/verify.log`. Chat shows pass/fail only.

## Rule
No new feature work merges while verify is red.

## Verification
- `npm run verify` runs from the repo root and writes `docs/verify.log`.
- Deliberately break the integration test; verify must fail. Restore it;
  verify must pass.
- Report the command output (pass/fail plus the pipeline steps run).
