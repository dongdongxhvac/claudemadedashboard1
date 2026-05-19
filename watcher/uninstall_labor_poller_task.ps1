# Remove the COVE labor poller scheduled task. Run in elevated PowerShell.

$ErrorActionPreference = 'Stop'
$TaskName = 'COVE-Labor-Poller'

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Task '$TaskName' not registered. Nothing to do."
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task '$TaskName'."
