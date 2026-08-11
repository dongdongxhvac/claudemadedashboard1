@echo off
rem %~dp0 = this script's own folder, so the repo can live anywhere
rem (e.g. C:\Users\don\claudemadedashboard1\watcher).
cd /d "%~dp0"
".venv\Scripts\python.exe" binney_escort_poller.py >> "logs\binney_escort_poller.log" 2>&1
