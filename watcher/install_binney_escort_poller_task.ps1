# Register the Binney Escort poller as a Windows Scheduled Task.
# Hourly 7 AM - 7 PM ET, every day (escort WOs can land any day).
#
# Run in elevated PowerShell:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> powershell.exe -ExecutionPolicy Bypass -File ".\install_binney_escort_poller_task.ps1"

$ErrorActionPreference = 'Stop'

$TaskName    = 'COVE-BinneyEscort-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'binney_escort_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_binney_escort_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\binney_escort_poller.log'

if (-not (Test-Path $PythonExe)) { throw "Python venv not found: $PythonExe" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath)) { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# Hourly 7 AM - 7 PM ET. The escort set is ~a dozen rows, so cadence is free.
# Parens around each inner call are required — without them PowerShell parses
# the commas as additional -At arguments and errors out.
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
  -Description 'Cove Binney Escort poller (hourly 7 AM - 7 PM ET, daily). Feeds /binney/exp.' `
  -Action      $Action `
  -Trigger     $Triggers `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : hourly 7 AM - 7 PM ET, daily"
Write-Host ''
Write-Host "Test now:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail log:"
Write-Host "  Get-Content '$LogPath' -Tail 30"
