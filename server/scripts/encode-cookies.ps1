# Genera YOUTUBE_COOKIES_B64 para pegar en Render
# Uso: .\encode-cookies.ps1 C:\ruta\a\cookies.txt

param(
  [Parameter(Mandatory = $true)]
  [string]$CookiesPath
)

if (-not (Test-Path $CookiesPath)) {
  Write-Error "No existe el archivo: $CookiesPath"
  exit 1
}

$bytes = [IO.File]::ReadAllBytes($CookiesPath)
$b64 = [Convert]::ToBase64String($bytes)
Write-Host ""
Write-Host "Copia TODO esto en Render -> Environment -> YOUTUBE_COOKIES_B64"
Write-Host ""
Write-Host $b64
Write-Host ""
