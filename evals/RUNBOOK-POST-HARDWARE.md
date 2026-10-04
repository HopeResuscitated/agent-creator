# Post-hardware runbook - OPTIONAL, NOT PLANNED (kept for reference)

> Status 2026-10-04: **not planned.** The project decided that the existing CPU-only machine is the evaluation
> environment (PLAN `H_hardware.target_environment`), and the CPU-target re-pin was executed that way (`REPIN.md`).
> Nothing in this file is a prerequisite for C and it must not be started as if it were. It stays on record because it
> is the only written sequence for the optional case "a dedicated GPU is installed later"; if that ever happens, the
> re-pin is a NEW re-pin for target GPU (repin.mjs `--target GPU`), not a continuation of the CPU one.

Deterministic sequence from "hardware installed" to "C may begin". It does not replace `REPIN.md` (the
specification) or `repin.mjs` (its executable form); it fixes the order, the exact commands, the expected output
and the stop conditions so a new session can execute it without rediscovery. Nothing here has been executed.
Every step: run, compare with EXPECT, and on anything else STOP (do not improvise a workaround; see "Stop / rollback").

Conventions
- Shell: git-bash in `C:\Users\cierra\Desktop\agent creator`. First: `source evals/bench/node.sh` (sets `$NODE_BIN`
  to node 26.7.0, refuses anything else).
- `R=C:/Users/cierra/hermes-bench-archive/repin-$(date +%F)` (new folder; never reuse one from another attempt).
- Laptop on AC for the whole sequence. No manual jcode, no other Ollama client. Optional but recommended:
  `powershell -File evals/bench/attrmon.ps1 ...` alongside steps 10-11 (see REPIN.md).
- Human decisions are marked DECISION. The script never makes them.

## 0. Before powering down for the hardware change (already possible now)
| Do | EXPECT |
|---|---|
| Ollama tray icon > Settings > automatic updates OFF | - |
| `"$NODE_BIN" -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.LOCALAPPDATA+'/Ollama/db.sqlite',{readOnly:true});console.log(d.prepare('select auto_update_enabled a from settings').get().a)"` | `0` (if `1`: the staged 0.35.1 installs on the next restart; step 4 then fails) |
| `curl -s http://127.0.0.1:11434/api/version` | `{"version":"0.34.4"}` |

## 1. Verify machine
Ollama detects GPUs only when its server starts: after the driver install, restart Ollama once now (auto-update must
be OFF: step 0), before stage 1 records the server settings. Do not restart it again until C is over (a restart
after stage 1 needs `--restart` and stage 1 again; cpreflight compares the live settings with the recorded ones).
`"$NODE_BIN" evals/bench/repin.mjs --out $R --dry-run` (read-only overview; expect only stage-3/12 items to WOULD FAIL
until steps 5-12 are done), then:
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 1`
EXPECT: `hwprofile-written`, `on-AC`, `ollama-server-env-recorded` ok; `STAGE 1 PASS`. Writes `$R/hwprofile.json`,
`$R/repin-record.json` (Ollama settings recorded = what C will be held to by cpreflight).

## 2. Verify GPU (OS + driver)
Same stage-1 output: `gpu-visible (discrete: nvidia-smi or ROCm)` ok, detail names the GPU, its memory and driver.
NVIDIA cross-check: `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv`.
STOP if the GPU is absent (stage 1 FAIL): driver problem, not a harness problem.

## 3. Verify driver/runtime as Ollama sees it
`grep 'inference compute' "$LOCALAPPDATA/Ollama/server.log" | tail -2`
EXPECT: a line with `library=CUDA` (NVIDIA) or `library=ROCm` (AMD) naming the new GPU, `total=` its memory.
A `library=Vulkan` iGPU line alone means Ollama does not see the new GPU: STOP.
`"$NODE_BIN" evals/bench/ollamaenv.mjs --expect evals/bench/ollama-server-env.observed.json` lists any setting that
differs from the CPU-era server (GPU-visibility keys may change): differences are recorded by stage 1, not a FAIL;
a change to KV_CACHE_TYPE / FLASH_ATTENTION / NUM_PARALLEL / CONTEXT_LENGTH is a DECISION (AUDIT.md section 12).

## 4. Verify Ollama
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 2`
EXPECT: `running 0.34.4, will pin 0.34.4`, `STAGE 2 PASS`. Anything else: auto-update ran. DECISION: reinstall 0.34.4,
or re-pin Ollama deliberately (`--restart`, then every stage with `--ollama-version <v>`).

