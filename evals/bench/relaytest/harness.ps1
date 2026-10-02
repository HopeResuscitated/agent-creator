# End-to-end byte test of a checkout's broker (C# from run-in-job.ps1) + model-relay.mjs, run uncontained as the
# current user (the pipe DACL grants this user GA). Usage: harness.ps1 -Repo <checkout> [-Out <log dir>] [-Size n] [-N n]
# Broker/relay logs go to -Out (default: a fresh directory under %TEMP%), never next to this script.
param([Parameter(Mandatory = $true)][string]$Repo, [string]$Out = '', [int]$Size = 3000000, [int]$N = 12)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ps1 = Join-Path $Repo 'evals\tools\run-in-job.ps1'
$relay = Join-Path $Repo 'evals\tools\model-relay.mjs'

$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile($ps1, [ref]$null, [ref]$errs)
"parse errors: $($errs.Count)"; $errs | ForEach-Object { "  $_" }
$src = Get-Content -Raw -LiteralPath $ps1
$blocks = [regex]::Matches($src, "Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@", 'Singleline')
$evalJob = ($blocks | Where-Object { $_.Groups[1].Value -match 'public static class EvalJob' } | Select-Object -First 1).Groups[1].Value
$broker = ($blocks | Where-Object { $_.Groups[1].Value -match 'public static class ModelBroker' } | Select-Object -First 1).Groups[1].Value
Add-Type -TypeDefinition $evalJob; 'EvalJob compiled'
Add-Type -TypeDefinition $broker; 'ModelBroker compiled'
if ([EvalJob].GetMethod('HasExited')) { 'EvalJob.HasExited present' }

if (-not $Out) { $Out = Join-Path ([IO.Path]::GetTempPath()) "relaytest-$PID" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "broker-$PID.log"; $rlog = Join-Path $Out "relay-$PID.log"
try { [ModelBroker]::Start("relaytest-bad-$PID", 'S-1-15-2-1', '127.0.0.1', 99999, $log); 'port 99999: ACCEPTED at start' } catch { "port 99999: refused at start ($($_.Exception.InnerException.Message))" }

$upPort = 41000 + (Get-Random -Maximum 2000); $relayPort = $upPort + 3000; $pipe = "relaytest-$PID"
$up = Start-Process node -ArgumentList @("`"$(Join-Path $here 'upstream.mjs')`"", $upPort, $Size) -PassThru -WindowStyle Hidden
$rel = $null
try {
  [ModelBroker]::Start($pipe, 'S-1-15-2-1', '127.0.0.1', $upPort, $log)
  $rel = Start-Process node -ArgumentList @("`"$relay`"", $relayPort, $pipe, "`"$rlog`"") -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 50 -and -not ((Test-Path $rlog) -and ((Get-Content -Raw $rlog) -match 'listening')); $i++) { Start-Sleep -Milliseconds 100 }
  Start-Sleep -Milliseconds 300
  & node (Join-Path $here 'client.mjs') $relayPort $Size $N
  [ModelBroker]::Stop()
  Start-Sleep -Milliseconds 500
  'after Stop():'
  & node (Join-Path $here 'client.mjs') $relayPort $Size 3 | Select-Object -Last 1
  Get-Content $log | Select-Object -Last 2
} finally {
  if ($rel) { Stop-Process -Id $rel.Id -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $up.Id -Force -ErrorAction SilentlyContinue
}
