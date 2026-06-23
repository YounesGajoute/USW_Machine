# Create a dated firmware backup under firmware_backup/
# Usage:
#   .\scripts\backup_firmware.ps1
#   .\scripts\backup_firmware.ps1 -Label "after_move_api"
param(
    [string]$Label = "production"
)

$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root "platformio.ini"))) {
    Write-Error "Run from TEST project (platformio.ini not found in $root)"
    exit 1
}

$date = Get-Date -Format "yyyy-MM-dd"
$dest = Join-Path (Join-Path $root "firmware_backup") "${date}_${Label}"
$srcDir = Join-Path $dest "src"
$masterDir = Join-Path $dest "master"
$builtDir = Join-Path $dest "built"
New-Item -ItemType Directory -Force -Path $srcDir, $masterDir, $builtDir | Out-Null

Copy-Item (Join-Path $root "src\main.cpp") $srcDir -Force
Copy-Item (Join-Path $root "platformio.ini") $dest -Force

$masterFiles = @(
    "pick_place_master.js",
    "pick_place_client.js",
    "pick_place_config.js",
    "pick_place_api.js",
    "pick_place_settings.html",
    "pick_place_home.py",
    "pick_place_move.py",
    "package.json"
)
foreach ($f in $masterFiles) {
    $p = Join-Path $root "master\$f"
    if (Test-Path $p) { Copy-Item $p (Join-Path $masterDir $f) -Force }
}
$masterData = Join-Path $root "master\data"
if (Test-Path $masterData) {
    Copy-Item $masterData (Join-Path $masterDir "data") -Recurse -Force
}

Copy-Item (Join-Path $root "scripts\patch_ethercard.py") (Join-Path (Join-Path $dest "scripts") "patch_ethercard.py") -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $dest "scripts") | Out-Null
Copy-Item (Join-Path $root "scripts\backup_firmware.ps1") (Join-Path (Join-Path $dest "scripts") "backup_firmware.ps1") -Force -ErrorAction SilentlyContinue

$hex = Join-Path $root ".pio\build\nano\firmware.hex"
if (Test-Path $hex) {
    Copy-Item $hex (Join-Path $builtDir "nano_firmware.hex") -Force
    Write-Host "Included: built\nano_firmware.hex"
} else {
    Write-Host "Note: no firmware.hex - run: py -m platformio run -e nano"
}

$backupMd = Join-Path $root "firmware_backup\BACKUP_TEMPLATE.md"
$destMd = Join-Path $dest "BACKUP.md"
if (Test-Path $backupMd) {
    $content = Get-Content $backupMd -Raw
    $content = $content -replace '\{\{DATE\}\}', $date
    $content = $content -replace '\{\{LABEL\}\}', $Label
    Set-Content -Path $destMd -Value $content -Encoding UTF8
} else {
    $stub = "# Backup ${date}_${Label}`n`nSee firmware_backup/README.md"
    Set-Content -Path $destMd -Value $stub -Encoding UTF8
}

Write-Host "Backup created: $dest"
Get-ChildItem -Recurse $dest | Select-Object FullName, Length
