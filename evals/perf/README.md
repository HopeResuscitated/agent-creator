# Performance records (descriptive; no thresholds)

The project defines no performance PASS criteria. These files exist so that a later GPU run can be compared with the
current CPU baseline on the same definitions (`evals/bench/perfreport.mjs`).

| File | What | Class |
|---|---|---|
| `cpu-baseline-hwprofile.json` | `evals/bench/hwprofile.ps1` on the current machine, 2026-10-04 (model loaded, idle): Ryzen AI 7 PRO 350, 31.2 GiB RAM, Radeon 860M iGPU (Vulkan visible to Ollama, unused: `num_gpu 0`), placement 100% CPU, llama-server buffers (weights 4,258.8 + 13,432.5 MiB repacked, KV 1,632 MiB q8_0, compute 240.1 MiB), runner private 19.29 GiB | measured, hardware-dependent |
| `cpu-baseline-b6-contained.json`, `cpu-baseline-b6-control.json` | `perfreport.mjs` over the authoritative Phase B run b6 (A2 pin, AC; archive `cycle9/b6-phaseB-AC`; T05 + T08) | derived from authoritative evidence |

Compare a future run: `node evals/bench/perfreport.mjs --label gpu --ev <ev-dir> --results <results.json> --hwprofile <new profile> --out gpu.json`,
then `node evals/bench/perfreport.mjs --compare evals/perf/cpu-baseline-b6-contained.json gpu.json`. Only compare runs with
the same task set (b6 = T05 + T08), pins and timeouts. `perfsample.ps1` (CPU %, GPU util/memory) is opt-in; b6 was not
sampled, so CPU/GPU utilization has no baseline value.
