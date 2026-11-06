@echo off
chcp 65001 >nul
title Plano a AutoCAD
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este fichero. & pause & exit /b 1)
set ABRIR=1
node server.js
pause
