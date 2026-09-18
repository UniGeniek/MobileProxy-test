# PowerShell helper to run cross-entity audit
Write-Host 'Ensure API and DB are running and environment variables configured for DB in src/config.js'
Write-Host 'Running audit...'
node tests\audit\crossEntityAudit.js
$rc = $LASTEXITCODE
Write-Host "Audit exit code: $rc"
exit $rc
