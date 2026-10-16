@echo off
rem Starts everything the site needs, each in its own named tab of ONE Windows Terminal window.
rem Close the whole terminal window to stop everything.

wt -w 0 new-tab --title "Render" --suppressApplicationTitle -d "C:\final-whistle-web" cmd /k "npm run render"
timeout /t 2 /nobreak >nul

wt -w 0 new-tab --title "Site" --suppressApplicationTitle -d "C:\final-whistle-web" cmd /k "npm run dev"
timeout /t 2 /nobreak >nul

wt -w 0 new-tab --title "Bot" --suppressApplicationTitle -d "C:\final-whistle-web" cmd /k "npm run bot"
timeout /t 2 /nobreak >nul

wt -w 0 new-tab --title "Worker" --suppressApplicationTitle -d "C:\final-whistle-web" cmd /k "npm run worker"

rem Only if you still run your old n8n workflow, remove the "rem " in front of the next two blocks:
rem timeout /t 2 /nobreak >nul
rem wt -w 0 new-tab --title "ngrok" --suppressApplicationTitle cmd /k "ngrok http --url=valiant-chase-unripe.ngrok-free.dev 5678"
rem timeout /t 2 /nobreak >nul
rem wt -w 0 new-tab --title "n8n" --suppressApplicationTitle cmd /k "C:\football-bot\n8n-start.bat"
