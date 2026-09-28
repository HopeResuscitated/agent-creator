# Kill processes left behind by an agent run. Used by evals/run.ts and evals/tools/probe.sh.
# A process is killed (whole tree, taskkill /T /F) if ANY of these match, and it is not this script or its callers:
#   -Path     its CommandLine contains this folder (slash- and case-insensitive)
#   -RootPid  it descends from this PID (Windows keeps ParentProcessId after the parent exits, so orphans still match)
#   -Name     its image name matches (e.g. jcode.exe) - only with -SinceUtc, so older unrelated processes are safe
# -SinceUtc (ISO 8601) limits -RootPid and -Name matches to processes created at/after that time (guards against PID reuse).
# Prints one line per killed process, then "swept N". Exit code 0.
param([string]$Path = '', [int]$RootPid = 0, [string]$Name = '', [string]$SinceUtc = '')

$ErrorActionPreference = 'SilentlyContinue'
$since = if ($SinceUtc) { [datetime]::Parse($SinceUtc).ToUniversalTime().AddSeconds(-2) } else { [datetime]::MinValue }
$all = @(Get-CimInstance Win32_Process)
$byPid = @{}; foreach ($p in $all) { $byPid[[int]$p.ProcessId] = $p }

# Never kill ourselves or the chain that launched us (node/bash command lines may contain the path).
$protect = @{}; $cur = [int]$PID
while ($cur -and $byPid.ContainsKey($cur) -and -not $protect.ContainsKey($cur)) { $protect[$cur] = 1; $cur = [int]$byPid[$cur].ParentProcessId }

$norm = { param($s) if ($s) { $s.Replace('/', '\').TrimEnd('\').ToLowerInvariant() } else { '' } }
$needle = & $norm $Path
$recent = { param($p) $p.CreationDate -and $p.CreationDate.ToUniversalTime() -ge $since }

$targets = @{}
foreach ($p in $all) {
  $id = [int]$p.ProcessId
  if ($protect.ContainsKey($id)) { continue }
  if ($needle -and (& $norm $p.CommandLine).Contains($needle)) { $targets[$id] = 'path' }
  elseif ($Name -and $SinceUtc -and $p.Name -ieq $Name -and (& $recent $p)) { $targets[$id] = 'name' }
}
if ($RootPid) {
  $queue = New-Object System.Collections.Queue; $queue.Enqueue($RootPid); $seen = @{}
  while ($queue.Count) {
    $parent = [int]$queue.Dequeue(); if ($seen.ContainsKey($parent)) { continue }; $seen[$parent] = 1
    foreach ($c in $all) {
      if ([int]$c.ParentProcessId -eq $parent -and [int]$c.ProcessId -ne $parent -and (& $recent $c) -and -not $protect.ContainsKey([int]$c.ProcessId)) {
        $targets[[int]$c.ProcessId] = 'child'; $queue.Enqueue([int]$c.ProcessId)
      }
    }
  }
  if ($byPid.ContainsKey($RootPid) -and -not $protect.ContainsKey($RootPid)) { $targets[$RootPid] = 'root' }
}

$n = 0
foreach ($id in $targets.Keys) {
  $p = $byPid[$id]
  & taskkill.exe /T /F /PID $id *> $null
  if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { $n++; Write-Output ("killed {0} {1} ({2})" -f $id, $p.Name, $targets[$id]) }
  else { Write-Output ("FAILED to kill {0} {1}" -f $id, $p.Name) }
}
Write-Output "swept $n"
exit 0
