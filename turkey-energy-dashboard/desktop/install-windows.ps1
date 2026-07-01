# Register 5 daily Scheduled Tasks to refresh the dashboard at 09:00, 10:00,
# 11:00, 12:00 and 14:00 — your PC's LOCAL time. If your Windows clock is set to
# Turkey time (UTC+3), these are exactly the Turkish times you asked for.
#
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File install-windows.ps1
# Remove:             powershell -ExecutionPolicy Bypass -File uninstall-windows.ps1
$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$refresh = Join-Path $dir "refresh.cmd"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found. Install Node 18+ (https://nodejs.org) then re-run." -ForegroundColor Red
  exit 1
}

$times = @("09:00","10:00","11:00","12:00","14:00")
foreach ($t in $times) {
  $name = "BETAS-EPC-Dashboard-" + ($t -replace ':','')
  $action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$refresh`""
  $trigger = New-ScheduledTaskTrigger -Daily -At $t
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Force | Out-Null
  Write-Host "Registered $name at $t (local time)."
}
Write-Host "Done. Manage them in Task Scheduler (search 'BETAS-EPC-Dashboard')." -ForegroundColor Green
