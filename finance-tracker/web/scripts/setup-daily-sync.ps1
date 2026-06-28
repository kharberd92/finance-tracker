<#
  Registers (or updates) a daily Windows Task Scheduler job that runs the
  finance-tracker Plaid sync. Run from an elevated PowerShell:

      pwsh -File scripts/setup-daily-sync.ps1 -Time 06:00

  The machine must be on/awake at the scheduled time. Re-run on a new machine
  after cloning + `npm install` + recreating `.env.local`.
#>
param(
  [string]$Time = '06:00',
  [string]$TaskName = 'FinanceTrackerDailySync'
)

$ErrorActionPreference = 'Stop'

# Resolve the web project dir (parent of this script's /scripts folder).
$webDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $webDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'daily-sync.log'

# Run npm via cmd so the scheduler can find it; append stdout+stderr to the log.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm.cmd not found on PATH.' }

# Inner-quote the npm path so its space (default install: C:\Program Files\nodejs)
# survives cmd.exe's outer-quote stripping. Without the inner quotes cmd parses
# 'C:\Program' as the command and the task fails on every run.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$npm`" run sync:daily >> `"$logFile`" 2>&1`"" `
  -WorkingDirectory $webDir

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# Start when available (catch up a missed run) and allow waking the machine.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Daily Plaid transaction sync for Finance Tracker' -Force

Write-Host "Registered task '$TaskName' to run 'npm run sync:daily' daily at $Time."
Write-Host "Logs: $logFile"
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'"
