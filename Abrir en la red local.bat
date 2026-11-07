@echo off
chcp 65001 >nul
title Plano a AutoCAD - red local
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Instalalo desde https://nodejs.org & pause & exit /b 1)
node servir.js
pause
