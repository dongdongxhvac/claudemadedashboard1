# Register the OnTheClock PTO poller as a Windows Scheduled Task.
# Pattern mirrors install_plantlog_poller_task.ps1.
#
# Run in elevated PowerShell:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> powershell.exe -ExecutionPolicy Bypass -File ".\install_pto_poller_task.ps1"

$ErrorActionPreference = 'Stop'

$TaskName    = 'PTO-OnTheClock-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'pto_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_pto_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\pto_poller.log'

if (-not (Test-Path $PythonExe))  { throw "Python venv not found: $PythonExe" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath))  { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# PTO changes slowly — approvals happen once a day at most for a 12-person
# team. Run twice daily: 6 AM (before morning huddle) and 2 PM (catches
# midday approvals before the afternoon shift). Adjust later if needed.
$Trigger = New-ScheduledTaskTrigger -Daily -At 6:00AM
$Trigger.Repetition = (New-ScheduledTaskTrigger `
  -Once -At 6:00AM `
  -RepetitionInterval (New-TimeSpan -Hours 8) `
  -RepetitionDuration (New-TimeSpan -Hours 16)).Repetition

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
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
  -Description 'OnTheClock PTO poller (twice daily, 6 AM + 2 PM). Phase 12.' `
  -Action      $Action `
  -Trigger     $Trigger `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : 6 AM and 2 PM daily"
Write-Host ''
Write-Host "Test now:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail log:"
Write-Host "  Get-Content '$LogPath' -Tail 20 -Wait"
