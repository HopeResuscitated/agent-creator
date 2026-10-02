# secprobe.ps1 — Part 1 containment regression probe (20 checks). Runs secprobe.mjs with the PATCHED staged node
# contained through the real wrapper (AppContainer + Job + ACL + env allow-list + broker to the model upstream),
# plus trusted-side before/after checks: sandbox/home/tools ACLs restored, container profile deleted, orphan
# grandchild killed, ~/.jcode untouched, outside canary dir empty, repo fingerprint unchanged.
#
#   powershell -File evals/bench/secprobe.ps1 -Out <dir> [-ModelUpstream 127.0.0.1:11434]
#
# Tools are staged fresh into <Out>\stage via run.ts --stage-tools-only. Exit 0 only when all checks pass.
param([Parameter(Mandatory = $true)][string]$Out, [string]$ModelUpstream = '127.0.0.1:11434')
$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null; $Out = (Resolve-Path $Out).Path
$stage = Join-Path $Out 'stage'
if (-not (Test-Path (Join-Path $stage '_agent-tools\node.exe'))) {
  Push-Location $repo; & node evals/run.ts --stage-tools-only $stage 2>&1 | Select-Object -Last 2 | ForEach-Object { "  $_" }; Pop-Location
}
$tools = Join-Path $stage '_agent-tools'
$root = Join-Path $Out 'sec'; if (Test-Path $root) { Remove-Item -Recurse -Force $root }
$sb = Join-Path $root 'sb'; $h = Join-Path $root 'sb.agent-home'; $outside = Join-Path $root 'outside'
New-Item -ItemType Directory -Force -Path $sb, $h, $outside | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'secprobe.mjs') $sb
# a config.toml like run.ts writes, so the probe can find the relay port
$port = 20000 + (Get-Random -Maximum 20000)
Set-Content -Path (Join-Path $h 'config.toml') -Value "[providers.evalbroker]`nbase_url = `"http://127.0.0.1:$port/v1`"`n" -Encoding UTF8
$userJcode = Join-Path $env:USERPROFILE '.jcode'
function Acl($p) { (Get-Acl -LiteralPath $p).Sddl }
function Aces($sddl) { ([regex]::Matches($sddl, '\([^)]*\)') | ForEach-Object { $_.Value } | Sort-Object) -join '' }
function Fp($d) { $s = [Security.Cryptography.SHA256]::Create(); $b = [Text.Encoding]::UTF8.GetBytes((Get-ChildItem -LiteralPath $d -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|\.turbo)\\' } | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n"); ([BitConverter]::ToString($s.ComputeHash($b)) -replace '-', '').Substring(0, 16) }
$before = @{ sb = Acl $sb; home = Acl $h; tools = Acl $tools; jcode = Fp $userJcode; repo = Fp $repo
  profiles = @(Get-ChildItem 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Mappings' -ErrorAction SilentlyContinue).Count }
# probe args: mode, outside canary dir, the user's real profile dir and the repo (both must be unreachable)
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress @('secprobe.mjs', 'contained', $outside, $env:USERPROFILE, $repo))))
Push-Location $repo
$o = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File 'evals\tools\run-in-job.ps1' -Command (Join-Path $tools 'node.exe') -ArgsB64 $b64 -TimeoutMs 180000 `
  -WritableRoot $sb -JcodeHome $h -ToolsRoot $tools -ModelUpstream $ModelUpstream -RelayPort $port 2>&1
$wrapRc = $LASTEXITCODE
Pop-Location
$o | ForEach-Object { "$_" } | Where-Object { $_ -match '^CHK|agent exit|members-left|sanitiz|broker|acl restore|ACE SET|profile|refus' } | ForEach-Object { "  $_" }
Start-Sleep -Seconds 2
$r = Get-Content (Join-Path $sb 'secprobe-contained.json') -Raw | ConvertFrom-Json
$orphan = Get-Process -Id $r.checks.orphan_pid -ErrorAction SilentlyContinue
$after = @{ sb = Acl $sb; home = Acl $h; tools = Acl $tools; jcode = Fp $userJcode; repo = Fp $repo
  profiles = @(Get-ChildItem 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Mappings' -ErrorAction SilentlyContinue).Count }
$ok = [ordered]@{
  'fs: write inside allowed'            = $r.checks.write_inside -eq 'ALLOWED'
  'fs: absolute outside denied'         = $r.checks.write_outside_abs -like 'DENIED*'
  'fs: traversal denied'                = $r.checks.write_traversal -like 'DENIED*'
  'fs: ~/.jcode unreadable'             = $r.checks.read_user_jcode -like 'DENIED*'
  'fs: ~/.ssh unreadable'               = $r.checks.read_user_ssh -like 'DENIED*'
  'fs: repo write denied'               = $r.checks.write_repo -like 'DENIED*'
  'fs: outside dir empty'               = @(Get-ChildItem -Force $outside).Count -eq 0
  'net: direct Ollama denied'           = $r.checks.tcp_ollama_direct -ne 'CONNECTED'
  'net: internet denied'                = $r.checks.'tcp_internet_1.1.1.1' -ne 'CONNECTED'
  'broker: relay reaches model'         = $r.checks.relay_models -like 'HTTP200*'
  'env: no secret-like names'           = @($r.checks.env_secretish_names).Count -eq 0
  'proc: outside processes invisible'   = $r.checks.see_explorer_pid -like 'none*'
  'proc: orphan grandchild killed'      = $null -eq $orphan
  'cleanup: wrapper exit 0'             = $wrapRc -eq 0
  'cleanup: container profile deleted'  = $after.profiles -eq $before.profiles
  'acl: sandbox ACE set restored'       = (Aces $after.sb) -eq (Aces $before.sb)
  'acl: agent home ACE set restored'    = (Aces $after.home) -eq (Aces $before.home)
  # ACE sets, like the two above: icacls sets SE_DACL_AUTO_INHERITED (D:AI) on a directory's first grant, so a
  # freshly staged tools root differs from its original in that control bit only.
  'acl: tools root ACE set restored'    = (Aces $after.tools) -eq (Aces $before.tools)
  'cred: ~/.jcode unchanged'            = $after.jcode -eq $before.jcode
  'fs: repo fingerprint unchanged'      = $after.repo -eq $before.repo
}
$ok.GetEnumerator() | ForEach-Object { "{0} {1}" -f ($(if ($_.Value) { 'PASS' } else { 'FAIL' })), $_.Key }
"sandbox sddl before=$($before.sb)"; "sandbox sddl after =$($after.sb)"; "home sddl before=$($before.home)"; "home sddl after =$($after.home)"
"tools sddl identical-to-original=$($after.tools -eq $before.tools)"
"env_count=$($r.checks.env_count) userprofile=$($r.checks.userprofile) tasklist=$($r.checks.tasklist)"
$fails = @($ok.Values | Where-Object { -not $_ }).Count
"RESULT $fails failures of $($ok.Count) ($($ok.Count - $fails)/$($ok.Count) PASS)"
exit ([int]($fails -ne 0))
