@echo off
REM Bulletproof batch wrapper for the labor poller. Task Scheduler points at
REM this .cmd file (no cmd /c, no embedded quotes) so the path-with-spaces
REM doesn't get mangled by cmd's argument-stripping rules.

cd /d "D:\Dashboard PMs WOs Events Claude made\watcher"
".venv\Scripts\python.exe" labor_poller.py >> "logs\labor_poller.log" 2>&1
