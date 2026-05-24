# Register the Gmail-alarms poller as a Windows Scheduled Task.
# Pattern mirrors install_plantlog_poller_task.ps1 but at 5-minute cadence
# since email alarms are bursty (a transition produces 2 emails seconds apart).
#
# Run from an elevated PowerShell:
#   cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   powershell.exe -ExecutionPolicy Bypass -File ".\install_gmail_alarms_poller_task.ps1"

$ErrorActionPreference = 'Stop'

$TaskName    = 'GMAIL-Alarms-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'gmail_alarms_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_gmail_alarms_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\gmail_alarms_poller.log'

if (-not (Test-Path $PythonExe))  { throw "Python venv not found: $PythonExe" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath))  { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# Fire every 5 minutes 24/7. <20 emails/day expected; this gives near-real-time
# pickup without hammering Gmail's IMAP. Daily=midnight gives a steady anchor;
# Repetition handles the every-5-min cadence.
$Trigger = New-ScheduledTaskTrigger -Daily -At 12:00AM
$Trigger.Repetition = (New-ScheduledTaskTrigger `
  -Once -At 12:00AM `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Hours 24)).Repetition

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 2)

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
  -Description 'Gmail-forwarded BMS alarm emails poller (every 5 min, 24/7). Phase 8.0.' `
  -Action      $Action `
  -Trigger     $Trigger `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : every 5 minutes, 24/7"
Write-Host ''
Write-Host "Test now:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail log:"
Write-Host "  Get-Content '$LogPath' -Tail 20 -Wait"
