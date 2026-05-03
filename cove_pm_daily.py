"""
COVE PM Daily Automation
========================

Daily workflow:
  1. Open the PM12 bookmark in Chrome (Playwright with persistent auth session)
  2. Sort by due date and download the CSV export
  3. Rename to "COVE PM12 YYYY-MM-DD.csv"
  4. Upload to the COVE folder in Google Drive
  5. Generate a local HTML dashboard pre-loaded with today's data

Setup (one-time):
  pip install playwright pandas google-api-python-client google-auth-oauthlib
  playwright install chromium

  Then run with --auth flag once to log into your CMMS through the
  Playwright browser. The session is saved to ./browser_state/ and reused
  on subsequent runs.

Usage:
  python cove_pm_daily.py --auth          # one-time interactive login
  python cove_pm_daily.py                 # daily automated run
  python cove_pm_daily.py --skip-download # use most recent CSV in ./downloads/
  python cove_pm_daily.py --skip-upload   # don't push to Drive (offline mode)

Configuration:
  Copy .env.example to .env and fill in:
    PM12_URL          - The bookmark URL (the page where Sort+Export live)
    DRIVE_FOLDER_ID   - The Google Drive folder ID for COVE
    GOOGLE_CREDS_JSON - Path to OAuth credentials JSON (see README)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
DOWNLOAD_DIR = SCRIPT_DIR / "downloads"
OUTPUT_DIR = SCRIPT_DIR / "output"
BROWSER_STATE_DIR = SCRIPT_DIR / "browser_state"
DASHBOARD_TEMPLATE = SCRIPT_DIR / "cove_pm_dashboard.html"

# Load .env if present (no python-dotenv dependency — keep this script light)
ENV_FILE = SCRIPT_DIR / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

PM12_URL = os.environ.get("PM12_URL", "")
DRIVE_FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID", "")
GOOGLE_CREDS_JSON = os.environ.get("GOOGLE_CREDS_JSON", "credentials.json")

# CSV column names — change here if the export schema changes
COL_DUE = "Due Date"
COL_NAME = "Name"
COL_STATUS = "Status"
COL_ASSIGNEE = "Assigned To"

# PM type taxonomy — priority order: first match wins
TYPE_ORDER = ["Major", "Filter Swap", "Test/Record", "Minor"]


# ---------------------------------------------------------------------------
# PM type classifier (mirrors the JS in the dashboard)
# ---------------------------------------------------------------------------
def classify_pm(name: str) -> str:
    if not name or not isinstance(name, str):
        return "Minor"
    n = name.lower()
    if "major" in n:
        return "Major"
    if "filter swap" in n or "filter replace" in n or "filter change" in n:
        return "Filter Swap"
    if any(k in n for k in ("gen test", "water test", "churn test", "water meter")):
        return "Test/Record"
    if re.search(r"\bspcc\b", n) or re.search(r"\bdep log\b", n):
        return "Test/Record"
    return "Minor"


# ---------------------------------------------------------------------------
# Stage 1: Download CSV via Playwright
# ---------------------------------------------------------------------------
def download_csv(auth_only: bool = False) -> Optional[Path]:
    """
    Open PM12 in Chromium with persistent auth, sort by due date, download CSV.
    Returns the renamed CSV path on success.

    NOTE: The selectors below are placeholders — every CMMS has different DOM
    structure. After running --auth once and logging in, you'll need to:
      1. Inspect the PM12 page to find the actual selectors for:
         - The "Due Date" column header (to click for sort)
         - The "Export to CSV" / "Download" button
      2. Update the SELECTORS dict below with what you find.

    For ServiceNow: the export is usually in the right-click context menu on
    the list, or under a "personalize" gear icon → Export → CSV.
    For Maximo: usually under the action menu (≡) → Download.
    For Fiix: typically a download icon at the top right of the work order list.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
        sys.exit(1)

    if not PM12_URL:
        print("ERROR: PM12_URL not set in .env")
        sys.exit(1)

    BROWSER_STATE_DIR.mkdir(exist_ok=True)
    DOWNLOAD_DIR.mkdir(exist_ok=True)

    # >>> CUSTOMIZE THESE SELECTORS FOR YOUR CMMS <<<
    SELECTORS = {
        "due_date_header": 'th:has-text("Due Date")',  # column header to click for sort
        "export_button": 'button:has-text("Export"), a:has-text("Export to CSV")',
        # Some apps need a confirmation dialog click after Export:
        "export_confirm": 'button:has-text("CSV")',
    }

    with sync_playwright() as p:
        # Persistent context = saved cookies/localStorage between runs
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_STATE_DIR),
            headless=not auth_only,  # show browser only during initial auth
            accept_downloads=True,
            viewport={"width": 1400, "height": 900},
        )
        page = context.new_page()
        page.goto(PM12_URL, wait_until="domcontentloaded")

        if auth_only:
            print("\n" + "=" * 60)
            print("AUTHENTICATION MODE")
            print("=" * 60)
            print("A browser window should be open. Log into PM12 manually.")
            print("Once you can see the PM list, press Enter here to save the session.")
            print("=" * 60)
            input("\nPress Enter when logged in: ")
            context.close()
            print("✓ Session saved to", BROWSER_STATE_DIR)
            return None

        # Wait for page to settle, then sort by due date
        page.wait_for_load_state("networkidle", timeout=30_000)

        try:
            # Click due date header twice to ensure ascending sort
            # (most CMMSes toggle: first click = asc, second = desc; we want asc)
            page.click(SELECTORS["due_date_header"])
            page.wait_for_timeout(800)
            # Verify sort direction here if needed — the second click may flip it
            # If your CMMS shows a sort indicator arrow, check it before clicking again
        except Exception as e:
            print(f"WARN: Could not click due date header ({e}). Continuing without explicit sort.")

        # Trigger CSV download
        with page.expect_download(timeout=30_000) as download_info:
            page.click(SELECTORS["export_button"])
            # Some apps need a follow-up dialog click:
            try:
                page.click(SELECTORS["export_confirm"], timeout=3000)
            except Exception:
                pass
        download = download_info.value

        # Save with our naming convention
        today_str = date.today().strftime("%Y-%m-%d")
        target_name = f"COVE PM12 {today_str}.csv"
        target_path = DOWNLOAD_DIR / target_name
        download.save_as(str(target_path))

        context.close()
        print(f"✓ Downloaded: {target_path}")
        return target_path


