r"""Phase 5.0 probe — verify Cove's GQL accepts a date range that INCLUDES today.

The labor extension currently can't pull today's data because Cove's date picker
blocks today + future. This script bypasses the picker by hitting the GQL
endpoint directly. If it returns labor for today, we know we can build a real
hourly poller (Phase 5.1).

Reads COVE_AUTH_TOKEN + COVE_NETWORK_ID from watcher/.env.
Computes "this week's Monday at 00:00 America/New_York", converts to UTC,
sends GetWorkOrderAndPMTaskLaborReport with that as the GREATER_THAN bound,
prints the response.

Run (recommended — sidesteps PowerShell execution-policy blocks on Activate.ps1):
    cd watcher
    .\.venv\Scripts\python.exe -m pip install requests
    .\.venv\Scripts\python.exe labor_api_probe.py

If it works, expect output like:
    HTTP 200
    Window start (UTC): 2026-05-18T04:00:00.000Z
    Returned 12 items, totalValue=87.42
      Jorge Figueroa      14.50
      Anthony Velasquez    9.25
      ...

If you get HTTP 401: token expired — grab a fresh one from DevTools.
If you get HTTP 200 but 0 items: try widening the window (use LAST week's Mon)
to confirm the request is shaped correctly, then narrow back to verify "today".
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

TOKEN = os.environ.get("COVE_AUTH_TOKEN", "").strip()
COOKIE = os.environ.get("COVE_COOKIE", "").strip()
NETWORK_ID = os.environ.get("COVE_NETWORK_ID", "OoxMP8BZJF").strip()
GQL_URL = "https://api.cove.is/gql"
EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

if not TOKEN:
    print("ERROR: set COVE_AUTH_TOKEN in watcher/.env", file=sys.stderr)
    sys.exit(1)

# Belt and suspenders for common pasting mistakes:
#   1. User left the "Bearer " prefix on the value.
#   2. User pasted an example line with quotes, arrows, or comments.
#   3. .env was saved with a UTF-8 BOM or smart quotes.
# JWTs are strictly ASCII (base64url + 2 dots), so any non-ASCII byte means the
# value is corrupted.
if TOKEN.lower().startswith("bearer "):
    TOKEN = TOKEN[len("bearer "):].strip()
if TOKEN.startswith(("'", '"')) and TOKEN.endswith(("'", '"')):
    TOKEN = TOKEN[1:-1]
try:
    TOKEN.encode("ascii")
except UnicodeEncodeError as e:
    bad = e.object[e.start:e.end]
    print(
        f"ERROR: COVE_AUTH_TOKEN contains non-ASCII char {bad!r} (likely a "
        f"stray arrow/quote/emoji from a pasted example).\n"
        f"Open watcher/.env and replace the value with the raw JWT only — "
        f"no 'Bearer ' prefix, no quotes, no comments.",
        file=sys.stderr,
    )
    sys.exit(1)
if TOKEN.count(".") != 2:
    print(
        f"ERROR: COVE_AUTH_TOKEN doesn't look like a JWT (expected 2 dots, got "
        f"{TOKEN.count('.')}). Value starts with: {TOKEN[:12]!r}",
        file=sys.stderr,
    )
    sys.exit(1)


def _decode_jwt_payload(jwt: str) -> dict:
    """Best-effort decode of the middle segment. Returns {} on failure."""
    try:
        seg = jwt.split(".")[1]
        # JWTs use base64url; may omit padding.
        seg += "=" * ((4 - len(seg) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(seg))
    except Exception:
        return {}


_payload = _decode_jwt_payload(TOKEN)
_exp = _payload.get("exp")
if isinstance(_exp, (int, float)):
    _now = time.time()
    _human = datetime.fromtimestamp(_exp, tz=UTC).astimezone(EASTERN).strftime("%Y-%m-%d %H:%M %Z")
    if _exp < _now:
        print(
            f"ERROR: JWT expired at {_human} ({int(_now - _exp)}s ago). "
            f"Grab a fresh token from DevTools and update watcher/.env.",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"Token exp: {_human} ({int((_exp - _now) / 60)} min from now)")
else:
    print("Token: no exp claim found (can't tell if expired)")

# Same query string Cove's own dashboard sends. Whitespace preserved verbatim
# so the operation hash matches in case Cove ever switches to APQ.
QUERY = """
    query GetWorkOrderAndPMTaskLaborReport($filter: GQLFilterInput!, $page: GQLPageInput!, $sortDesc: Boolean!, $networkId: ID!) {
  siteNetwork(id: $networkId) {
    workOrderAndPMTaskLaborReport(
      metric: TOTAL_HOURS
      groupBy: PERFORMED_BY
      filter: $filter
      page: $page
      sortDesc: $sortDesc
    ) {
      items {
        label
        value
      }
      page {
        end
        start
        total
      }
      totalValue
    }
  }
}
    """


def _iso_utc(dt: datetime) -> str:
    """Format a tz-aware datetime as the milli-second ISO Z string Cove uses."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def this_week_monday_eastern_midnight_utc() -> str:
    now = datetime.now(EASTERN)
    days_since_monday = now.weekday()  # Mon=0, Sun=6
    monday = now - timedelta(days=days_since_monday)
    monday_midnight = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    return _iso_utc(monday_midnight)


