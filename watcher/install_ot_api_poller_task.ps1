# Register the UPark OT API poller as a Windows Scheduled Task.
#
# Runs ot_api_poller.py every 5 minutes, around the clock. The workstation
# must be on the OT viewer's tailnet (Tailscale signed in).
#
# Run this script in an *elevated* PowerShell (Run as administrator). The task
# is registered under the current user account.
#
# Usage:
#   PS> cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   PS> .\install_ot_api_poller_task.ps1
#
# Companion: .\uninstall_ot_api_poller_task.ps1 removes it.

$ErrorActionPreference = 'Stop'

$TaskName    = 'UPark-OT-API-Poller'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$PythonExe   = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$ScriptPath  = Join-Path $WatcherDir 'ot_api_poller.py'
$BatchPath   = Join-Path $WatcherDir 'run_ot_api_poller.cmd'
$LogPath     = Join-Path $WatcherDir 'logs\ot_api_poller.log'

if (-not (Test-Path $PythonExe)) { throw "Python venv not found: $PythonExe. Did you run pip install in .venv?" }
if (-not (Test-Path $ScriptPath)) { throw "Poller script not found: $ScriptPath" }
if (-not (Test-Path $BatchPath))  { throw "Batch wrapper not found: $BatchPath" }
if (-not (Test-Path (Split-Path $LogPath))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
}
if (-not (Select-String -Path (Join-Path $WatcherDir '.env') -Pattern '^UPARK_OT_API_KEY=' -Quiet -ErrorAction SilentlyContinue)) {
  Write-Warning "UPARK_OT_API_KEY is not set in watcher\.env — the poller will fail until it is."
}

$Action = New-ScheduledTaskAction -Execute $BatchPath -WorkingDirectory $WatcherDir

# One trigger at midnight that repeats every 5 minutes, indefinitely.
$Trigger = New-ScheduledTaskTrigger -Daily -At 12:00AM
$Trigger.Repetition = (New-ScheduledTaskTrigger `
  -Once -At 12:00AM `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 1)).Repetition

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
  -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Removing existing task '$TaskName'..."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName    $TaskName `
  -Description 'UPark Overtime API poller, every 5 minutes (feeds /upark/manager §11b + TV2).' `
  -Action      $Action `
  -Trigger     $Trigger `
  -Settings    $Settings `
  -Principal   $Principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName':"
Write-Host "  Script : $ScriptPath"
Write-Host "  Log    : $LogPath"
Write-Host "  Fires  : every 5 minutes"
Write-Host ''
Write-Host "Run once now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Tail the log:  Get-Content '$LogPath' -Tail 20 -Wait"
