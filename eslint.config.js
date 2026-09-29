// Flat config for the Tier-1 verify gate (data/spec-verify-gate.md).
// typescript-eslint parser + recommended rules, syntax-level only (no type-aware
// rules): typechecking is its own verify step (tsc --noEmit -p packages/agent).
//
// Gate scope = the package the gate verifies (packages/agent, the worker runtime)
// plus the gate's own scripts. Other workspaces carry known pre-existing lint debt
// (see docs/VERIFY.md); they are excluded from the gate, not silenced:
//   npm run lint:all   -> lints every package and reports that debt.
import tseslint from 'typescript-eslint';

const all = process.env.LINT_SCOPE === 'all';

export default tseslint.config(
  {
    // Never linted: build output, deps, caches, and the grader (evals/ is harness-owned).
    ignores: [
      '**/dist/**', '**/node_modules/**', '.turbo/**', 'evals/**',
      'packages/protocol/types.js', 'packages/protocol/types.d.ts',
      ...(all ? [] : ['apps/**', 'packages/cli/**', 'packages/protocol/**', 'packages/shared/**']),
    ],
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.recommended],
  },
);
