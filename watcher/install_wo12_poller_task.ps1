# Register the COVE WO12 poller as a Windows Scheduled Task.
# Hourly 7 AM - 7 PM ET, Mon-Sat (script gates Sundays in Python).
# Reconciled 2026-05-21 to match the actual registered cadence — the original
# 3/day comment had drifted from reality after manual taskschd.msc edits.
#
# Run in elevated PowerShell:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> powershell.exe -ExecutionPolicy Bypass -File ".\install_wo12_poller_task.ps1"

$ErrorActionPreference = 'Stop'

$TaskName    = 'COVE-WO12-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'wo12_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_wo12_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\wo12_poller.log'

if (-not (Test-Path $PythonExe)) { throw "Python venv not found: $PythonExe" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath)) { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# Hourly 7 AM - 7 PM ET = 13 fires/day. WO snapshots are tiny (~16 open rows
# after Phase 5.5 schema split) so cadence is essentially free, and finer
# resolution makes the wo_close_events stream more useful for intra-day
# reporting. Parens around each inner call are required — without them
# PowerShell parses the commas as additional -At arguments and errors out.
$Triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 7:00AM),
  (New-ScheduledTaskTrigger -Daily -At 8:00AM),
  (New-ScheduledTaskTrigger -Daily -At 9:00AM),
  (New-ScheduledTaskTrigger -Daily -At 10:00AM),
  (New-ScheduledTaskTrigger -Daily -At 11:00AM),
  (New-ScheduledTaskTrigger -Daily -At 12:00PM),
  (New-ScheduledTaskTrigger -Daily -At 1:00PM),
  (New-ScheduledTaskTrigger -Daily -At 2:00PM),
  (New-ScheduledTaskTrigger -Daily -At 3:00PM),
  (New-ScheduledTaskTrigger -Daily -At 4:00PM),
  (New-ScheduledTaskTrigger -Daily -At 5:00PM),
  (New-ScheduledTaskTrigger -Daily -At 6:00PM),
  (New-ScheduledTaskTrigger -Daily -At 7:00PM)
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
  -Description 'Cove WO12 poller (hourly 7 AM - 7 PM ET, Mon-Sat). Phase 5.5.' `
  -Action      $Action `
  -Trigger     $Triggers `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : hourly 7 AM - 7 PM ET, Mon-Sat (script skips Sundays)"
Write-Host ''
Write-Host "Test now:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail log:"
Write-Host "  Get-Content '$LogPath' -Tail 30"
