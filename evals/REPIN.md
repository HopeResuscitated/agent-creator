# Re-pin procedure (hardware change -> A3 pin -> C)

Run this top to bottom after the hardware change, before any C run. Every step has a pass condition. A FAIL stops
the procedure: investigate, fix, and restart from step 1. Never skip a step because an earlier pin passed it, and never
treat an old fingerprint or an old timing as the new baseline.

Shell: git-bash in `C:\Users\cierra\Desktop\agent creator`, `source evals/bench/node.sh` first (sets `$NODE_BIN` to
the pinned node 26.7.0 and refuses anything else). Write outputs under a new archive folder, e.g.
`C:/Users/cierra/hermes-bench-archive/repin-<date>/` (called `$R` below). Laptop on AC, nothing else using jcode or
Ollama for the whole procedure (run `evals/bench/attrmon.ps1` alongside steps 11-12 to prove it).

## What changes and what does not

| Item | Before (validated, CPU) | After the re-pin |
|---|---|---|
| jcode | `7ed7403f8` (A2), sha256 `f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3`, `C:\Users\cierra\jcode-evalpin-a2-bin\jcode.exe` | `710560f91` (A3 = A2 + edit-string fix), branch `eval-pin-a3-candidate`, `C:\Users\cierra\jcode-evalpin-a3cand-bin\jcode.exe`, sha256 `42ed4012e129cc36e9d3f3c299b3015fbde5c8cb95cab36ed41f0d526fd0bab7` (v0.88.65-dev) |
| Ollama | 0.34.4 | 0.34.4 (unchanged unless you decide a new version; then it is part of this re-pin) |
| Model | `hermes-local-32k` digest `1ef2c71ed206...` = Qwen3-Coder 30B-A3B Instruct Q4_K_M, **`num_gpu 0` (forced CPU)**, num_ctx 32768, temperature 0.15, top_k 20, top_p 0.8, repeat_penalty 1.05 | same weights and parameters except `num_gpu` (a new digest); the quant may change in step 12 |
| node, harness, eval-baseline-v1 task tree, timeouts | pinned | unchanged |

A3 is **not** part of the validated baseline until steps 4-11 pass. Until then every result was produced by the A2 binary.

## Before the hardware change (manual)
Disable Ollama automatic updates before the next Ollama restart (HANDOFF "Ollama auto-update"); otherwise the staged
0.35.1 installs and step 2 fails.

## Steps

1. **Hardware / OS state.** Record in `$R/env.txt`: CPU, RAM, GPU model + VRAM + driver
   (`nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv` for NVIDIA), Windows build, power source
   (`powershell -Command "(Get-CimInstance Win32_Battery).BatteryStatus"`: 2 = AC), and the Ollama host settings
   (`reg query HKCU\Environment | grep OLLAMA`; currently `OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_FLASH_ATTENTION=1
   OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_KEEP_ALIVE=30m OLLAMA_IGPU_ENABLE=1`). Any change to those settings is recorded here.
   PASS: GPU visible to the OS and the driver; machine on AC.

2. **Ollama version.** `curl -s http://127.0.0.1:11434/api/version` -> `0.34.4`. If it is anything else, the
   auto-updater ran (see HANDOFF "Ollama auto-update"): either reinstall 0.34.4 or decide to re-pin Ollama too and
   set `model_server.ollama_version` in step 6. PASS: version equals what will be pinned.

3. **Model.** The current model forces CPU (`PARAMETER num_gpu 0`), so it cannot be reused as-is on a GPU.
   - Keep the old pin reachable: `ollama cp hermes-local-32k hermes-local-32k-cpu-1ef2c71e`.
   - `ollama show hermes-local-32k --modelfile > $R/Modelfile.cpu`; copy to `$R/Modelfile.gpu`, delete the
     `PARAMETER num_gpu 0` line (Ollama then offloads as many layers as fit), change nothing else.
   - `ollama create hermes-local-32k -f $R/Modelfile.gpu`.
   - `ollama show hermes-local-32k --modelfile > $R/Modelfile.new`; `diff` against `Modelfile.cpu`: the only
     difference may be the removed num_gpu line (FROM must name the same blob, sha256-1194192c...).
   - Record the new digest: `curl -s http://127.0.0.1:11434/api/tags` -> `hermes-local-32k:latest` digest.
   - Load it once and check placement: one tiny request, then `ollama ps` -> PROCESSOR must read `100% GPU`.
     A CPU/GPU split means the model + 32k KV cache did not fit in VRAM: stop and report (that is a hardware result).
   PASS: same weights + parameters, new digest recorded, 100% GPU.

