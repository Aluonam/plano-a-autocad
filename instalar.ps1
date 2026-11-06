# Descarga VectorCraft y CADCraft (versiones portables oficiales, licencia MIT/Apache-2.0),
# comprueba su huella SHA-256 y los descomprime donde los espera Plano a AutoCAD.
# Uso (PowerShell, en la carpeta del repositorio):  .\instalar.ps1
$ErrorActionPreference = "Stop"
$base = $PSScriptRoot
$programas = @(
  @{ Nombre = "vectorcraft"; Version = "0.21.1"; Sha256 = "0548a576f866f44b43cde975d4b13805be328dc05f7d975ebe37daf6d4577a94" },
  @{ Nombre = "cadcraft";    Version = "0.17.1"; Sha256 = "0aab9c02cbb0b78329fc6d29047b35deed2dee408ecdfc1eb9deabc1f720eacc" }
)
foreach ($p in $programas) {
  $carpeta = Join-Path $base $p.Nombre
  $destino = Join-Path $carpeta "$($p.Nombre)-$($p.Version)-windows-x64-portable"
  if (Test-Path (Join-Path $destino "$($p.Nombre)-cli.exe")) { Write-Host "$($p.Nombre) $($p.Version) ya está instalado."; continue }
  $zip = "$($p.Nombre)-$($p.Version)-windows-x64-portable.zip"
  $url = "https://github.com/storytold/$($p.Nombre)/releases/download/v$($p.Version)/$zip"
  $temporal = Join-Path ([IO.Path]::GetTempPath()) ("plano-a-cad-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $temporal | Out-Null
  try {
    Write-Host "Descargando $zip..."
    Invoke-WebRequest $url -OutFile (Join-Path $temporal $zip) -UseBasicParsing
    $huella = (Get-FileHash (Join-Path $temporal $zip) -Algorithm SHA256).Hash.ToLower()
    if ($huella -ne $p.Sha256) { throw "La huella de $zip no coincide ($huella). No se instala." }
    New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
    Expand-Archive (Join-Path $temporal $zip) -DestinationPath $carpeta -Force
    Write-Host "$($p.Nombre) $($p.Version) instalado y verificado."
  } finally {
    Remove-Item $temporal -Recurse -Force -ErrorAction SilentlyContinue
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Warning "Falta Node.js (versión 18 o posterior). Instálalo desde https://nodejs.org"
}
Write-Host "`nListo. Para arrancar: plano-app\Iniciar Plano a AutoCAD.bat"