# ---------------------------------------------------------------------------
# Stage 2: Upload to Google Drive
# ---------------------------------------------------------------------------
def upload_to_drive(csv_path: Path) -> Optional[str]:
    """Upload CSV to the COVE folder in Drive. Returns file ID."""
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        print("ERROR: Google API libs missing. Run:")
        print("  pip install google-api-python-client google-auth-oauthlib")
        sys.exit(1)

    if not DRIVE_FOLDER_ID:
        print("ERROR: DRIVE_FOLDER_ID not set in .env")
        sys.exit(1)

    SCOPES = ["https://www.googleapis.com/auth/drive.file"]
    token_path = SCRIPT_DIR / "token.json"
    creds = None

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not Path(GOOGLE_CREDS_JSON).exists():
                print(f"ERROR: {GOOGLE_CREDS_JSON} not found.")
                print("  → Go to console.cloud.google.com")
                print("  → Create OAuth 2.0 Desktop credentials")
                print(f"  → Save the JSON as {GOOGLE_CREDS_JSON}")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(GOOGLE_CREDS_JSON, SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json())

    service = build("drive", "v3", credentials=creds)
    file_metadata = {"name": csv_path.name, "parents": [DRIVE_FOLDER_ID]}
    media = MediaFileUpload(str(csv_path), mimetype="text/csv")
    result = service.files().create(body=file_metadata, media_body=media, fields="id,webViewLink").execute()

    print(f"✓ Uploaded to Drive: {result.get('webViewLink', result['id'])}")
    return result["id"]


# ---------------------------------------------------------------------------
# Stage 3: Analyze + render dashboard
# ---------------------------------------------------------------------------
def analyze(csv_path: Path) -> dict:
    """Compute the three breakdowns. Returns a dict ready for templating."""
    df = pd.read_csv(csv_path)

    # Validate required columns
    required = [COL_DUE, COL_NAME, COL_STATUS, COL_ASSIGNEE]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"CSV missing required columns: {missing}")

    # Filter to open PMs
    status_lower = df[COL_STATUS].astype(str).str.lower()
    is_open = ~status_lower.str.contains("closed|complete|cancel", regex=True, na=False)
    df = df[is_open].copy()

    # Parse dates (MM/DD/YYYY) and types
    df["_due"] = pd.to_datetime(df[COL_DUE], format="%m/%d/%Y", errors="coerce")
    df = df[df["_due"].notna()].copy()
    df["_type"] = df[COL_NAME].apply(classify_pm)
    df["_assignee"] = df[COL_ASSIGNEE].fillna("Unassigned").astype(str).str.strip()
    df.loc[df["_assignee"] == "", "_assignee"] = "Unassigned"

    today = pd.Timestamp(date.today())
    two_weeks = today + pd.Timedelta(days=14)
    eom = pd.Timestamp(date.today().replace(day=1)) + pd.offsets.MonthEnd(0)
    eom = eom.replace(hour=23, minute=59, second=59)

    overdue = df[df["_due"] < today]
    due_2wk = df[df["_due"] <= two_weeks]
    due_eom = df[df["_due"] <= eom]

    def by_assignee(subset: pd.DataFrame) -> list:
        if subset.empty:
            return []
        pivot = subset.pivot_table(
            index="_assignee", columns="_type", values=COL_DUE,
            aggfunc="count", fill_value=0,
        )
        for t in TYPE_ORDER:
            if t not in pivot.columns:
                pivot[t] = 0
        pivot = pivot[TYPE_ORDER]
        pivot["total"] = pivot.sum(axis=1)
        pivot = pivot.sort_values("total", ascending=False)
        return [
            {"name": idx, **{t: int(row[t]) for t in TYPE_ORDER}, "total": int(row["total"])}
            for idx, row in pivot.iterrows()
        ]

    type_counts = {t: int((df["_type"] == t).sum()) for t in TYPE_ORDER}

    return {
        "generated_at": datetime.now().isoformat(),
        "today": today.strftime("%Y-%m-%d"),
        "cutoff_2wk": two_weeks.strftime("%Y-%m-%d"),
        "cutoff_eom": eom.strftime("%Y-%m-%d"),
        "total_open": int(len(df)),
        "total_rows": int(len(pd.read_csv(csv_path))),
        "overdue_count": int(len(overdue)),
        "due_2wk_count": int(len(due_2wk)),
        "due_eom_count": int(len(due_eom)),
        "by_assignee_2wk": by_assignee(due_2wk),
        "by_assignee_eom": by_assignee(due_eom),
        "type_counts": type_counts,
    }