4. **A3 binary.** Use the tested candidate:
   `sha256sum C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe` -> `42ed4012e129cc36...0bab7`,
   `--version` -> `jcode v0.88.65-dev (710560f91)`; `git -C C:/Users/cierra/jcode-evalpin rev-parse eval-pin-a3-candidate`
   -> `710560f91154f5fed6f1ec9a34b9852a471d8b5f`. Only if the file is missing or differs: rebuild from that branch with
   the recipe in PLAN.yaml `pins.jcode_build` (switch the jcode-evalpin checkout to `eval-pin-a3-candidate` for the
   build); the rebuilt binary gets a new sha256 and must also pass the unit tests (same PATH/env as the build:
   `cargo test --release --target x86_64-pc-windows-gnu -p jcode-app-core --lib tool::edit`, 20 passed).
   Then: `"$NODE_BIN" evals/bench/editstring.mjs <A3 jcode.exe> A3 --expect fixed` -> `EDITSTRING PASS`, and the same
   for the A2 binary with `--expect unfixed` (proves the test still distinguishes them).
   PASS: commit + sha256 as above (or a rebuilt sha256 with unit 20/20), both editstring runs PASS.

5. **Record** the A3 commit, branch, binary path and sha256 in `$R/env.txt` and in PLAN.yaml `pins.jcode`.

6. **Update the pins** in `evals/baseline-env.json` (hand edit, keep CRLF): `jcode_sha256` = the A3 sha256;
   `model_server.models.hermes-local-32k` = the step-3 digest; `model_server.ollama_version` only if step 2 decided a
   new version. Nothing else. `git diff --check`, then commit only that file:
   `pin: jcode A3 710560f91 (<sha256 prefix>), hermes-local-32k GPU <digest prefix>`.
   PASS: run.ts now refuses the A2 binary and the old model digest (proved in step 7).

7-10. **All gates**, one command:
   `JCODE_BIN=C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe bash evals/bench/gates.sh --out $R/gates
   --refuse C:/Users/cierra/jcode-evalpin-a2-bin/jcode.exe --refuse C:/Users/cierra/jcode-evalpin-bin/jcode.exe`
   It checks: (7) jcode / Ollama version / model digest match the pin; bare node, unreachable model server, the A2
   binary and the 1fbb2e1b4 binary are each refused (exit 2); (8) contained-child 10/10, security probe 20/20;
   (9) relay byte tests 12/12 + nothing after Stop + out-of-range port refused, contained e2e 9/9 + busy relay port
   -> exit 4; (10) meter kill-abort (`meterabort.mjs`: the killed request is aborted upstream, the next request's
   first byte < 10 s). PASS: last line `GATES PASS`, exit 0.

11. **T01 x4 fingerprints** (DET-1 on the new pin):
   `powershell -File evals\bench\t01x4.ps1 -JcodeBin C:\Users\cierra\jcode-evalpin-a3cand-bin\jcode.exe -Out <$R\t01x4>
   -Previous df1332d786b0ee3b57f58eb6e7eff90a69e366e5998efe8f9d3b6b5319d60e64`
   PASS: `T01X4 PASS distinct_fingerprints=1` and the previous fingerprint reported DIFFERENT (jcode + model digest
   are inside the fingerprint). The new value is written into PLAN.yaml as the new T01 baseline fingerprint.

12. **Quant trial** (PLAN.yaml H_hardware.quant_trial): Q4_K_M vs Q8_0 of the same model, same Modelfile parameters
   (build the Q8_0 variant like step 3, e.g. `hermes-local-32k-q8`; the Q8_0 GGUF is a large download you run).
   For each: `"$NODE_BIN" evals/bench/quanttrial.mjs --model <name> --requests C:/Users/cierra/hermes-bench-archive/cycle7
   --requests .../cycle8 --requests .../cycle9 --reps 2 --out $R/quant/<name>.jsonl` (217 unique real agent requests
   x 2 = 434 samples >= 300). Compare `malformed_rate` (+ Wilson 95% interval), `median_ttfb_s` (cold cache: compare
   between quants only),
   `aggregate_decode_tok_s`; also check `ollama ps` = 100% GPU for each. Pick ONE quant for every C run and write the
   choice + numbers into PLAN.yaml before C. If the pick is not the model pinned in step 6: build it as
   `hermes-local-32k`, then repeat steps 3 (digest), 6, 7-10 and 11 for it.
   PASS: decision recorded with its numbers; the pinned model is the chosen one and has passed 7-11.

13. **Then C**: pre-register C in PLAN.yaml (tasks, reps, order, timeouts, decision rule; timeouts unchanged unless a
   new value is decided from step-12 throughput and written down before the first C run), commit, then run C with
   `reduced.sh`-style suites on AC, with attrmon.ps1 running.
   D is not part of this procedure; its definition is only PROPOSED (HANDOFF "Coverage") until you adopt it.

## Not allowed in this procedure
- raising a task timeout to turn a TIMEOUT into a PASS; editing a grader; special-casing a task
- `--allow-jcode-drift` / `--allow-node-drift` / `--allow-model-server-drift` for evidence (debug only)
- upgrading Ollama implicitly (auto-update) or reusing a pre-re-pin fingerprint as the baseline
