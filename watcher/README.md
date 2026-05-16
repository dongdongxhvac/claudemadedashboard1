# COVE CSV watcher

A local Python service that watches the `CSV DB/` folder. Whenever a CSV is
dropped or modified, it classifies the file by name, parses it, inserts a
`snapshots` row plus the matching `*_rows` into Supabase, and logs the result
to `ingestion_log`.

## One-time setup

```powershell
cd "D:\Dashboard PMs WOs Events Claude made\watcher"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env -Force
# then edit .env and paste your SUPABASE_SERVICE_KEY from the dashboard
```

The service-role key lives at:
**Supabase dashboard → Project Settings → API → Project API keys → service_role**

It is highly sensitive — do not paste it into a browser, chat, or commit it.

## Run modes

```powershell
# Foreground daemon — watches WATCH_DIR forever
python main.py

# Backfill mode — ingest every existing CSV first, then watch
python main.py --backfill

# One-shot — ingest a single file and exit (good for testing)
python main.py --once "..\CSV DB\COVE PM12 2026-05-14 6am.csv"
```

## Filename patterns recognised

| Pattern                             | Kind  |
|------------------------------------|-------|
| `COVE PM12 YYYY-MM-DD [Nam/pm].csv` | pm12  |
| `COVE Labor YYYY-MM-DD [Nam/pm].csv`| labor (Phase 1.2) |
| `COVE WO12 YYYY-MM-DD [Nam/pm].csv` | wo (Phase 1.2)    |

A CSV that does not match is logged as `skipped` in `ingestion_log`.

## Verifying it worked

After dropping a CSV, check the Supabase SQL editor:

```sql
select * from ingestion_log order by at desc limit 5;
select kind, filename, row_count from snapshots order by created_at desc limit 5;
select count(*) from pm_rows where snapshot_id = (
  select id from snapshots order by created_at desc limit 1
);
```

## Run as a Windows service (Phase 1 final step)

Use NSSM to keep the watcher running across reboots:

```powershell
choco install nssm    # or download from nssm.cc
nssm install COVE-Watcher
# In the dialog:
#   Path        : C:\Path\To\watcher\.venv\Scripts\python.exe
#   Startup dir : D:\Dashboard PMs WOs Events Claude made\watcher
#   Arguments   : main.py
nssm start COVE-Watcher
```

Logs end up in the Windows Event Log (or configure NSSM to redirect stdout to a file).
