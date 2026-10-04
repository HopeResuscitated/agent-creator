# t01x4.ps1 - DET-1 check: T01 launched 4 ways (PowerShell / git-bash x contained / control) must give ONE identical
# run fingerprint (effective-config: agent config, args, env, jcode sha256, model, model-server pin, tools root).
# The 4 fingerprints are compared with EACH OTHER. -Previous only prints whether they equal an older baseline's
# value (they will NOT after any re-pin: jcode sha256 / model digest are inside the fingerprint); never treat an old
# fingerprint as the new baseline. T01 pass/fail is reported but is not what this checks.
#   powershell -File evals\bench\t01x4.ps1 -JcodeBin <pinned jcode.exe> -Out <dir> [-Previous <run fingerprint>]
# Exit 0 = 4 runs completed, all fingerprints present and identical. Machine on AC, nothing else using jcode/Ollama.
# Launches use Start-Process with file redirection: Windows PowerShell 5.1 turns a native program's stderr (node's
# module-type warning) into a terminating error under `*>` + ErrorActionPreference=Stop.
param([Parameter(Mandatory)][string]$JcodeBin, [Parameter(Mandatory)][string]$Out, [string]$Previous = '',
      [string]$Bash = 'C:\Program Files\Git\bin\bash.exe')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'node.ps1')
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$report = Join-Path $Out 't01x4.txt'
function Say([string]$s) { Write-Output $s; Add-Content -Path $report -Value $s -Encoding ascii }
$runArgs = @('evals/run.ts', '--agent', 'jcode', '--provider', 'ollama', '--model', 'hermes-local-32k', '--model-upstream', '127.0.0.1:11434', '--only', 'T01', '--jcode-bin', $JcodeBin)
$rows = @()
foreach ($shell in 'powershell', 'git-bash') {
  foreach ($mode in 'contained', 'control') {
    $a = $runArgs + $(if ($mode -eq 'control') { @('--no-contain-unsafe') } else { @() })
    $log = Join-Path $Out "T01-$shell-$mode.log"; $err = "$log.stderr"
    if ($shell -eq 'powershell') {
      $argStr = ($a | ForEach-Object { '"' + $_ + '"' }) -join ' '
      $p = Start-Process -FilePath $NodeBin -ArgumentList $argStr -WorkingDirectory $repo -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
    } else {
      $sh = Join-Path $Out "launch-$mode.sh"
      $q = ($a | ForEach-Object { "'" + ($_ -replace "'", "'\''") + "'" }) -join ' '
      Set-Content -Path $sh -Encoding ascii -Value ("cd '{0}' && exec '{1}' {2}" -f ($repo -replace '\\', '/'), ($NodeBin -replace '\\', '/'), $q)
      $p = Start-Process -FilePath $Bash -ArgumentList ('"' + ($sh -replace '\\', '/') + '"') -WorkingDirectory $repo -NoNewWindow -Wait -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
    }
    $rc = $p.ExitCode
    $text = (Get-Content -Raw $log) + "`n" + (Get-Content -Raw $err)
    $fp = if ($text -match 'Effective-config fingerprint: ([0-9a-f]{64})') { $Matches[1] } else { '' }
    $res = if ($text -match '(?m)^T01\b.*?\b(PASS|FAIL|ENV_RESTORE_FAILED|UNSAFE_PROCESS_TREE|SETUP_FAILED|AGENT_STATUS_UNKNOWN)\b') { $Matches[1] } else { '?' }
    $rows += [pscustomobject]@{ shell = $shell; mode = $mode; exit = $rc; fingerprint = $fp; t01 = $res }
    Say ("{0,-10} {1,-9} exit={2} t01={3} fp={4}" -f $shell, $mode, $rc, $res, $fp)
  }
}
$fps = @($rows | ForEach-Object { $_.fingerprint } | Sort-Object -Unique)
$ok = ($rows.Count -eq 4) -and -not (@($rows | ForEach-Object { $_.fingerprint }) -contains '') -and ($fps.Count -eq 1)
if ($Previous) { Say ("previous baseline fingerprint {0}: {1}" -f $Previous, $(if ($fps.Count -eq 1 -and $fps[0] -eq $Previous) { 'EQUAL' } else { 'DIFFERENT (expected after a re-pin)' })) }
Say ("T01X4 {0} distinct_fingerprints={1} {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $fps.Count, ($fps -join ','))
exit $(if ($ok) { 0 } else { 1 })
