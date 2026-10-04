# Resume notes (written 2026-09-28, before restart)

## Goal right now
Get the local JCode + Ollama stack to execute tool calls reliably, then:
probe pass -> `node evals/run.ts --only T01` pass -> full `node evals/run.ts`.

## State
- Eval harness done and validated: baseline 0/18, reference 18/18.
- Commit and push done (per user).
- Model `hermes-local-32k` = qwen3-coder:30b, num_ctx 32768, num_gpu 0 (CPU), temperature 0.15.
- Ollama user env vars: OLLAMA_IGPU_ENABLE=1, FLASH_ATTENTION=1, KV_CACHE_TYPE=q8_0, KEEP_ALIVE=30m.
- JCode `[providers.ollama]` in ~/.jcode/config.toml: type open-ai-compatible, base_url http://localhost:11434/v1, default_model hermes-local-32k.

## The 23:55 probe "PASS" was a false positive
Per ~/.jcode/logs/jcode-2026-09-27.log:
- test.txt was written at 23:55:08 by session_panda. That was a leftover jcode process
  (PID 4948, started 23:54:34) working in the same probe folder, not the probe run.
- The probe run itself (session_crab, 23:55:02) ended "Turn complete - no tool calls".
  Its output was the `<function=write>...</function></tool_call>` block as plain text.
  So temperature 0.15 alone did NOT fix it. The failure is intermittent: some sessions
  (wyvern, panda) did get parsed and executed the write tool.
- Second bug: after each successful write, the next request logs
  "[openrouter] Dropped 1 orphaned tool output(s) during re-ordering". The tool result is
  thrown away, so the model never sees that the write worked and re-emits the call as text.
  Likely cause: a tool_call id mismatch/missing id from Ollama's OpenAI-compatible stream
  (jcode routes the ollama provider through its openrouter/openai-compatible adapter).

## Next steps
1. Before each probe, check that no stray jcode.exe is running (Get-Process jcode), and use
   a new, uniquely named probe folder every time.
2. Run scratch/probe_stream.mjs (%LOCALAPPDATA%\hermes\cache\scratch) 3x. It calls Ollama
   /v1/chat/completions directly with one tool and prints the tool_calls deltas.
   Check: are tool_calls returned structured, with an `id`, every time? Or is the call
   sometimes left in `content`?
3. Depending on the result:
   - Tool calls sometimes land in content -> Ollama's qwen3-coder parser is flaky. Try
     updating Ollama, or the LM Studio provider (`jcode -p lmstudio`) with a qwen3-coder
     GGUF, or llama-server --jinja.
   - Structured but missing or unstable ids -> jcode adapter issue. Check jcode's provider
     options / newer jcode version, or put a tiny local proxy in front of Ollama that adds ids.
4. Compare against the known-good path: `jcode -p lmstudio -m omnicoder-9b run --no-update "Create a file test.txt containing hi"`
5. Probe 3/3 passes -> `--only T01` -> full run.

## Update 2026-09-28 ~00:20
- probe_stream.mjs 3/3: direct Ollama returns structured tool_calls with ids every time, content empty.
  Model and server are fine. The failure is in jcode's path.
- `ollama show hermes-local-32k --parameters` confirms temperature 0.15, num_ctx 32768. No rebuild needed.
- Proxy (evals/tools/ollama-toolcall-proxy.mjs) is PAUSED and kept for diagnostics only. It is not running,
  and ~/.jcode/config.toml base_url is restored to http://localhost:11434/v1.
  Later use: its REQ log shows exactly how jcode's ollama adapter sends tools and tool_call ids.
- evals/tools/probe.sh = one probe (fresh folder, stray-jcode check, verifies test.txt == hi).
- Plan tonight: restart PC -> probe.sh twice (both must pass) -> `node evals/run.ts --only T01` -> full run.
  If either probe fails: fall back to the proxy, or import the 30B into LM Studio and use `--provider lmstudio`.

## jcode rebuild queue (source fixes)
1. Context auto-detect: match `model` and `model:latest` ids, and read num_ctx from Ollama /api/show instead of
   falling back to the hardcoded 4096 (OLLAMA_DEFAULT_SERVING_CONTEXT).
2. Ollama provider: pass tools natively (OpenAI `tools` / structured `tool_calls`) instead of relying on a
   text convention the model has to recite back. Direct Ollama gave structured calls 3/3.
3. If the text convention stays: the parser should accept `<function=...>` blocks with or without the
   wrapping `<tool_call>` tags. Strict tag matching turns a small slip into a total failure (exit 0, no file).
4. (Seen in logs) "[openrouter] Dropped 1 orphaned tool output(s) during re-ordering" after every successful
   write, on both Ollama and LM Studio. The tool result gets thrown away, so the model re-emits the call.

## Update 2026-09-28 (Claude Code session) — corrections + fix
- Queue item 2 was wrong: jcode's ollama provider already sends tools natively (OpenAI `tools`).
  The real failure: after a sentence of preamble, qwen3-coder emits `<function=...>...</function></tool_call>`
  WITHOUT the opening `<tool_call>`. Ollama's qwen3-coder parser needs that tag, so it returns plain text.
  Direct probes passed 3/3 because they had no preamble.
- Queue item 4 is a false alarm: openrouter/request.rs final pass copies each tool output next to its call,
  then counts the original copy as "dropped". Nothing is lost.
- FIX (queue item 3) implemented in ~/jcode/crates/jcode-app-core/src/agent/response_recovery.rs:
  `parse_xml_function_calls` recovers `<function=name><parameter=k>v</parameter></function>` blocks
  with or without `<tool_call>` wrappers, multiple calls, keeps text params as strings. 3 unit tests pass.
  Logs "[agent] Recovered XML text tool call for '<tool>'" in ~/.jcode/logs when it kicks in.
- Build gotcha: `C:\Program Files\Rust stable MSVC 1.98` shadows rustup and has no MSVC linker
  (Git's coreutils link.exe gets picked). Build with:
  `~/.cargo/bin/cargo.exe +stable-x86_64-pc-windows-gnu build --release --target x86_64-pc-windows-gnu --bin jcode`
- Also fixed a Windows-only test compile error in tool/communicate/transport.rs (expect_err needs Debug).
- Previous binary backed up as ~/.local/bin/jcode.exe.bak-pre-xmlfix.

## Stopped 2026-09-28 ~02:55 (restart tomorrow)
- evals/run.ts reverted to the 8710f99 runner and committed (b2fdbfc). The sweeper runner killed live agents; don't reuse it as-is.
- T01 on the reverted runner: PASS (320s, results/2026-09-28-07-26_...).
- Full run 07-32 was stopped on purpose during T04 (T01-T03 transcripts only, no summary). Not a real score, ignore it.
- Before restarting: make sure no other jcode run is active (no probes during an eval), then in PowerShell:
    cd "$HOME\Desktop\agent creator"; node evals/run.ts
- After the eval: move on to roadmap Step 2 (Orchestrator), whatever the score.
2026-09-28 baseline: 10/18 (easy 6/6, medium 4/8, hard 0/4), 421 min, as recorded; 3 of those PASSes (T09, T10, T16) hit the
time limit, so under evals/outcome.ts it reads 7/18 + 3 TIMEOUT (analyze.mjs shows that; the file is not rewritten).
Zero jcode-noise failures - all 8 fails are capability/tooling gaps.
Root-cause clusters: (1) test-import conventions T06/T07, (2) registry
pattern T08, (3) test quality T11, (4) Step-3 work T12/T14, (5) security T15.
API note: orchestrator must expose runTask().
