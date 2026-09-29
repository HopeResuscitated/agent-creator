# Verification tiers

Spec: `data/spec-verify-gate.md` (and roadmap Step 3 in `data/spec-roadmap.md`).
Rule: no new feature work merges while Tier 1 is red.

## Tier 1 — `npm run verify` (the gate)

Deterministic, offline. No Ollama, jcode, network, or browser. Runs from the repo root.

| Step | What it runs | Fails when |
|---|---|---|
| typecheck | `tsc --noEmit -p packages/agent` | any type error |
| build | deletes `packages/agent/dist`, then `tsc -p packages/agent` | compile error |
| dist-layout | checks `dist/index.js`, `dist/orchestrator.js`, `dist/tools/index.js` exist (the files `packages/agent/package.json` promises), then `import('./packages/agent/dist/index.js')` | a file is missing or the import throws |
| lint | `eslint . --max-warnings=0` (typescript-eslint recommended) | any error or warning |
| test | `node --test` on every `packages/agent/test/*.test.ts` | any failing test, no test files, or the required integration test `orchestrator.test.ts` is missing |

- Every step runs even if an earlier one fails, so the log is complete.
- The console shows one PASS/FAIL line per step plus the verdict. The full output goes to `docs/verify.log`, which is gitignored via `*.log`.
- Exit code is 0 only if all steps pass.
- Tools come from the repo's own `node_modules`, invoked through `process.execPath`, with no shell and no npx.
- The build step deletes the old dist first, so a leftover dist from an earlier layout can't satisfy the layout check.

### Lint scope

The gate lints the package it verifies (`packages/agent`, the worker runtime) and the gate's own scripts. The other workspaces are left out of the gate. Nothing is silenced; `npm run lint:all` lints everything and currently reports 29 pre-existing errors:

- `packages/cli`: 15
- `packages/protocol`: 9
- `packages/shared`: 5

Each workspace joins the gate once its lint debt is fixed.

### Proof that the gate is real (2026-09-29)

- On the current tree: RED, `dist-layout` only. That is the known Step 3 / T14 build layout defect.
- `stepsCompleted` changed from 2 to 3 in `orchestrator.test.ts`: `test` FAIL (11 pass, 1 fail). The file was then restored byte-identical (same sha256).
- A new `zz-deliberate-broken.test.ts` added: `test` FAIL.
- A `: any` added to an agent source file: `lint` FAIL (`no-explicit-any`).
- `orchestrator.test.ts` removed: `test` FAIL ("REQUIRED TEST MISSING").
- In a scratch copy with the dist layout fixed: every step PASS, exit 0.

## Tier 2 — grader self-check (no model)

    node evals/run.ts --agent none        # must be 0/18
    node evals/run.ts --agent reference   # must be 18/18

- These prove the checks can fail and can pass against the frozen baseline `eval-baseline-v1`.
- Run them after any change under `evals/`.
- Each run records the baseline commit and any environment drift, meaning `node_modules` versions that differ from `evals/baseline-env.json`.

## Tier 3 — live agent evals (jcode + local Ollama)

    node evals/run.ts [--only T12,T13]

- These take hours and are started by the user.
- Run one at a time. Check `Get-Process node,jcode` first, and don't modify the repo while one is running.
- Grading is based on content, not on exit codes.
- Sandboxes always start from `eval-baseline-v1`, never from the working tree.
