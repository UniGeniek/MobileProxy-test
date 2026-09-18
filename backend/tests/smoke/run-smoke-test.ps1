# Run the smoke test for DataCenter (PowerShell)
# Usage: .\run-smoke-test.ps1 -ApiBase http://localhost:4000 -Count 50 -Parallel 25 -RouterDelay 200
param(
  [string]$ApiBase = 'http://localhost:4000',
  [int]$Count = 30,
  [int]$Parallel = 20,
  [int]$RouterDelay = 200,
  [int]$TimeoutSec = 120
)

Write-Host "Smoke test settings: API=$ApiBase Count=$Count Parallel=$Parallel RouterDelay=${RouterDelay}ms Timeout=${TimeoutSec}s"

# Instructions:
Write-Host "1) Start backend API:"
Write-Host "   In one terminal: `node src/index.js`"
Write-Host "2) Start router service with artificial delay (${RouterDelay}ms):"
Write-Host "   In another terminal: `set ROUTER_PROCESS_DELAY_MS=$RouterDelay; node src/workers/routerService.js`"
Write-Host "3) Start executor and agent (both) to stress double-exec scenario:"
Write-Host "   Executor: set EXECUTOR_MODE=hybrid; node src/workers/resetExecutor.js"
Write-Host "   Agent:    set EXECUTOR_MODE=hybrid; node src/agents/pocAgent.js"
Write-Host "   NOTE: hybrid is allowed only in non-production. For production, run only one of agent/worker."

Write-Host "When services are running, in this shell we'll run the test script..."

$env:API_BASE = $ApiBase
$env:SMOKE_COUNT = $Count
$env:SMOKE_PARALLEL = $Parallel
$env:SMOKE_TIMEOUT = $([int]$TimeoutSec * 1000)

Write-Host "Running smoke test script..."
node tests\smoke\smokeTest.js

Write-Host "Smoke test script finished. Check exit code: $LASTEXITCODE"
