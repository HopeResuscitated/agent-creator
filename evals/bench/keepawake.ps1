# keepawake.ps1 - ask Windows not to idle-sleep (system + display required) until <Stop> exists.
#   powershell -File keepawake.ps1 -Stop <file>
# Process-scoped (SetThreadExecutionState); released when this process exits. No power setting is changed.
# Best effort only: a power-button / lid / user-initiated sleep still happens, which is why suite.sh also
# runs sleepcheck.ps1 over the run window and refuses the run as evidence if the machine slept.
param([Parameter(Mandatory)][string]$Stop)
Add-Type -Namespace KA -Name Native -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]'0x80000000'; $ES_SYSTEM_REQUIRED = [uint32]1; $ES_DISPLAY_REQUIRED = [uint32]2
$prev = [KA.Native]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED)
"keepawake pid=$PID set=$(if ($prev -ne 0) { 'ok' } else { 'FAILED' })"
while (-not (Test-Path $Stop)) { Start-Sleep -Seconds 5 }
[void][KA.Native]::SetThreadExecutionState($ES_CONTINUOUS)
"keepawake released"
