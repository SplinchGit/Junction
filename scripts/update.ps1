Write-Host "Junction update: pulling latest changes..." -ForegroundColor Cyan
git pull

if (Test-Path ".\\apps\\web\\package.json") {
    Write-Host "Refreshing web dependencies..." -ForegroundColor Cyan
    Push-Location .\\apps\\web
    npm install
    Pop-Location
}

Write-Host "Done." -ForegroundColor Green
