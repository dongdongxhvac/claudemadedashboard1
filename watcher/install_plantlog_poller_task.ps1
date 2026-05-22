# Register the Plantlog poller as a Windows Scheduled Task.
# Pattern mirrors install_pm12_poller_task.ps1.
#
# Run in elevated PowerShell:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> powershell.exe -ExecutionPolicy Bypass -File ".\install_plantlog_poller_task.ps1"

$ErrorActionPreference = 'Stop'

$TaskName    = 'PLANTLOG-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'plantlog_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_plantlog_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\plantlog_poller.log'

if (-not (Test-Path $PythonExe))  { throw "Python venv not found: $PythonExe" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath))  { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# Hourly 7 AM - 7 PM every day. Plantlog rounds happen across all 7 days
# (overtime, weekend coverage), so no Sunday skip. Each run does one login
# + two XLSX fetches + upsert — ~5 seconds total.
$Trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
$Trigger.Repetition = (New-ScheduledTaskTrigger `
  -Once -At 7:00AM `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition

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
  -Description 'Plantlog XLSX-export poller (hourly 7 AM - 7 PM, every day). Phase 6.6.' `
  -Action      $Action `
  -Trigger     $Trigger `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : every hour 7 AM - 7 PM, daily"
Write-Host ''
Write-Host "Test now:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail log:"
Write-Host "  Get-Content '$LogPath' -Tail 20 -Wait"
