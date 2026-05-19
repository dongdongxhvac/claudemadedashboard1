# Register the COVE labor poller as a Windows Scheduled Task.
#
# Runs labor_poller.py hourly from 7:00 AM through 7:00 PM (13 fires/day).
# The script itself skips on Sundays, so 6 working days of polling.
#
# Run this script in an *elevated* PowerShell (Run as administrator). The task
# is registered under the current user account.
#
# Usage:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> .\install_labor_poller_task.ps1
#
# Companion: .\uninstall_labor_poller_task.ps1 removes it.

$ErrorActionPreference = 'Stop'

$TaskName    = 'COVE-Labor-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'labor_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_labor_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\labor_poller.log'

# Sanity checks before we touch the scheduler.
if (-not (Test-Path $PythonExe)) {
  throw "Python venv not found: $PythonExe. Did you run pip install in .venv?"
}
if (-not (Test-Path $ScriptPath)) {
  throw "Poller script not found: $ScriptPath"
}
if (-not (Test-Path $BatchPath)) {
  throw "Batch wrapper not found: $BatchPath"
}
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}

# Point Task Scheduler directly at the batch file. Earlier versions used
# `cmd.exe /c "<py>" "<script>" >> "<log>" 2>&1` but cmd's quote-stripping
# rules mangled the path-with-spaces and the redirect never happened. The
# batch file does the cd + redirect itself, so the scheduler config stays
# trivial.
$Action = New-ScheduledTaskAction `
  -Execute          $BatchPath `
  -WorkingDirectory $WatcherDir

# One trigger at 7:00 AM that repeats every hour for the next 12 hours.
# That produces firings at 7,8,9,10,11,12,13,14,15,16,17,18,19 = 13/day.
$Trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
$Trigger.Repetition = (New-ScheduledTaskTrigger `
  -Once -At 7:00AM `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition

# Keep things tidy: stop if it overruns 10 min (it should finish in seconds),
# allow restart on failure, run only when network is available.
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)

# Run as the current user with their stored credentials. The task needs to
# read watcher\.env, which lives under your profile in some setups.
$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType S4U `
  -RunLevel Limited

# If a previous version is registered, replace it cleanly.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Removing existing task '$TaskName'..."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName    $TaskName `
  -Description 'Hourly Cove labor poller (7am-7pm Mon-Sat). Phase 5.1.' `
  -Action      $Action `
  -Trigger     $Trigger `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Python : $PythonExe"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : every hour 7:00 AM - 7:00 PM, daily (script skips Sundays)"
Write-Host ''
Write-Host "Verify:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Run once now (for testing):"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Then tail the log:"
Write-Host "  Get-Content '$LogPath' -Tail 20 -Wait"
