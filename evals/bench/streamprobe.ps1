# streamprobe.ps1 — run streamprobe.mjs through the real wrapper in both modes, against a running meter.
#   contained: AppContainer + ACL + broker; probe dials the in-container relay 127.0.0.1:<RelayPort> -> pipe -> broker -> meter
#   control  : -UncontainedControl; probe dials the meter directly
# Same staged tools (node.exe), same fresh T05 sandbox per mode, same cases/reps. Output copied out of the sandbox.
#
#   powershell -File evals/bench/streamprobe.ps1 -Out <dir> [-Meter 127.0.0.2:11439] [-Reps 2] [-Cases a,b,c]
param([Parameter(Mandatory = $true)][string]$Out, [string]$Meter = '127.0.0.2:11439', [int]$Reps = 2,
  [string]$Cases = 'A2_malformed_first_verbatim,B_text_then_malformed,C_wellformed')
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null; $Out = (Resolve-Path $Out).Path
$stage = Join-Path $Out 'stage'
if (-not (Test-Path (Join-Path $stage '_agent-tools\node.exe'))) {
  Push-Location $repo; & node evals/run.ts --stage-tools-only $stage 2>&1 | Select-Object -Last 2 | ForEach-Object { "  $_" }; Pop-Location
}
$tools = Join-Path $stage '_agent-tools'
$mHost, $mPort = $Meter.Split(':')
$env:PROBE_CASES = $Cases
foreach ($mode in 'contained', 'control') {
  Push-Location $repo; $prep = & node evals/run.ts --prepare T05 2>$null; Pop-Location
  $sb = (($prep | Select-String '^Sandbox: (.*)$').Matches[0].Groups[1].Value).Trim()
  $dst = "$sb-stream-$mode"; if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Move-Item $sb $dst; $sb = $dst
  Copy-Item (Join-Path $PSScriptRoot 'streamprobe.mjs') $sb
  $h = "$sb.agent-home"; if (Test-Path $h) { Remove-Item -Recurse -Force $h }; New-Item -ItemType Directory -Force $h | Out-Null
  $port = 20000 + (Get-Random -Maximum 20000)
  if ($mode -eq 'contained') {
    $pargs = @('streamprobe.mjs', $mode, '127.0.0.1', "$port", 'probe-out', "$Reps")
    $extra = @('-WritableRoot', $sb, '-JcodeHome', $h, '-ToolsRoot', $tools, '-ModelUpstream', $Meter, '-RelayPort', "$port")
  } else {
    $pargs = @('streamprobe.mjs', $mode, $mHost, $mPort, 'probe-out', "$Reps")
    $extra = @('-UncontainedControl', '-JcodeHome', $h, '-ToolsRoot', $tools)
  }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress $pargs)))
  Push-Location $sb
  $o = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repo 'evals\tools\run-in-job.ps1') -Command (Join-Path $tools 'node.exe') -ArgsB64 $b64 -TimeoutMs 1800000 @extra 2>&1
  Pop-Location
  $od = Join-Path $Out "probe-$mode"; if (Test-Path $od) { Remove-Item -Recurse -Force $od }
  if (Test-Path (Join-Path $sb 'probe-out')) { Copy-Item -Recurse (Join-Path $sb 'probe-out') $od }
  foreach ($f in 'broker.log', 'relay.log') { if (Test-Path (Join-Path $h $f)) { New-Item -ItemType Directory -Force $od | Out-Null; Copy-Item (Join-Path $h $f) $od } }
  ($o | ForEach-Object { "$_" }) | Set-Content -Encoding utf8 (Join-Path $Out "wrapper-$mode.txt")
  "=== $mode sandbox=$sb port=$port"
  ($o | ForEach-Object { "$_" }) | Where-Object { $_ -match '^PROBE|^  tail|agent exit|tree proven dead|acl restore|profile deleted|reduced to|model broker|in-container relay' } | ForEach-Object { "  $_" }
}
