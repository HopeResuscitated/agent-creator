# sleepcheck.ps1 - power integrity of a run window.
#   powershell -File sleepcheck.ps1 -From <ISO time> -To <ISO time>
# 1. Sleep: prints every power transition in the window from the System event log (Kernel-Power 42 sleep,
#    506 enter Modern Standby, 107 resume, 507 exit Modern Standby; Power-Troubleshooter 1) and exits 1 if any.
#    A run that spans a sleep is not evidence: the agent's wall-clock budget, first-token waits and the meter's
#    timings are distorted (seen 2026-10-03: battery-triggered sleep 00:54 -> power-button wake 11:14 in a control run).
# 2. Power source (warning only, exit code unchanged): AC/battery now, and any Kernel-Power 105 'power source
#    change' in the window. On battery Windows may throttle the CPU, so task times and TIMEOUTs are not comparable
#    with AC runs (correctness, containment and fingerprints are unaffected).
param([Parameter(Mandatory)][string]$From, [Parameter(Mandatory)][string]$To)
$f = [datetime]::Parse($From); $t = [datetime]::Parse($To)
$all = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $f; EndTime = $t } -ErrorAction SilentlyContinue)
$sleep = @($all | Where-Object {
    ($_.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $_.Id -in 42, 506, 107, 507) -or
    ($_.ProviderName -eq 'Microsoft-Windows-Power-Troubleshooter' -and $_.Id -eq 1) })
$src = @($all | Where-Object { $_.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $_.Id -eq 105 })
function Line($e, $tag) {
  $msg = (($e.Message -split "`r?`n") | Where-Object { $_.Trim() }) -join ' | '
  "{0} {1} {2} id={3} {4}" -f $tag, $e.TimeCreated.ToString('s'), $e.ProviderName, $e.Id, $msg.Substring(0, [Math]::Min(200, $msg.Length))
}
foreach ($e in ($sleep | Sort-Object TimeCreated)) { Line $e 'SLEEP-EVENT' }
foreach ($e in ($src | Sort-Object TimeCreated)) { Line $e 'POWER-SOURCE-CHANGE' }
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
$now = if (-not $bat) { 'no battery (AC)' } elseif ($bat.BatteryStatus -eq 2) { "AC (battery $($bat.EstimatedChargeRemaining)%)" } else { "BATTERY $($bat.EstimatedChargeRemaining)% (status $($bat.BatteryStatus))" }
"power now: $now"
if ($src.Count -or ($bat -and $bat.BatteryStatus -ne 2)) {
  "POWER WARNING: power source changed $($src.Count) time(s) in the window and/or on battery now: task times and TIMEOUTs may reflect CPU throttling"
}
if ($sleep.Count) { "SLEEP DETECTED: $($sleep.Count) power transition(s) between $From and $To"; exit 1 }
"no sleep between $From and $To"; exit 0
