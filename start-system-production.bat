@echo off
cd /d "%~dp0"
node scripts\production-build-guard.mjs verify
if errorlevel 1 (
  echo No verified successful production build. Run npm run build before using this launcher.
  pause
  exit /b 1
)
rem Uses the last production build. Rebuild after website source changes.
rem Existing start-system.bat remains the development launcher.
wt -w 0 new-tab --title "Render" --suppressApplicationTitle -d "%~dp0." cmd /k "npm run render"
timeout /t 2 /nobreak >nul
wt -w 0 new-tab --title "Site" --suppressApplicationTitle -d "%~dp0." cmd /k "npm run start"
timeout /t 2 /nobreak >nul
wt -w 0 new-tab --title "Bot" --suppressApplicationTitle -d "%~dp0." cmd /k "npm run bot"
timeout /t 2 /nobreak >nul
wt -w 0 new-tab --title "Worker" --suppressApplicationTitle -d "%~dp0." cmd /k "npm run worker"
timeout /t 2 /nobreak >nul
wt -w 0 new-tab --title "News Bot" --suppressApplicationTitle -d "%~dp0." cmd /k "npm run news:bot"
