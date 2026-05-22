@echo off
cd /d "D:\Dashboard PMs WOs Events Claude made\watcher"
".venv\Scripts\python.exe" wo12_poller.py >> "logs\wo12_poller.log" 2>&1
