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

## UPark Overtime API poller (`ot_api_poller.py`) — fallback only

Mirrors Steve's (BMR) OT viewer — the crew's Outlook off-hours events and
added OT jobs, with spaces and volunteers — into Supabase `ot_api_jobs`
every 5 minutes. Feeds §11b on `/upark/manager` and the overtime strip on
both wall screens (`/upark/tv`, `/upark/tv2`). Read-only: the API's write
endpoints are not used.

**In production this is done by the `ot-api-sync` edge function** (cron job
`ot-api-sync`, migration 0137) against the OT viewer's public hostname
`https://uparkot.rai-zenith.com`, with the key in the Vault
(`select set_app_secret('UPARK_OT_API_KEY', ...)`). Nothing to install.
This poller is the fallback for when the API is only reachable on Steve's
Tailscale network (`vpn-1.tail198a37.ts.net`): then it must run on a machine
on that tailnet, with the key in `watcher/.env` — never in the web app or a
commit. Both writers use the same tables and semantics, so running both is
harmless.

```ini
# watcher/.env
UPARK_OT_API_KEY=upot_...          # from the OT viewer ("copy it now")
# UPARK_OT_API_BASE=https://vpn-1.tail198a37.ts.net
# UPARK_OT_API_DAYS=14             # 1-90
```

Check reachability first (same curl as Steve's handoff), then install the
timer for your host:

```bash
curl -H "Authorization: Bearer $UPARK_OT_API_KEY" "https://vpn-1.tail198a37.ts.net/api/v1/ot?days=14"

sudo ./install_ot_api_poller_linux.sh      # Hetzner VM / Linux (systemd timer)
./install_ot_api_poller_mac.sh             # Mac (launchd)
.\install_ot_api_poller_task.ps1           # Windows (elevated PowerShell)
```

Verify in the SQL editor:

```sql
select fetched_at, status, job_count, error_msg from ot_api_syncs order by fetched_at desc limit 5;
select start_at, title, filled, spaces, status from ot_api_jobs order by start_at;
```

A failed poll (bad key, off the tailnet, 429 from polling too often) is
recorded as a `status='error'` row and the manager panel says "last poll
failed"; the previous mirror stays on screen.
