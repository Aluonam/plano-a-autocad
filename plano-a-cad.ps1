# Convierte un plano (imagen escaneada, foto o PDF) a DXF y DWG para AutoCAD.
# Uso: .\plano-a-cad.ps1 -Entrada "C:\ruta\plano.jpg" [-Preset "Technical Drawing"] [-Vectorizar]
param(
  [Parameter(Mandatory=$true)][string]$Entrada,
  [string]$Preset = "Technical Drawing",   # o "Line Art", "Sketched Art", "Black and White Logo"
  [switch]$Vectorizar                      # fuerza el trazado aunque sea un PDF
)
$ErrorActionPreference = "Stop"
$base = $PSScriptRoot
$VC = Join-Path $base "vectorcraft\vectorcraft-0.21.1-windows-x64-portable\vectorcraft-cli.exe"
$CC = Join-Path $base "cadcraft\cadcraft-0.17.1-windows-x64-portable\cadcraft-cli.exe"
$item = Get-Item $Entrada
$salida = Join-Path $item.DirectoryName ($item.BaseName + "_cad")
$dxf = "$salida.dxf"; $dwg = "$salida.dwg"; $png = "$salida.png"
$ext = $item.Extension.ToLower()

if ($ext -in ".pdf",".svg",".ai",".eps",".emf",".wmf" -and -not $Vectorizar) {
  Write-Host "Fichero vectorial: conversion directa a DXF..."
  & $VC convert $item.FullName $dxf | Out-Host
} else {
  Write-Host "Imagen: vectorizando con el preset '$Preset'..."
  $cmds = Join-Path $env:TEMP "plano-a-cad-cmds.json"
  "[{`"command`":`"select.all`",`"params`":{}},{`"command`":`"imageTrace.makeAndExpand`",`"params`":{`"preset`":`"$Preset`"}}]" |
    Set-Content -Encoding ascii $cmds
  & $VC run --in $item.FullName --commands $cmds --export $dxf | Out-Host
}
Write-Host "Generando DWG y vista previa con CADCraft..."
& $CC convert $dxf $dwg | Out-Host
& $CC convert $dxf $png | Out-Host
Write-Host "`nListo:`n  $dxf`n  $dwg`n  $png"