def end_of_today_eastern_utc() -> str:
    """End of today in Eastern time, as a UTC ISO string. Cove's pattern: the
    last millisecond of the day, e.g. 2026-05-19T03:59:59.999Z = May 18 23:59:59.999 EDT."""
    now = datetime.now(EASTERN)
    eod = now.replace(hour=23, minute=59, second=59, microsecond=999000)
    return _iso_utc(eod)


def main() -> int:
    start = this_week_monday_eastern_midnight_utc()
    end = end_of_today_eastern_utc()
    print(f"Window: {start}  ->  {end}")
    print(f"NetworkId: {NETWORK_ID}")
    print()

    body = {
        "operationName": "GetWorkOrderAndPMTaskLaborReport",
        "query": QUERY,
        "variables": {
            "networkId": NETWORK_ID,
            "filter": {
                "items": [
                    {"field": "performedAt", "operator": "GREATER_THAN", "value": start},
                    {"field": "performedAt", "operator": "LESS_THAN",    "value": end},
                ],
            },
            # 500 so we capture every assignee even if the team grows.
            "page": {"limit": 500, "skip": 0},
            "sortDesc": True,
        },
    }

    # Cove uses a non-standard auth scheme: the Authorization header value is
    # the raw JWT, NOT "Bearer <jwt>". Verified by Copy-as-fetch from DevTools.
    headers = {
        "Authorization": TOKEN,
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://manage.cove.is",
        "Referer": "https://manage.cove.is/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
    }
    if COOKIE:
        headers["Cookie"] = COOKIE
        print(f"Cookie loaded: {len(COOKIE)} chars, starts {COOKIE[:25]!r}, ends {COOKIE[-25:]!r}")
    else:
        print("(no COVE_COOKIE in .env)")
    print(f"Token loaded: {len(TOKEN)} chars, starts {TOKEN[:20]!r}, ends {TOKEN[-20:]!r}")
    print()

    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)

    print(f"Response headers of note:")
    for k in ("x-request-id", "x-cove-trace", "cf-ray", "server", "www-authenticate"):
        v = resp.headers.get(k)
        if v:
            print(f"  {k}: {v}")

    print(f"HTTP {resp.status_code}")
    if resp.status_code == 401:
        print("Token expired or invalid. Grab a fresh JWT from DevTools.", file=sys.stderr)
        return 1
    if resp.status_code != 200:
        print(resp.text[:1500])
        return 1

    data = resp.json()
    if "errors" in data:
        print("GraphQL errors:")
        print(json.dumps(data["errors"], indent=2))
        # Surface the most common failure modes so we don't have to guess.
        msgs = " ".join(e.get("message", "") for e in data["errors"])
        if "Not Authenticated" in msgs or "Unauthorized" in msgs:
            print()
            print("Hints for 'Not Authenticated':")
            print("  1) Token may have expired — see the 'Token exp:' line above.")
            print("  2) Cove may require the cookie (not just the Bearer header).")
            print("     Capture the FULL Cookie header in DevTools (Headers tab,")
            print("     'Cookie' row) and add to watcher/.env as:")
            print("        COVE_COOKIE=cove_auth=...; cove_refresh=...")
            print("     Then re-run.")
        return 1

    report = (
        data.get("data", {})
        .get("siteNetwork", {})
        .get("workOrderAndPMTaskLaborReport", {})
    )
    items = report.get("items") or []
    total = report.get("totalValue")
    page = report.get("page") or {}

    print(f"Returned {len(items)} items, totalValue={total}")
    print(f"Page: start={page.get('start')} end={page.get('end')} total={page.get('total')}")
    print()
    for it in items:
        print(f"  {str(it.get('label') or ''):<30} {it.get('value')}")

    print()
    print("If totals look right for THIS WEEK including today's logged hours,")
    print("the API approach works and we can build Phase 5.1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