## 5. Rebuild/reload the model without the CPU-only restriction (manual, exact)
```
ollama cp hermes-local-32k hermes-local-32k-cpu-1ef2c71e
ollama show hermes-local-32k --modelfile > $R/Modelfile.cpu.manual
grep -v '^PARAMETER num_gpu 0$' $R/Modelfile.cpu.manual > $R/Modelfile.gpu
diff $R/Modelfile.cpu.manual $R/Modelfile.gpu     # EXPECT exactly one removed line: PARAMETER num_gpu 0
ollama create hermes-local-32k -f $R/Modelfile.gpu
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"hermes-local-32k","prompt":"ok","stream":false,"options":{"num_predict":1}}' > /dev/null
ollama ps                                          # EXPECT PROCESSOR 100% GPU
```
(Stage 3 writes `$R/Modelfile.cpu` / `$R/Modelfile.new` itself; the `.manual` name avoids its leftover-output refusal.)
A CPU/GPU split = model + 32k cache do not fit: STOP, that is a hardware result (report it; do not change num_ctx).

## 6. Record the new model digest
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 3`
EXPECT ok: `cpu-model-kept` (digest 1ef2c71e...), `new-digest` (not 1ef2c71e), `modelfile-only-num_gpu-removed`,
`quant-unchanged` (Q4_K_M), `placement-100-gpu`; `STAGE 3 PASS`. The digest is in the record (stage 3 data).
Fill the future column of the hardware report now (model loaded):
`powershell -NoProfile -ExecutionPolicy Bypass -File evals/bench/hwprofile.ps1 -Out $R/hwprofile-gpu-loaded.json`

## 7. A3 re-pin
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 4` (~5 min: sha256 42ed4012..., version 710560f91, editstring A3
fixed / A2 unfixed, a3offline 18 scenarios, ~/.jcode unchanged) -> `STAGE 4 PASS`.
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 5-6 --apply` -> commits ONLY `evals/baseline-env.json`
(`pin: jcode A3 710560f91 (...), hermes-local-32k GPU <digest>`) -> `STAGE 5-6 PASS`.
From here run.ts refuses the A2 binary and the CPU model. A3 is PINNED but NOT YET AUTHORITATIVE: PLAN.yaml still says
candidate until step 10 passes (cpreflight checks PLAN).

## 8. All mandatory gates  +  9. Security / containment
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 7-10` (runs `gates.sh` with the A3 binary, refusing A2 and the
1fbb2e1b4 binary): pin gates and refusals (exit 2 each), contained-child 10/10, security probe 20/20, relay byte tests
12/12, contained e2e 9/9 + busy relay port -> exit 4, meter kill-abort. EXPECT last line `GATES PASS`, `STAGE 7-10 PASS`.
Steps 8 and 9 are this one stage; there is no separate security command.

