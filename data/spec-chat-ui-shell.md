# SPEC 1 — Chat UI Shell

Docs-only spec. Implementation is BLOCKED until roadmap Step 2 verifies green.

## Goal
A minimal chat UI shell: a message list plus a composer, wired to the
orchestrator's task lifecycle.

## Hard rules
- Render from `packages/protocol` types only. No frontend type duplicates.
- No extra features: no streaming decorations, no attachments, no settings
  panels.
- If no chat UI exists in the repo, STOP and report that — do not scaffold a
  UI without the shell task being explicitly started.
- `data/spec-chat-ui-redesign.md` applies as the visual layer the moment the
  shell exists.

## Verification
- `npm run verify` passes with the shell present.
- One message typed into the composer reaches the orchestrator's task
  lifecycle and its result renders back in the message list.
- Report files changed and paste command output.
