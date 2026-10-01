@echo off
REM Installs everything and starts both servers. Needs Node.js 20+ (https://nodejs.org, LTS).
cd /d "%~dp0backend"
call npm install
start "SNCMT backend" cmd /k npm run start:dev
cd /d "%~dp0frontend"
call npm install
echo.
echo Open http://localhost:3000 when you see "Ready".
call npm run dev
