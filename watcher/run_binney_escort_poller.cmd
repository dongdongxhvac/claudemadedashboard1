@echo off
cd /d "D:\Dashboard PMs WOs Events Claude made\watcher"
".venv\Scripts\python.exe" binney_escort_poller.py >> "logs\binney_escort_poller.log" 2>&1
