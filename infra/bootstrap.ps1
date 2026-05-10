Write-Host "Bootstrapping integration-service dependencies..."
Push-Location "$PSScriptRoot\..\integration-service"
npm install
Pop-Location

Write-Host "Bootstrapping ai-service dependencies..."
Push-Location "$PSScriptRoot\..\ai-service"
npm install
Pop-Location

$composer = Get-Command composer -ErrorAction SilentlyContinue
if ($composer) {
    Write-Host "Bootstrapping integaglpi dependencies..."
    Push-Location "$PSScriptRoot\..\integaglpi"
    composer install
    Pop-Location
}
