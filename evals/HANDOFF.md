# Handoff: pick up here

Updated 2026-10-02. Full plan and status: `evals/PLAN.yaml`.

## Where we are
- Containment is proven (all invariants hold; decision rule passed). Harness hardened through commit `bab3a17` (runner node pinned; meter aborts upstream on agent kill).
- Current phase: finishing the foundation, A0 (committed) -> **A0b -> A1 -> A2 -> B -> hardware decision -> C**.
- Main open problem: the model sometimes emits malformed tool calls; Ollama rejects them and jcode quits the task.

## Open decisions (yours)
1. **Hardware** before the re-baseline: NVIDIA GPU? How much VRAM? (CPU at ~7 tok/s makes every benchmark take hours.)
2. **Hermes compression model**: change `auxiliary.compression.model` in Hermes `config.yaml` away from the free OpenRouter model.
3. **Retry fix option** (after A1 investigation): jcode-native vs trusted-side shim vs model-side.

## To resume in a new Claude chat
Paste:
```
Read evals/PLAN.yaml and evals/HANDOFF.md in C:\Users\cierra\Desktop\agent creator. Then tell me in 3 lines where we are and what's next. Keep answers short; I'm cost-conscious.
```

## Next Hermes prompt (fresh session, Opus)
```
Cost mode: fresh session. Read only evals/PLAN.yaml and evals/HANDOFF.md in C:\Users\cierra\Desktop\agent creator,
plus C:\Users\cierra\hermes-bench-archive\cycle7\probe7.txt. Repo head 14f50f2.

0. Confirm A0: report whether reduced.sh, t05x6.sh and probe.sh have been dry-run end to end; if not, do it now (smallest settings).
1. Phase A0b (one commit): disable Ollama auto-update for benchmark runs; record `ollama --version` and the
   hermes-local-32k model digest in baseline.txt and the fingerprint; gate() fails closed if either changes;
   copy every gate reference artifact out of %TEMP% into evals/results or the archive and repoint scripts. Stop and report.
2. Phase A1: investigate, change nothing: how jcode (C:\Users\cierra\jcode-evalpin-bin, and source if available)
   handles (a) HTTP 500 and (b) a stream ending with no finish_reason/usage. Is either retried? Where does max_retries apply?
3. Propose the A2 fix per PLAN.yaml options and constraints. Wait for my approval.
Give me exact PowerShell commands for any long run so I run them myself. Stop after each step. Update PLAN.yaml status fields.
```

## Notes
- Evidence archive (safe from cache pruning): `C:\Users\cierra\hermes-bench-archive`.
- Chat UI specs (`data/spec-chat-ui-*.md`) are blocked on roadmap Step 2. A review found 10 gaps to close first:
  attach-vs-no-attachments conflict, border contrast ~1.3:1, missing meta/dark-mode colors, no `system` role style,
  no task-state UI, undefined retry, ambiguous group timestamp, hover-only actions on touch, untestable visual gate,
  "ready" status despite no UI existing.
- Auto mode is now the default permission mode in `~/.claude/settings.json` (backup: `settings.json.bak-before-automode`).
