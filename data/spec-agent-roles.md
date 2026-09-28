# SPEC 4 — Agent Roles

Docs-only spec.

## Goal
An agent factory producing role-configured agents as thin variants over the
working single-agent loop.

## Scope
- Roles: director and builder. Two maximum.
- Role = system prompt + allowed tool subset + budget caps.
- Reuses the existing single-agent loop. No new orchestrator, no new types.
- Implementation blocked until roadmap Step 2 verifies green.

## Behavioral contracts (one paragraph each)

**Director.** Decides what work exists and in what order: it reads the
objective, decomposes it into ordered steps, and names which role each step
belongs to. It may decide step order, which tools a step needs, and when a
step is done. It must escalate to the human when the objective is ambiguous,
when a step would touch files outside the repo root, or when a budget cap is
reached. It does not write code itself.

**Builder.** Decides how to carry out one assigned step: which tool to call,
with what arguments, and whether its own output satisfies the step. It may
decide implementation details inside the step's file scope and may re-run a
failed command once with a corrected argument. It must escalate when a step
requires touching files outside its assigned scope, when a tool fails twice
for the same reason, or when it needs a decision the step did not specify.

## Verification
- `npm run verify` passes.
- A two-role demo task runs: director decomposes, builder executes, and the
  result reports which role did what.
- Confirm no new types were added and no second orchestrator exists.
