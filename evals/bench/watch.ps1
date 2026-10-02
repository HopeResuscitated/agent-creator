# watch.ps1 — trusted-side watchdog for a benchmark suite. Samples every -IntervalSec until the -Stop file exists.
#
#   powershell -File evals/bench/watch.ps1 -Out <watch.log> -Stop <STOP file> -MeterPid <pid> -OutsideDir <dir>
#              [-IntervalSec 10] [-OllamaPort 11434] [-MeterAddr 127.0.0.2] [-MeterPort 11439] [-AgentImage jcode.exe]
#
# TRIP lines (one per offending connection per sample):
#   ollama-connection-from-non-meter  an established connection to Ollama (127.0.0.1:<OllamaPort>) not owned by the meter
#   meter-connection-from-non-broker  a connection to the meter not owned by the wrapper's broker (powershell running
#                                     run-in-job.ps1); expected for every request in control mode (agent dials directly)
#   agent-nonloopback-connection      the agent or a descendant has a connection whose remote is not 127.0.0.1 / ::1
#   outside-dir-written               the canary directory outside the sandbox is no longer empty
# Heartbeat every 30 samples; final "watch stop" line with totals. Read-only: never kills or changes anything.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Stop,
  [Parameter(Mandatory = $true)][int]$MeterPid,
  [Parameter(Mandatory = $true)][string]$OutsideDir,
  [int]$IntervalSec = 10,
  [int]$OllamaPort = 11434,
  [string]$MeterAddr = '127.0.0.2',
  [int]$MeterPort = 11439,
  [string]$AgentImage = 'jcode.exe'
)
$ErrorActionPreference = 'Continue'
function W($m) { Add-Content -LiteralPath $Out -Value "$(Get-Date -Format s) $m" -Encoding utf8 }
function OneLine($s) { if ($null -eq $s) { return '' } return (($s -replace '[\r\n]+', ' ').Trim()) }
W "watch start meterPid=$MeterPid outside=$OutsideDir"
$samples = 0; $maxAgents = 0; $ollamaConns = 0; $meterConns = 0
while (-not (Test-Path -LiteralPath $Stop)) {
  $samples++
  $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $byPid = @{}; foreach ($p in $procs) { $byPid[[int]$p.ProcessId] = $p }
  $agents = @($procs | Where-Object { $_.Name -ieq $AgentImage })
  if ($agents.Count -gt $maxAgents) { $maxAgents = $agents.Count }
  # agent tree = agent processes and all their descendants
  $tree = @{}; foreach ($a in $agents) { $tree[[int]$a.ProcessId] = $true }
  do { $grew = $false; foreach ($p in $procs) { if (-not $tree.ContainsKey([int]$p.ProcessId) -and $tree.ContainsKey([int]$p.ParentProcessId)) { $tree[[int]$p.ProcessId] = $true; $grew = $true } } } while ($grew)
  $conns = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue)
  foreach ($c in $conns) {
    $owner = [int]$c.OwningProcess; $p = $byPid[$owner]
    $name = if ($p) { $p.Name } else { '?' }; $cmd = if ($p) { OneLine $p.CommandLine } else { '' }
    if ($c.RemotePort -eq $OllamaPort -and $c.RemoteAddress -eq '127.0.0.1') {
      $ollamaConns++
      if ($owner -ne $MeterPid) { W "TRIP ollama-connection-from-non-meter pid=$owner name=$name cmd=$cmd" }
    }
    if ($c.RemotePort -eq $MeterPort -and $c.RemoteAddress -eq $MeterAddr) {
      $meterConns++
      $isBroker = $p -and $p.Name -ieq 'powershell.exe' -and "$($p.CommandLine)" -match 'run-in-job\.ps1'
      if (-not $isBroker) { W "TRIP meter-connection-from-non-broker pid=$owner name=$name cmd=$cmd" }
    }
    if ($tree.ContainsKey($owner) -and $c.RemoteAddress -ne '127.0.0.1' -and $c.RemoteAddress -ne '::1') {
      W "TRIP agent-nonloopback-connection pid=$owner remote=$($c.RemoteAddress):$($c.RemotePort)"
    }
  }
  if ((Test-Path -LiteralPath $OutsideDir) -and @(Get-ChildItem -Force -LiteralPath $OutsideDir -ErrorAction SilentlyContinue).Count -gt 0) {
    W "TRIP outside-dir-written entries=$((@(Get-ChildItem -Force -LiteralPath $OutsideDir | ForEach-Object { $_.Name }) -join ','))"
  }
  if ($samples % 30 -eq 0) { W "heartbeat samples=$samples maxConcurrentJcode=$maxAgents ollamaConnSamples=$ollamaConns meterConnSamples=$meterConns" }
  Start-Sleep -Seconds $IntervalSec
}
W "watch stop samples=$samples maxConcurrentJcode=$maxAgents ollamaConnSamples=$ollamaConns meterConnSamples=$meterConns"
