# Register the COVE watcher as a Windows service via NSSM.
# Requires admin. Compatible with Windows PowerShell 5.1.
#
# Run from an elevated PowerShell:
#   cd "D:\Dashboard PMs WOs Events Claude made\watcher"
#   .\install_service.ps1
#
# Re-running is safe -- it removes any existing service first.

$ErrorActionPreference = 'Stop'

$ServiceName = 'COVE-Watcher'
$WatcherDir  = 'D:\Dashboard PMs WOs Events Claude made\watcher'
$Python      = Join-Path $WatcherDir '.venv\Scripts\python.exe'
$MainPy      = Join-Path $WatcherDir 'main.py'
$LogDir      = Join-Path $WatcherDir 'logs'
$StdoutLog   = Join-Path $LogDir 'stdout.log'
$StderrLog   = Join-Path $LogDir 'stderr.log'

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

# --- sanity-check the watcher files exist before touching SCM ------------
foreach ($p in @($Python, $MainPy)) {
    if (-not (Test-Path $p)) { throw "Missing required file: $p" }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# --- remove any existing service so we can reinstall cleanly -------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host 'Existing service found, removing...'
    if ($existing.Status -ne 'Stopped') { & $nssm stop    $ServiceName confirm | Out-Host }
    & $nssm remove $ServiceName confirm | Out-Host
}

# --- install + configure -------------------------------------------------
# Install with just the executable. AppParameters must keep literal quotes
# around the script path (otherwise the space in "Dashboard PMs ..." splits
# the path into separate Win32 argv entries). PowerShell + nssm CLI quoting
# round-trip strips those quotes, so set the registry value directly.
Write-Host "Installing service $ServiceName ..."
& $nssm install $ServiceName $Python                     | Out-Host

$paramRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
$quotedScript = '"' + $MainPy + '"'   # literal: "D:\...\main.py"
Set-ItemProperty -Path $paramRegPath -Name 'AppParameters' -Type String -Value $quotedScript
Write-Host ("AppParameters (registry) = " + (Get-ItemProperty -Path $paramRegPath -Name 'AppParameters').AppParameters)

& $nssm set     $ServiceName AppDirectory $WatcherDir    | Out-Host
& $nssm set     $ServiceName DisplayName 'COVE CSV Watcher' | Out-Host
& $nssm set     $ServiceName Description 'Watches CSV DB/ and ingests new CSVs into Supabase.' | Out-Host
& $nssm set     $ServiceName Start SERVICE_AUTO_START    | Out-Host

# stdout / stderr to rotating log files
& $nssm set     $ServiceName AppStdout $StdoutLog        | Out-Host
& $nssm set     $ServiceName AppStderr $StderrLog        | Out-Host
& $nssm set     $ServiceName AppRotateFiles 1            | Out-Host
& $nssm set     $ServiceName AppRotateOnline 1           | Out-Host
& $nssm set     $ServiceName AppRotateBytes 1048576      | Out-Host
& $nssm set     $ServiceName AppStdoutCreationDisposition 4 | Out-Host  # OPEN_ALWAYS - append
& $nssm set     $ServiceName AppStderrCreationDisposition 4 | Out-Host

# Restart on crash, max 3 times in succession with a 5s delay.
& $nssm set     $ServiceName AppExit Default Restart     | Out-Host
& $nssm set     $ServiceName AppRestartDelay 5000        | Out-Host

# --- dump stored config (debug aid in case it ever breaks again) ---------
Write-Host ''
Write-Host '--- nssm dump --------------------------------------------------------'
& $nssm dump $ServiceName | Out-Host
Write-Host '----------------------------------------------------------------------'

# --- start and verify ----------------------------------------------------
Write-Host 'Starting service...'
& $nssm start   $ServiceName                              | Out-Host

Start-Sleep -Seconds 3
Get-Service -Name $ServiceName | Format-Table Name, Status, StartType -AutoSize | Out-Host

# If still paused/stopped, show the most recent stderr so the user can see why.
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') {
    Write-Host 'Service is not Running. Last 20 lines of stderr.log:' -ForegroundColor Yellow
    Get-Content $StderrLog -Tail 20 -ErrorAction SilentlyContinue | Out-Host
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "Tail logs with: Get-Content '$StdoutLog' -Wait -Tail 20"
Write-Host "Uninstall with: & '$nssm' stop $ServiceName ; & '$nssm' remove $ServiceName confirm"
