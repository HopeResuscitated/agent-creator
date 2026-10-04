# watch.ps1 — trusted-side watchdog for a benchmark suite. Samples every -IntervalSec until the -Stop file exists.
#
#   powershell -File evals/bench/watch.ps1 -Out <watch.log> -Stop <STOP file> -MeterPid <pid> -OutsideDir <dir>
#              [-IntervalSec 10] [-OllamaPort 11434] [-MeterAddr 127.0.0.2] [-MeterPort 11439] [-AgentImage jcode.exe]
#
# TRIP lines (one per offending connection per sample):
#   ollama-connection-from-non-meter  an established connection to Ollama (127.0.0.1:<OllamaPort>) not owned by the meter
#   meter-connection-from-non-broker  a connection to the meter not owned by the wrapper's broker (powershell running
#                                     run-in-job.ps1); expected for every request in control mode (agent dials directly)
#   agent-nonloopback-connection      the agent or a descendant has a connection whose remote is not loopback (127.0.0.0/8, ::1);
#                                     root=eval (tree of a jcode with --provider-profile evalbroker) or root=external
#                                     (any other jcode.exe tree, e.g. a manual run: contamination, not the eval agent)
#   outside-dir-written               the canary directory outside the sandbox is no longer empty
#   watch-sample-failed               a sample could not list processes or connections (it would otherwise look clean)
# The Ollama check covers every client of -OllamaPort whatever address it dialed; loopback for the agent check is
# 127.0.0.0/8, ::1 and IPv4-mapped ::ffff:127.0.0.0/104.
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
  $cimErr = $null; $tcpErr = $null
  $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue -ErrorVariable cimErr)
  $byPid = @{}; foreach ($p in $procs) { $byPid[[int]$p.ProcessId] = $p }
  $agents = @($procs | Where-Object { $_.Name -ieq $AgentImage })
  if ($agents.Count -gt $maxAgents) { $maxAgents = $agents.Count }
  # agent tree = agent processes and all their descendants
  # $tree[pid] = 'eval' | 'external': the class of the tree's root jcode (eval = generated evalbroker profile)
  $tree = @{}; foreach ($a in $agents) { $tree[[int]$a.ProcessId] = $(if ("$($a.CommandLine)" -match '--provider-profile evalbroker') { 'eval' } else { 'external' }) }
  do { $grew = $false; foreach ($p in $procs) { if (-not $tree.ContainsKey([int]$p.ProcessId) -and $tree.ContainsKey([int]$p.ParentProcessId)) { $tree[[int]$p.ProcessId] = $tree[[int]$p.ParentProcessId]; $grew = $true } } } while ($grew)
  $conns = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue -ErrorVariable tcpErr)
  # A sample that could not see processes or connections would report nothing: say so (tripclass flags it) rather
  # than look clean. "No matching connections" (ObjectNotFound) is not a failure.
  $realTcpErr = @($tcpErr | Where-Object { "$($_.CategoryInfo.Category)" -ne 'ObjectNotFound' })
  if ($cimErr -or $procs.Count -eq 0 -or $realTcpErr.Count) { $errText = OneLine ("$cimErr $realTcpErr"); W "TRIP watch-sample-failed processes=$($procs.Count) error=$errText" }
  foreach ($c in $conns) {
    $owner = [int]$c.OwningProcess; $p = $byPid[$owner]
    $name = if ($p) { $p.Name } else { '?' }; $cmd = if ($p) { OneLine $p.CommandLine } else { '' }
    # any client of the Ollama port, whatever address it dialed (Ollama listens on 127.0.0.1 today; an OLLAMA_HOST change
    # must not make connections invisible)
    if ($c.RemotePort -eq $OllamaPort) {
      $ollamaConns++
      if ($owner -ne $MeterPid) { W "TRIP ollama-connection-from-non-meter pid=$owner name=$name cmd=$cmd" }
    }
    if ($c.RemotePort -eq $MeterPort -and $c.RemoteAddress -eq $MeterAddr) {
      $meterConns++
      $isBroker = $p -and $p.Name -ieq 'powershell.exe' -and "$($p.CommandLine)" -match 'run-in-job\.ps1'
      if (-not $isBroker) { W "TRIP meter-connection-from-non-broker pid=$owner name=$name cmd=$cmd" }
    }
    $ra = "$($c.RemoteAddress)"
    $isLoop = ($ra -match '^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$') -or $ra -eq '::1' -or ($ra -match '^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$')
    if ($tree.ContainsKey($owner) -and -not $isLoop) {
      W "TRIP agent-nonloopback-connection pid=$owner remote=$($c.RemoteAddress):$($c.RemotePort) name=$name root=$($tree[$owner])"
    }
  }
  if ((Test-Path -LiteralPath $OutsideDir) -and @(Get-ChildItem -Force -LiteralPath $OutsideDir -ErrorAction SilentlyContinue).Count -gt 0) {
    W "TRIP outside-dir-written entries=$((@(Get-ChildItem -Force -LiteralPath $OutsideDir | ForEach-Object { $_.Name }) -join ','))"
  }
  if ($samples % 30 -eq 0) { W "heartbeat samples=$samples maxConcurrentJcode=$maxAgents ollamaConnSamples=$ollamaConns meterConnSamples=$meterConns" }
  Start-Sleep -Seconds $IntervalSec
}
W "watch stop samples=$samples maxConcurrentJcode=$maxAgents ollamaConnSamples=$ollamaConns meterConnSamples=$meterConns"
