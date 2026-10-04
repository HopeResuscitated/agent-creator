# attrmon.ps1 - attribution monitor for exclusive benchmark windows. Samples every -Interval seconds until -StopFile
# exists (or once with -Once). Per sample, one line per relevant process:
#   jcode  <pid> <class> start=<t> ppid=<p> <cmd>  class = eval (cmdline has --provider-profile evalbroker) | EXTERNAL
#   ollama <pid> <class> <name> lport=<p> <cmd>    owner of an ESTABLISHED client connection to 127.0.0.1:11434;
#                                                  class = eval-meter | eval-warmup (suite.sh's 1-token curl) | eval-probe | EXTERNAL
# Anything EXTERNAL also gets an "EXTERNAL-ACTIVITY ..." line: a run whose window contains one is CONTAMINATED.
# Sampling can miss processes that live less than one interval (e.g. the warm-up curl); watch.ps1's TRIP lines cover those.
#   powershell -File attrmon.ps1 -Log <file> -StopFile <file> [-Interval 20] [-Once]
param([Parameter(Mandatory)][string]$Log, [string]$StopFile = '', [int]$Interval = 20, [switch]$Once)
function W($s) { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format s), $s) }
W "monitor start pid=$PID"
while ($Once -or -not (Test-Path $StopFile)) {
  $procs = @{}; Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
  foreach ($p in $procs.Values | Where-Object { $_.Name -eq 'jcode.exe' }) {
    $cmd = ("$($p.CommandLine)" -replace '\s+', ' '); $cmd = $cmd.Substring(0, [Math]::Min(200, $cmd.Length))
    $cls = if ($cmd -match '--provider-profile evalbroker') { 'eval' } else { 'EXTERNAL' }
    W ("jcode {0} {1} start={2} ppid={3} {4}" -f $p.ProcessId, $cls, $p.CreationDate.ToString('s'), $p.ParentProcessId, $cmd)
    if ($cls -eq 'EXTERNAL') { W ("EXTERNAL-ACTIVITY jcode pid={0} {1}" -f $p.ProcessId, $cmd) }
  }
  $conns = Get-NetTCPConnection -State Established -RemotePort 11434 -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -eq '127.0.0.1' }
  foreach ($c in $conns) {
    $p = $procs[[int]$c.OwningProcess]; $cmd = if ($p) { ("$($p.CommandLine)" -replace '\s+', ' ') } else { '(gone)' }
    $cmd = $cmd.Substring(0, [Math]::Min(200, $cmd.Length)); $name = if ($p) { $p.Name } else { '?' }
    $cls = if ($cmd -match 'meter\.mjs') { 'eval-meter' } elseif ($cmd -match 'curl\.exe .*/api/generate .*num_predict') { 'eval-warmup' } elseif ($cmd -match 'streamprobe') { 'eval-probe' } else { 'EXTERNAL' }
    W ("ollama {0} {1} {2} lport={3} {4}" -f $c.OwningProcess, $cls, $name, $c.LocalPort, $cmd)
    if ($cls -eq 'EXTERNAL') { W ("EXTERNAL-ACTIVITY ollama-client pid={0} {1} {2}" -f $c.OwningProcess, $name, $cmd) }
  }
  if ($Once) { break }
  Start-Sleep -Seconds $Interval
}
W "monitor stop"
