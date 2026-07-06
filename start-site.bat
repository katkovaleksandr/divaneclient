@echo off
setlocal
cd /d "%~dp0server"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 18+ from https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules npm install
echo Starting Divane site at http://localhost:3000
node index.js
pause
