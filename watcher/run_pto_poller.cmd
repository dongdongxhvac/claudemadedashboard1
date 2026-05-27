@echo off
REM Batch wrapper for Task Scheduler. See run_labor_poller.cmd for why we
REM avoid `cmd /c "..."` invocations from the scheduler config.

cd /d "D:\Dashboard PMs WOs Events Claude made\watcher"
".venv\Scripts\python.exe" pto_poller.py >> "logs\pto_poller.log" 2>&1
