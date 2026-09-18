param(
  [string]$ExperimentId = "smoke_v1",
  [int]$Concurrency = 25,
  [int]$Count = 50,
  [int]$RouterDelay = 200,
  [string]$Services = "api,router,executor,agent",
  [string]$Notes = ""
)

# Ensure logs dir
$logDir = Join-Path -Path "..\..\logs" -ChildPath "experiments"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$timestamp = (Get-Date).ToString("o")
$header = [PSCustomObject]@{
  EXPERIMENT_ID = $ExperimentId
  TIMESTAMP_START = $timestamp
  CONCURRENCY = $Concurrency
  COUNT = $Count
  ROUTER_DELAY_MS = $RouterDelay
  SERVICES = $Services
  NOTES = $Notes
}

$outJson = ConvertTo-Json $header -Depth 5
$outFile = Join-Path $logDir ("experiment_{0}_{1}.json" -f $ExperimentId, (Get-Date -Format "yyyyMMddHHmmss"))
Set-Content -Path $outFile -Value $outJson -Encoding UTF8

# Also export environment file for downstream scripts
$envFile = Join-Path $logDir ("experiment_{0}.env" -f $ExperimentId)
@"
EXPERIMENT_ID=$ExperimentId
TIMESTAMP_START=$timestamp
SMOKE_CONCURRENCY=$Concurrency
SMOKE_COUNT=$Count
ROUTER_PROCESS_DELAY_MS=$RouterDelay
SERVICES=$Services
"@ | Set-Content -Path $envFile -Encoding UTF8

Write-Host "Experiment header written to: $outFile"
Write-Host "Env file written to: $envFile"
Write-Host "Header content:`n$outJson" -ForegroundColor Cyan

# Return paths
$return = @{ json = $outFile; env = $envFile }
$return | ConvertTo-Json