def render_dashboard(csv_path: Path, output_path: Path) -> Path:
    """
    Generate a dashboard HTML file pre-loaded with the CSV.

    Implementation: we reuse the drag-drop dashboard template and inject the
    CSV content as a JS string, plus auto-trigger render() on load. This keeps
    the script's output visually identical to the manual tool.
    """
    if not DASHBOARD_TEMPLATE.exists():
        raise FileNotFoundError(
            f"Dashboard template not found: {DASHBOARD_TEMPLATE}\n"
            "Place cove_pm_dashboard.html in the same directory as this script."
        )

    template = DASHBOARD_TEMPLATE.read_text(encoding="utf-8")
    csv_text = csv_path.read_text(encoding="utf-8")

    # Inject auto-load script before </body>
    injected = (
        "<script>\n"
        "// Auto-loaded by cove_pm_daily.py\n"
        f"const __EMBEDDED_CSV__ = {repr(csv_text)};\n"
        f"const __EMBEDDED_FILENAME__ = {repr(csv_path.name)};\n"
        "window.addEventListener('DOMContentLoaded', () => {\n"
        "  const results = Papa.parse(__EMBEDDED_CSV__, { header: true, skipEmptyLines: true });\n"
        "  render(results.data, __EMBEDDED_FILENAME__);\n"
        "});\n"
        "</script>\n"
    )
    output_html = template.replace("</body>", injected + "</body>")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output_html, encoding="utf-8")
    print(f"✓ Dashboard rendered: {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--auth", action="store_true", help="One-time login flow for the CMMS")
    parser.add_argument("--skip-download", action="store_true", help="Use most recent CSV in ./downloads/")
    parser.add_argument("--skip-upload", action="store_true", help="Don't push to Google Drive")
    parser.add_argument("--csv", type=Path, help="Use a specific CSV file instead of downloading")
    args = parser.parse_args()

    if args.auth:
        download_csv(auth_only=True)
        return 0

    # Stage 1: get the CSV
    if args.csv:
        csv_path = args.csv
        if not csv_path.exists():
            print(f"ERROR: {csv_path} not found")
            return 1
    elif args.skip_download:
        csvs = sorted(DOWNLOAD_DIR.glob("COVE PM12 *.csv"), reverse=True)
        if not csvs:
            print(f"ERROR: No CSVs found in {DOWNLOAD_DIR}")
            return 1
        csv_path = csvs[0]
        print(f"Using most recent: {csv_path}")
    else:
        csv_path = download_csv()
        if not csv_path:
            return 1

    # Stage 2: upload (optional)
    if not args.skip_upload and not args.csv:
        try:
            upload_to_drive(csv_path)
        except Exception as e:
            print(f"WARN: Drive upload failed: {e}")
            print("Continuing with analysis...")

    # Stage 3: analyze + render
    summary = analyze(csv_path)
    print("\n--- Summary ---")
    print(f"Open PMs: {summary['total_open']} ({summary['overdue_count']} overdue)")
    print(f"Due in 2 weeks (through {summary['cutoff_2wk']}): {summary['due_2wk_count']}")
    print(f"Due by EOM    (through {summary['cutoff_eom']}): {summary['due_eom_count']}")
    print(f"Type breakdown: {summary['type_counts']}")
    print()

    today_str = date.today().strftime("%Y-%m-%d")
    output_path = OUTPUT_DIR / f"cove_pm_dashboard_{today_str}.html"
    render_dashboard(csv_path, output_path)

    print(f"\n✓ Open in browser: file://{output_path.absolute()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
