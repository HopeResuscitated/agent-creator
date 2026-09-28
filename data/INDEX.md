# data/INDEX.md — Spec Index

## GLOBAL RULES (apply to every task)
- Extend the primary types in packages/protocol; never create parallel
  definitions.
- No single file write over ~200 lines; split into modules.
- Reports and specs go to docs/ or data/ — chat output <= 10 lines.
- Every spec ends with a "Verification" section stating how Jcode will prove
  it works.

## Specs
| # | File | Status | Depends on |
|---|------|--------|------------|
| — | spec-roadmap.md | Steps 1–5; Step 1 done | — |
| 1 | spec-chat-ui-shell.md | Docs only; blocked | roadmap Step 2 green |
| 2 | spec-timing-instrumentation.md | Docs only; ready | nothing |
| 3 | spec-verify-gate.md | Docs only; ready | nothing |
| 4 | spec-agent-roles.md | Docs only; blocked | roadmap Step 2 green |
| 5 | spec-swarm-coordinator.md | GATED — do not implement | specs 1–4 done + verify green a full session |
| — | spec-chat-ui-redesign.md | Visual layer | applied when spec 1 shell exists |

## Suggested order when tool implementation is done
1. spec-timing-instrumentation.md
2. spec-verify-gate.md
   (then the roadmap's own Steps 2–5)
