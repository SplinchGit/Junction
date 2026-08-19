param(
    [int]$Port = 4001
)

$ErrorActionPreference = "Stop"
$serviceDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $serviceDirectory

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 18 or newer is required. Install it from https://nodejs.org/ and run this script again."
}

if (-not (Test-Path -LiteralPath (Join-Path $serviceDirectory "node_modules"))) {
    Write-Host "Installing the calculator server..."
    npm install
}

$lanAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.AddressState -eq "Preferred"
    } |
    Select-Object -ExpandProperty IPAddress -Unique

Write-Host ""
Write-Host "Junction calculator server is starting."
Write-Host "In Junction, open Settings > Build Calculator and try one of these URLs:"
foreach ($address in $lanAddresses) {
    Write-Host "  http://${address}:$Port"
}
Write-Host "Keep this window open while using the calculator. Press Ctrl+C to stop."
Write-Host "If the phone cannot connect, allow Node.js through Windows Firewall on Private networks."
Write-Host ""

$env:PORT = $Port.ToString()
npm start
