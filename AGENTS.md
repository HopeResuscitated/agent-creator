# AGENTS.md — agent creator (local jcode agent)

Backend: local Ollama 0.34.4, model hermes-local-32k (Qwen3-Coder 30B-A3B
Instruct, Q4_K_M, 32k context), CPU-only. Output tokens are the bottleneck
(~3-5 tok/s on long prompts; the first token can take minutes). Keep this file
short: it is re-read on every turn.

## SPEED RULES
- Prefer patch/edit over full-file rewrites. Never regenerate a file to
  change a few lines.
- Keep replies terse. No restating the task, no echoing file contents
  back after writing them.
- Read only the files the task needs; use search before read.
- Reasoning/thinking mode only for planning and debugging, not for
  mechanical writes or edits.

## FILE SIZE RULES
- No single file write over ~200 lines. Split large implementations into
  multiple small modules (e.g., tools/fs.ts, tools/shell.ts, tools/git.ts).
- Implement incrementally: one tool at a time, verify it, then the next —
  never generate all tools in one write.
- When creating or replacing a large file, outline its structure in chat
  first and confirm the module breakdown before writing.

## VERIFY
- After each module: npm run typecheck (then lint). Fix before moving on.

## SPECS
- Task specs live in data/. Read the relevant spec before starting:
  data/spec-roadmap.md (build steps 1–5), data/spec-chat-ui-redesign.md.
