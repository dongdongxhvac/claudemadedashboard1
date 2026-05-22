# Register the COVE PM12 poller as a Windows Scheduled Task.
# Pattern mirrors install_labor_poller_task.ps1 exactly — same hourly window,
# same recovery settings — just a different script and task name.
#
# Run in elevated PowerShell:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> powershell.exe -ExecutionPolicy Bypass -File ".\install_pm12_poller_task.ps1"

$ErrorActionPreference = 'Stop'

$TaskName    = 'COVE-PM12-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'pm12_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_pm12_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\pm12_poller.log'

if (-not (Test-Path $PythonExe)) { throw "Python venv not found: $PythonExe" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath)) { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# 6 fires/day, every 2 hours across the workday. Tightened from the original
# 3/day after the Phase 5.5 schema split: pm_rows now stores only OPEN tasks
# (~435 rows/snap, was ~1,850), and pm_close_events captures completions via
# Cove's completedOn between fires. So 2x more snapshots still nets ~50%
# fewer pm_rows/day than the old 3-fire pipeline, and close events bucket
# cleanly into 2-hour intervals for intra-day reporting.
$Triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 8:00AM),
  (New-ScheduledTaskTrigger -Daily -At 10:00AM),
  (New-ScheduledTaskTrigger -Daily -At 12:00PM),
  (New-ScheduledTaskTrigger -Daily -At 2:00PM),
  (New-ScheduledTaskTrigger -Daily -At 4:00PM),
  (New-ScheduledTaskTrigger -Daily -At 6:00PM)
)

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)

$Principal = New-ScheduledTaskPrincipal `
  -UserId    $env:USERNAME `
  -LogonType S4U `
  -RunLevel  Limited

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Removing existing task '$TaskName'..."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName    $TaskName `
  -Description 'Cove PM12 poller (8 AM, 10 AM, 12 PM, 2 PM, 4 PM, 6 PM, Mon-Sat). Phase 5.5.' `
  -Action      $Action `
  -Trigger     $Triggers `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : 8 AM, 10 AM, 12 PM, 2 PM, 4 PM, 6 PM, Mon-Sat (script skips Sundays)"
Write-Host ''
Write-Host "Test now:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail log:"
Write-Host "  Get-Content '$LogPath' -Tail 20 -Wait"
