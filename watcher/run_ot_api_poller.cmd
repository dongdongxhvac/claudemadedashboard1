@echo off
REM Batch wrapper for the UPark OT API poller. Task Scheduler points at this
REM .cmd file (no cmd /c, no embedded quotes) so the path-with-spaces doesn't
REM get mangled by cmd's argument-stripping rules.

cd /d "D:\Dashboard PMs WOs Events Claude made\watcher"
".venv\Scripts\python.exe" ot_api_poller.py >> "logs\ot_api_poller.log" 2>&1
