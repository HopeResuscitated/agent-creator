# hwprofile.ps1 - read-only hardware/runtime profile for the CPU-vs-GPU comparison (REPIN.md step 1).
#   powershell -NoProfile -ExecutionPolicy Bypass -File evals\bench\hwprofile.ps1 -Out <profile.json>
# Records what is available; anything not present on this machine is recorded as null with a reason, never guessed:
#   os, cpu, ram, storage, power, video controllers (WMI), nvidia-smi (if installed), rocm-smi / hipInfo presence,
#   Ollama version, Ollama's own "inference compute" devices (server.log), the loaded model's placement (/api/ps:
#   size vs size_vram), llama-server buffer sizes from the newest model load (server.log), the llama-server process
#   memory, and Memory Compression (paging pressure). Makes no change; loads no model; sends no request that
#   generates tokens (only GET /api/version and GET /api/ps).
# Exit 0 = profile written (fields may be null); 2 = could not write the output.
param([Parameter(Mandatory = $true)][string]$Out, [string]$OllamaApi = 'http://127.0.0.1:11434')
$ErrorActionPreference = 'Stop'
function Try-Get([scriptblock]$b, [string]$why = 'unavailable') { try { $v = & $b; if ($null -eq $v) { return [ordered]@{ value = $null; reason = $why } } if ($v -is [array]) { return ,$v } return $v } catch { return [ordered]@{ value = $null; reason = "$why : $($_.Exception.Message)" } } }
function GiB($b) { if ($null -eq $b) { return $null } [Math]::Round([double]$b / 1GB, 2) }

$p = [ordered]@{ schema = 'hwprofile/1'; taken = (Get-Date).ToString('s'); host = $env:COMPUTERNAME }
$p.os = Try-Get { $o = Get-CimInstance Win32_OperatingSystem; [ordered]@{ caption = $o.Caption; version = $o.Version; build = $o.BuildNumber } }
$p.cpu = Try-Get { ,@(Get-CimInstance Win32_Processor | ForEach-Object { [ordered]@{ name = $_.Name.Trim(); cores = $_.NumberOfCores; threads = $_.NumberOfLogicalProcessors; max_mhz = $_.MaxClockSpeed } }) }
$p.ram = Try-Get { $cs = Get-CimInstance Win32_ComputerSystem; $os = Get-CimInstance Win32_OperatingSystem
  [ordered]@{ total_gib = GiB $cs.TotalPhysicalMemory; free_gib = GiB ($os.FreePhysicalMemory * 1KB); commit_limit_gib = GiB ($os.TotalVirtualMemorySize * 1KB) } }
$p.storage = Try-Get { [ordered]@{
  disks = @(Get-PhysicalDisk | ForEach-Object { [ordered]@{ name = $_.FriendlyName; media = "$($_.MediaType)"; bus = "$($_.BusType)"; size_gib = GiB $_.Size } })
  c_free_gib = GiB (Get-PSDrive C).Free
  ollama_models_dir = $(if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $env:USERPROFILE '.ollama\models' }) } }
$p.power = Try-Get { $b = @(Get-CimInstance Win32_Battery)
  if (-not $b.Count) { [ordered]@{ source = 'no battery (desktop)'; battery_status = $null } }
  else { [ordered]@{ source = $(if ($b[0].BatteryStatus -eq 2) { 'AC' } else { "battery (BatteryStatus=$($b[0].BatteryStatus))" }); battery_status = $b[0].BatteryStatus; charge_pct = $b[0].EstimatedChargeRemaining } } }
