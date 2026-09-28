# SPEC: Build Roadmap (steps 1–5)

Rule for every step: "If you find yourself creating a new package or a
parallel definition of an existing type, stop and extend the primary one
instead." Primary types live in packages/protocol/types.ts.
Follow AGENTS.md size rules. Stop after each step's verification and report.

## Step 1 — Tool Executor   [DONE 2026-09-27]
Implement the real tool executor in packages/agent/tools/index.ts, replacing
all mocks/placeholders. Tools: read_file, write_file, edit_file, list_dir,
run_command (shell, timeout + output capture), grep/search.
Rules: reuse existing Tool/ToolResult types from the PRIMARY package only;
sandbox run_command to the repo root and refuse path escape; every tool
returns a structured ToolResult with success/error fields.
Verify: build passes; a test script exercises each tool for real against a
temp directory.
Result: packages/agent/tools/{sandbox,fs,shell,search,index}.ts;
node --test packages/agent/test/tools.test.ts -> 9/9 pass; tsc build clean.

## Step 2 — Orchestrator
Upgrade packages/agent/orchestrator.ts to drive the real tool executor
through a full task lifecycle: receive task -> plan (skill selection) ->
execute steps via tools -> capture results -> validate -> review -> emit
final report with verification status. Single-agent. Use the existing Task
schema.
Verify: build passes and one real end-to-end task (e.g. "create a file
containing X, then read it back and confirm") completes with truthful status.

## Step 3 — Gate
Add an integration test that submits a task through the orchestrator and
asserts the file/command side effects actually happened. Wire build + lint +
test into a single `npm run verify` in the primary package. Do not proceed to
any new feature until `verify` passes. Report the command output.
Known issue to fix here: agent build emits dist/agent/... because protocol
has no build; package.json expects dist/index.js.

## Step 4 — Agent Factory
Add an agent factory producing role-configured agents (director, builder) as
thin variants over the working single-agent loop: role = system prompt +
allowed tool subset + budget limits. Two roles only. No new orchestrator, no
new types.
Verify: `npm run verify` plus a two-role demo task.

## Step 5 — Swarm (only if 1–4 are green)
K3-style swarm coordinator as a pub/sub mesh over the existing agent factory:
one message bus, role-based subscriptions, shared task ledger. Director
decomposes objectives; builders claim subtasks. Guardrails: max agents,
per-agent budgets, kill switch.
Verify: `npm run verify` passes, plus a demo where one objective is split
across two builders and reassembled.
