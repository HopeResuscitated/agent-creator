# SPEC 5 — Swarm Coordinator

> DO NOT IMPLEMENT until specs 1–4 are complete and verify has been green for
> a full session.

Docs-only spec.

## Goal
A K3-style pub/sub mesh layered over the agent factory.

## Scope
- One message bus.
- Role-based subscriptions.
- Shared task ledger.
- Director decomposes objectives; builders claim subtasks.

## Guardrails
- Maximum agent count.
- Per-agent token and time budgets.
- Kill switch that stops all agents immediately.

## Verification
- `npm run verify` passes.
- Demo: one objective is split across two builders and the results are
  reassembled into one report.
- Kill switch test: trigger it mid-run and confirm no further tool calls are
  made afterwards.
- Budget test: a run that exceeds a per-agent budget stops at the cap and
  says why.
