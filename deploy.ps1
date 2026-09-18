# DataCenter Deployment Script for Windows
# Run this to prepare the environment

$ErrorActionPreference = "Stop"

Write-Host "--- ⚡ DataCenter Deployment Tool ⚡ ---" -ForegroundColor Cyan

# 1. Create necessary directories
Write-Host "[1/4] Creating directories..."
$dirs = @("backend/logs", "proxy/logs", "backend/data", "pg_data", "redis_data")
foreach ($dir in $dirs) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
        Write-Host "  + Created $dir" -ForegroundColor Gray
    }
}

# 2. Setup .env
if (!(Test-Path ".env")) {
    Write-Host "[2/4] Setting up .env file..."
    Copy-Item ".env.example" ".env"
    
    # Generate random secrets
    $jwtSecret = [Guid]::NewGuid().ToString("N")
    $jwtRefresh = [Guid]::NewGuid().ToString("N")
    $dbPass = (-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | % {[char]$_}))
    
    (Get-Content .env) -replace "JWT_SECRET=.*", "JWT_SECRET=$jwtSecret" | Set-Content .env
    (Get-Content .env) -replace "JWT_REFRESH_SECRET=.*", "JWT_REFRESH_SECRET=$jwtRefresh" | Set-Content .env
    (Get-Content .env) -replace "POSTGRES_PASSWORD=.*", "POSTGRES_PASSWORD=$dbPass" | Set-Content .env
    Write-Host "  ! Generated new JWT secrets and DB password in .env" -ForegroundColor Yellow
} else {
    Write-Host "[2/4] .env already exists, skipping generation." -ForegroundColor Gray
}

# 3. Setup Proxy users
if (!(Test-Path "proxy/users.txt")) {
    Write-Host "[3/4] Creating default proxy users..."
    "admin:CL:admin123" | Out-File -FilePath "proxy/users.txt" -Encoding ascii
    Write-Host "  ! Created proxy/users.txt with default admin:admin123" -ForegroundColor Yellow
}

# 4. Check Docker
Write-Host "[4/4] Validating Docker environment..."
try {
    docker --version | Out-Null
    Write-Host "  + Docker found." -ForegroundColor Green
} catch {
    Write-Host "  - Error: Docker not found. Please install Docker Desktop." -ForegroundColor Red
    exit
}

Write-Host "`n--- ✅ Setup Complete ---" -ForegroundColor Cyan
Write-Host "To start the system, run:" -ForegroundColor White
Write-Host "  docker-compose up --build -d" -ForegroundColor Green
Write-Host "To see logs:" -ForegroundColor White
Write-Host "  docker-compose logs -f backend" -ForegroundColor Green
