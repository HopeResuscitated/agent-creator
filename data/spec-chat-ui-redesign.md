# SPEC: Chat UI Redesign (frontend only)

Status: ready for agent. Scope: frontend chat UI only.

## Constraints
- Do not touch agent skills, tools, backend behavior, or the protocol.
  Preserve all existing functionality.
- If you find yourself creating a new package or a parallel definition of an
  existing type, stop and extend the primary one instead.
- Follow AGENTS.md: no file write over ~200 lines; one component at a time;
  prefer edit_file over full rewrites.

## Step 0 — Inspect first
Find the chat UI package (components, styles, CSS framework in use). Adapt
the tokens below to the existing stack (CSS modules, Tailwind,
styled-components, etc.). Do not introduce a new CSS framework or rebuild
unrelated parts of the app.

Repo note (as of 2026-09-27): apps/web contains only package.json (Vite +
TypeScript, no components yet). If no chat UI exists, STOP and report that
instead of scaffolding one — building the UI is a separate task.

## Design tokens (CSS variables)
  --font-ui: Segoe UI, system-ui, -apple-system, sans-serif
  --font-mono: ui-monospace, Consolas, monospace   (code blocks only)

Type scale:
  page title     20px / 600
  section label  12px / 600 / uppercase / letter-spacing 0.04em
  message text   15px / 400 / line-height 1.6
  message meta   12px / 400 (timestamps, "You"/agent labels)
  composer text  15px / 400
  buttons        14px / 500

Color (light default; dark via prefers-color-scheme):
  user message   bg #2563eb, text #ffffff, radius 14px 14px 4px 14px
  agent message  bg #f4f4f5 (dark #27272a), text #18181b (dark #e4e4e7),
                 radius 14px 14px 14px 4px
  borders #e4e4e7, primary action #2563eb, danger #dc2626
  User/agent distinction must ALSO carry a text label ("You" / agent name)
  — never color or alignment alone.

## Layout
- Conversation max-width 760px, centered; messages max-width 85% of column.
- Message gap 16px; consecutive same-sender messages grouped with 4px gaps
  and one shared label/timestamp per group.
- Composer: top border + 8px gap, sticky bottom, min-height 44px, focus ring
  2px with 2px offset.
- Agent markdown: h3 16px/600, paragraph margins 0.75em, code blocks mono
  13px with background + 8px padding, lists properly indented.
- Secondary actions (copy, retry, attach): icon-only, 32px hit area, visible
  on hover/focus of the message.

## Accessibility
- Contrast >= 4.5:1 for all text (check gray-on-gray: meta text on agent bg).
- All interactive elements keyboard-reachable with visible focus states.
- Semantic HTML: <main> for conversation; role="log" aria-live="polite" on
  the message list; real <button> elements.
- At <=640px: full-width messages; composer above safe-area inset
  (env(safe-area-inset-bottom)).

## Verify (gate — do not report done until all pass)
1. build + lint pass (paste command output).
2. Send one user message and one agent reply; visually confirm (screenshot
   if headless tooling exists) that user vs agent is scannable in < 2s.

## Final report must include
- Visual problems found
- Files changed
- How user/agent messages are now differentiated
- Typography/spacing rules applied
- Accessibility improvements
