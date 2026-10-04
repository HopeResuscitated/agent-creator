# perfsample.ps1 - OPT-IN resource sampler for performance runs (not started by suite.sh; sampling costs CPU, so
# never run it alongside a CPU-baseline timing comparison unless the baseline was sampled the same way).
#   powershell -NoProfile -ExecutionPolicy Bypass -File evals\bench\perfsample.ps1 -Out <samples.csv> -Stop <STOP file> [-IntervalSec 5]
# CSV columns: time,cpu_pct,gpu_util_pct,gpu_mem_used_mib,gpu_mem_total_mib  (GPU columns empty without nvidia-smi;
# multi-GPU: first GPU). Stops when the STOP file exists. Read by perfreport.mjs --samples.
param([Parameter(Mandatory = $true)][string]$Out, [Parameter(Mandatory = $true)][string]$Stop, [int]$IntervalSec = 5)
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
Set-Content -LiteralPath $Out -Value 'time,cpu_pct,gpu_util_pct,gpu_mem_used_mib,gpu_mem_total_mib' -Encoding ascii
while (-not (Test-Path -LiteralPath $Stop)) {
  $cpu = try { [Math]::Round((Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue, 1) } catch { '' }
  $gu = ''; $gm = ''; $gt = ''
  if ($smi) { try { $f = ((& $smi.Source --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits) | Select-Object -First 1) -split ',\s*'; $gu = $f[0]; $gm = $f[1]; $gt = $f[2] } catch { } }
  Add-Content -LiteralPath $Out -Value ('{0},{1},{2},{3},{4}' -f (Get-Date).ToString('s'), $cpu, $gu, $gm, $gt) -Encoding ascii
  Start-Sleep -Seconds ([Math]::Max(0, $IntervalSec - 1))
}