## 10. T01 x4 fingerprint test
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 11`
EXPECT `T01X4 PASS distinct_fingerprints=1 <64 hex>` and `previous baseline fingerprint df1332d7...: DIFFERENT`.
Then edit PLAN.yaml (DECISION recorded by you, mechanical content):
- `pins.t01_fingerprint: "<new 64-hex> (A3 pin, re-pin <date>, $R/t01x4)"` (cpreflight requires the exact value)
- `pins.jcode` = A3 commit/branch/binary/sha256 (REPIN step 5)
- `phases.A3_edit_string_args.status`: A3 promotion is a DECISION; only after stages 4-11 PASS (the value must no
  longer contain "NOT YET AUTHORITATIVE" for cpreflight)
Commit PLAN.yaml alone.

## 11. Quant trial
For each quant (Q4_K_M = the pinned model; Q8_0 = a large download you run, built like step 5 as
`hermes-local-32k-q8` with the same parameters):
`"$NODE_BIN" evals/bench/quanttrial.mjs --model <name> --requests C:/Users/cierra/hermes-bench-archive/cycle7 --requests C:/Users/cierra/hermes-bench-archive/cycle8 --requests C:/Users/cierra/hermes-bench-archive/cycle9 --reps 2 --out $R/quant/<name>.jsonl`
EXPECT 434 samples per quant; `ollama ps` 100% GPU for each. Compare `malformed_rate` (+ Wilson 95%), `median_ttfb_s`,
`aggregate_decode_tok_s`. No threshold exists: the choice is a DECISION.

## 12. Record the selected quant
PLAN.yaml `phases.H_hardware.quant_decision: { quant: <quantization_level>, numbers: {...} }`, and
`phases.H_hardware.status` no longer BLOCKED; commit. Then
`"$NODE_BIN" evals/bench/repin.mjs --out $R --stage 12`
EXPECT `quant-decision-recorded`, `pinned-model-is-chosen-quant`, `live-digest-is-pinned`, `stage3-quant-is-chosen`
ok; `STAGE 12 PASS`.
If the decision is NOT the pinned model's quant: build it as `hermes-local-32k` (step 5 with the other GGUF), then
`repin.mjs --out $R --restart` (archives this attempt under `$R/attempt-<ts>/`) and run stages 1-12 again, every one
with `--quant <quantization_level>` (stage 5-6 commits the new digest; T01x4 gives a new fingerprint: redo step 10's
PLAN edit).

## 13. C preflight (first pass: shows what is left)
`"$NODE_BIN" evals/bench/cpreflight.mjs --repin $R --warm`
EXPECT at this point exactly: `plan-c-preregistered` (and `repin-quant-consistent` while the pre-registration has no
quant). Any other BLOCKED line: fix that item first (it names the cause).

## 14. Pre-register C
PLAN.yaml `phases.C_rebaseline.preregistration` with all of: `tasks` (T13 T14 T17 T04 T05 T03 T08 T01), `reps` (3 per
mode), `order` (alternating contained/control), `timeouts` (unchanged unless a new value is decided now, from step-11
throughput, and written here), `decision_rule`, `quant` (= step 12). DECISION. Commit PLAN.yaml alone. Then:
`"$NODE_BIN" evals/bench/cpreflight.mjs --repin $R --warm` -> EXPECT last line `READY FOR C`, exit 0.

## 15. Begin C
DECISION (yours). Only after READY FOR C on the same machine state (no Ollama restart, no pin change since).
C uses `reduced.sh`-style suites on AC with attrmon.ps1 running, per the pre-registration. D is not part of this
runbook (PROPOSED only).

## Stop / rollback
- Any stage FAIL: the record locks. Investigate, fix, `repin.mjs --out $R --restart` (archives record + outputs),
  begin at step 1 (REPIN.md: never skip a stage).
- A FAIL after stage 5-6 leaves A3 + the GPU digest pinned in `baseline-env.json` (committed). PLAN.yaml still says
  A3 is a candidate and cpreflight stays BLOCKED, so nothing can treat it as authoritative. To return to the A2/CPU
  baseline: `git revert <stage 5-6 data.pin_commit>`, `ollama cp hermes-local-32k-cpu-1ef2c71e hermes-local-32k`,
  then check `/api/tags` shows digest `1ef2c71e...` and `bash evals/bench/gates.sh` passes on A2.
- Never: raise a timeout to turn a TIMEOUT into a PASS, edit a grader, use `--allow-*-drift` for evidence, reuse a
  pre-re-pin fingerprint, or let Ollama auto-update.
