# Remove the dashboard's daily Scheduled Tasks.
$ErrorActionPreference = "SilentlyContinue"
Get-ScheduledTask | Where-Object { $_.TaskName -like "BETAS-EPC-Dashboard-*" } |
  Unregister-ScheduledTask -Confirm:$false
Write-Host "Removed the dashboard Scheduled Tasks." -ForegroundColor Green