# Win32_VideoController.AdapterRAM is a 32-bit field (caps at 4 GiB): recorded as reported, labelled unreliable
$p.video_controllers = Try-Get { ,@(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ name = $_.Name; driver_version = $_.DriverVersion; driver_date = "$($_.DriverDate)"; adapter_ram_gib_wmi_unreliable = GiB $_.AdapterRAM } }) }
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
$p.nvidia = if ($smi) { Try-Get {
    $rows = & $smi.Source --query-gpu=name,memory.total,memory.used,driver_version,utilization.gpu,power.limit --format=csv,noheader,nounits
    $head = (& $smi.Source) -join "`n"; $cuda = if ($head -match 'CUDA Version:\s*([\d.]+)') { $Matches[1] } else { $null }
    [ordered]@{ path = $smi.Source; cuda_driver_api = $cuda; gpus = @($rows | ForEach-Object { $f = $_ -split ',\s*'; [ordered]@{ name = $f[0]; memory_total_mib = [int]$f[1]; memory_used_mib = [int]$f[2]; driver = $f[3]; util_pct = $f[4]; power_limit_w = $f[5] } }) } } }
  else { [ordered]@{ value = $null; reason = 'nvidia-smi not on PATH' } }
$p.rocm = [ordered]@{ rocm_smi = [bool](Get-Command rocm-smi -ErrorAction SilentlyContinue); hipinfo = [bool](Get-Command hipInfo -ErrorAction SilentlyContinue); hip_path = $env:HIP_PATH }
$p.ollama = Try-Get {
  $ver = (Invoke-RestMethod -Uri "$OllamaApi/api/version" -TimeoutSec 10).version
  $ps = Invoke-RestMethod -Uri "$OllamaApi/api/ps" -TimeoutSec 10
  $log = Join-Path $env:LOCALAPPDATA 'Ollama\server.log'
  $lines = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 20000 } else { @() }
  # startup lines (server config, inference compute) are at the top of server.log, not in the tail
  $compute = @($(if (Test-Path -LiteralPath $log) { Select-String -LiteralPath $log -Pattern 'msg="inference compute"' | ForEach-Object { $_.Line } }) | Select-Object -Last 4 | ForEach-Object { ($_ -replace '^time=\S+ level=\S+ source=\S+ ', '').Trim() })
  # buffer sizes of the newest model load (llama.cpp prints these lines at each load)
  $lastLoad = -1; for ($i = $lines.Count - 1; $i -ge 0; $i--) { if ($lines[$i] -match 'load_tensors:') { $lastLoad = $i; break } }
  $buffers = @(); if ($lastLoad -ge 0) { $buffers = @($lines[[Math]::Max(0, $lastLoad - 40)..([Math]::Min($lines.Count - 1, $lastLoad + 80))] | Where-Object { $_ -match 'buffer size|llama_kv_cache: size|offloaded \d+/\d+ layers' } | ForEach-Object { $_.Trim() } | Select-Object -Unique) }
  [ordered]@{ version = $ver
    loaded = @($ps.models | ForEach-Object { [ordered]@{ name = $_.name; digest = $_.digest; quant = $_.details.quantization_level; context_length = $_.context_length; size_bytes = $_.size; size_vram_bytes = $_.size_vram
      placement = $(if (-not $_.size) { $null } elseif ($_.size_vram -eq 0) { '100% CPU' } elseif ($_.size_vram -ge $_.size) { '100% GPU' } else { '{0}% GPU / {1}% CPU' -f [Math]::Round(100 * $_.size_vram / $_.size), (100 - [Math]::Round(100 * $_.size_vram / $_.size)) }) } })
    inference_compute = $compute; newest_load_buffers = $buffers } }
$p.runner_memory = Try-Get { ,@(Get-Process -Name llama-server, ollama_llama_server -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ pid = $_.Id; name = $_.ProcessName; private_gib = GiB $_.PrivateMemorySize64; working_set_gib = GiB $_.WorkingSet64; peak_working_set_gib = GiB $_.PeakWorkingSet64 } }) } 'no runner process (model not loaded)'
$p.memory_compression = Try-Get { $m = Get-Process -Name 'Memory Compression' -ErrorAction SilentlyContinue; if ($m) { [ordered]@{ working_set_gib = GiB $m.WorkingSet64; peak_working_set_gib = GiB $m.PeakWorkingSet64 } } }
try { $p | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Out -Encoding utf8; Write-Output "HWPROFILE written $Out" } catch { Write-Output "HWPROFILE could not write $Out : $($_.Exception.Message)"; exit 2 }
