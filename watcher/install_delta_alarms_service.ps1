# Register the Delta enteliWEB alarms daemon as a Windows service via NSSM.
# Long-running (24/7) - cannot use Task Scheduler because tier 1 polls every 5s.
# Pattern mirrors install_service.ps1 (the original COVE-Watcher).
#
# Run from an ELEVATED PowerShell (the -ExecutionPolicy Bypass flag is needed
# because the script isn't code-signed, same as install_plantlog_poller_task.ps1):
#   cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   powershell.exe -ExecutionPolicy Bypass -File ".\install_delta_alarms_service.ps1"
#
# Re-running is safe -- it stops and removes any existing service first.

$ErrorActionPreference = 'Stop'

$ServiceName = 'DELTA-Alarms-Daemon'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$Python      = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$MainPy      = Join-Path $WatcherDir 'delta_alarms_daemon.py'
$LogDir      = Join-Path $WatcherDir 'logs'
$StdoutLog   = Join-Path $LogDir 'delta_alarms.log'
$StderrLog   = Join-Path $LogDir 'delta_alarms.err.log'

# --- locate nssm.exe -----------------------------------------------------
$nssm = $null
$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssmCmd) { $nssm = $nssmCmd.Source }
if (-not $nssm) {
    $candidates = Get-ChildItem `
        -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" `
        -Recurse -Filter 'nssm.exe' -ErrorAction SilentlyContinue
    foreach ($c in $candidates) {
        if ($c.FullName -like '*\win64\*' -and $c.FullName -like '*NSSM*') {
            $nssm = $c.FullName
            break
        }
    }
}
if (-not $nssm) { throw 'nssm.exe not found. Install with: winget install NSSM.NSSM' }
Write-Host "Using nssm: $nssm"

# --- require admin -------------------------------------------------------
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell (Run as administrator).'
}

# --- sanity-check files --------------------------------------------------
foreach ($p in @($Python, $MainPy)) {
    if (-not (Test-Path $p)) { throw "Missing required file: $p" }
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# --- remove any existing service so we can reinstall cleanly -------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host 'Existing service found, removing...'
    if ($existing.Status -ne 'Stopped') { & $nssm stop $ServiceName confirm | Out-Host }
    & $nssm remove $ServiceName confirm | Out-Host
}

# --- install + configure -------------------------------------------------
# AppParameters must keep literal quotes around the script path (otherwise the
# space in "Dashboard PMs ..." splits argv). Set the registry value directly
# because PowerShell + nssm CLI quoting round-trip strips the quotes.
Write-Host "Installing service $ServiceName ..."
& $nssm install $ServiceName $Python | Out-Host

$paramRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
$quotedScript = '"' + $MainPy + '"'
Set-ItemProperty -Path $paramRegPath -Name 'AppParameters' -Type String -Value $quotedScript
Write-Host ("AppParameters (registry) = " + (Get-ItemProperty -Path $paramRegPath -Name 'AppParameters').AppParameters)

& $nssm set $ServiceName AppDirectory $WatcherDir | Out-Host
& $nssm set $ServiceName DisplayName 'Delta enteliWEB Alarms Daemon' | Out-Host
& $nssm set $ServiceName Description 'Polls Takeda enteliWEB notification feed every 5s; reconciles open alarms every 5min. Phase 7.0.' | Out-Host
& $nssm set $ServiceName Start SERVICE_AUTO_START | Out-Host

# stdout / stderr to rotating log files
& $nssm set $ServiceName AppStdout $StdoutLog | Out-Host
& $nssm set $ServiceName AppStderr $StderrLog | Out-Host
& $nssm set $ServiceName AppRotateFiles 1 | Out-Host
& $nssm set $ServiceName AppRotateOnline 1 | Out-Host
& $nssm set $ServiceName AppRotateBytes 5242880 | Out-Host   # 5 MB - tier 1 logs are chatty
& $nssm set $ServiceName AppStdoutCreationDisposition 4 | Out-Host
& $nssm set $ServiceName AppStderrCreationDisposition 4 | Out-Host

# Send SIGTERM (15 sec window for the daemon's graceful exit) before SIGKILL.
& $nssm set $ServiceName AppStopMethodSkip 0 | Out-Host
& $nssm set $ServiceName AppStopMethodConsole 15000 | Out-Host

# Restart on crash. Tier-1 loop catches its own exceptions, so getting here
# means something fatal (Python crash, OOM). Wait 10s before restart so we
# don't pummel enteliWEB if there's a credentials issue.
& $nssm set $ServiceName AppExit Default Restart | Out-Host
& $nssm set $ServiceName AppRestartDelay 10000 | Out-Host
& $nssm set $ServiceName AppThrottle 30000 | Out-Host   # ignore crash if uptime < 30s for restart-count purposes

# --- dump stored config (debug aid) --------------------------------------
Write-Host ''
Write-Host '--- nssm dump --------------------------------------------------------'
& $nssm dump $ServiceName | Out-Host
Write-Host '----------------------------------------------------------------------'

# --- start and verify ----------------------------------------------------
Write-Host 'Starting service...'
& $nssm start $ServiceName | Out-Host

Start-Sleep -Seconds 5
Get-Service -Name $ServiceName | Format-Table Name, Status, StartType -AutoSize | Out-Host

$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
    Write-Host 'Service is not Running. Last 30 lines of stderr.log:' -ForegroundColor Yellow
    Get-Content $StderrLog -Tail 30 -ErrorAction SilentlyContinue | Out-Host
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "Tail stdout: Get-Content '$StdoutLog' -Wait -Tail 30"
Write-Host "Tail stderr: Get-Content '$StderrLog' -Wait -Tail 30"
Write-Host "Stop:        & '$nssm' stop $ServiceName"
Write-Host "Uninstall:   & '$nssm' stop $ServiceName ; & '$nssm' remove $ServiceName confirm"
