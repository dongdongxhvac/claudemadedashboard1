r"""Phase 12 — OnTheClock auth session manager.

OnTheClock uses OAuth2/OIDC via auth.ontheclock.com → app.ontheclock.com with
PKCE, so a clean username/password POST isn't viable for headless re-auth.
Instead we cache the SPA's session cookies in a local JSON file and let the
human re-capture them via DevTools when they expire (typically every few
weeks).

Session file: `watcher/ontheclock_session.json` (gitignored).
Shape:
    {
      "account_id": "XMWwQxwMGD",
      "cookies": {
        "__Host-AppAuth": "...",
        "MainRole": "...",
        ...
      },
      "last_captured_at": "2026-05-26T10:30:00+00:00"
    }

The poller reads these cookies into a requests session each run. If they
expire, the next poll will get a 401/302 and exit non-zero; Task Scheduler
will surface that in the History tab and the user re-captures via:

    .\.venv\Scripts\python.exe ontheclock_session.py bootstrap --curl-file path/to/curl.txt
    .\.venv\Scripts\python.exe ontheclock_session.py status

CLI:
    bootstrap   parse a saved 'Copy as cURL' file and save the cookie dict
    status      hit a known authenticated endpoint and report ok/fail
    show        print the current session (sensitive — don't paste publicly)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
SESSION_PATH = HERE / "ontheclock_session.json"

# Cookies we actually need for an authenticated request. Other cookies in the
# curl (Google Analytics, Stripe, HubSpot, reb2b, etc.) are tracking junk.
REQUIRED_COOKIES = ["__Host-AppAuth"]
USEFUL_COOKIES = [
    "__Host-AppAuth",
    "MainRole",
    "SessionDeviceId",
    "DeviceID",
    "bct",
]

# A small read endpoint used to verify the session is still alive. Path is
# templated on the account_id pulled from the session file.
VERIFY_PATH_TMPL = "/api/accounts/{account_id}/timeclock-settings/bff"
BASE_URL = "https://app.ontheclock.com"

_BASE_HEADERS = {
    "Accept": "*/*",
    "Content-Type": "application/json",
    "Origin": "https://app.ontheclock.com",
    "Referer": "https://app.ontheclock.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    ),
    "x-csrf": "1",
}


class SessionError(RuntimeError):
    """Raised when the session file is missing, malformed, or expired."""


# ---------- Session file ----------

def load_session() -> dict:
    if not SESSION_PATH.exists():
        raise SessionError(
            f"{SESSION_PATH.name} not found. Run "
            f"`ontheclock_session.py bootstrap --curl-file <file>` first."
        )
    try:
        data = json.loads(SESSION_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SessionError(f"{SESSION_PATH.name} is not valid JSON: {e}") from e
    if "cookies" not in data or "account_id" not in data:
        raise SessionError(
            f"{SESSION_PATH.name} missing required keys (need 'cookies' and 'account_id')."
        )
    return data


def save_session(account_id: str, cookies: dict[str, str]) -> None:
    payload = {
        "account_id": account_id,
        "cookies": cookies,
        "last_captured_at": datetime.now(timezone.utc).isoformat(),
    }
    SESSION_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def get_cookies() -> dict[str, str]:
    """Convenience for pollers: return the cookie dict from the session file."""
    return load_session()["cookies"]


def get_account_id() -> str:
    return load_session()["account_id"]


# ---------- cURL parsing ----------

# URL: accept single quotes, double quotes, or unquoted (Windows curl uses
# double quotes; bash curl uses single quotes; raw URLs lack quotes entirely).
_CURL_URL_RE = re.compile(
    r"""curl\s+(?:['"](https?://[^'"]+)['"]|(https?://\S+))""",
    re.IGNORECASE,
)
# Cookies: -b 'val' or -b "val" or --cookie 'val'
_CURL_COOKIE_RE = re.compile(
    r"""(?:^|\s)(?:-b|--cookie)\s+(?:'([^']+)'|"([^"]+)")""",
)
# Any URL fragment that contains /api/accounts/{id}/, which we use as the
# fallback when the captured curl is a non-API request but has the account
# in its referer header.
_ACCOUNT_ID_RE = re.compile(r"/api/accounts/([A-Za-z0-9_-]+)/")


def parse_curl(text: str) -> tuple[str, dict[str, str]]:
    """Pull account_id + cookies out of a 'Copy as cURL' blob.
    Tolerates bash (single-quoted), Windows (double-quoted), and unquoted
    forms. Also accepts smart quotes if notepad autocorrected them."""
    # Normalize smart quotes that notepad/Word sometimes inserts.
    text = text.replace("‘", "'").replace("’", "'")
    text = text.replace("“", '"').replace("”", '"')

    if not text.strip():
        raise SessionError(
            "Input file is empty. Did you paste + save the curl in notepad?"
        )
    if "curl" not in text.lower():
        raise SessionError(
            "No 'curl' command found in the input. Make sure you saved the file "
            "with the entire 'curl ...' block in it."
        )

    m_url = _CURL_URL_RE.search(text)
    if not m_url:
        raise SessionError(
            "Could not find a URL after 'curl '. "
            "Expected: curl 'https://...' or curl \"https://...\"."
        )
    url = m_url.group(1) or m_url.group(2)

    m_acct = _ACCOUNT_ID_RE.search(url)
    if not m_acct:
        # Maybe the URL was /bff/user or similar — try the referer header (both quote styles)
        m_ref = re.search(r"""referer:\s*['"]([^'"]+)['"]""", text, re.IGNORECASE)
        if m_ref:
            m_acct = _ACCOUNT_ID_RE.search(m_ref.group(1))
    if not m_acct:
        raise SessionError(
            "Could not find an /api/accounts/{id}/... segment in the URL or referer. "
            "Capture a curl from a request to https://app.ontheclock.com/api/accounts/.../..."
        )
    account_id = m_acct.group(1)

    m_cookies = _CURL_COOKIE_RE.search(text)
    if not m_cookies:
        raise SessionError(
            "Could not find a -b '<cookies>' arg in the input. "
            "Make sure the captured curl was 'Copy as cURL (bash)' from a logged-in session."
        )
    cookie_str = m_cookies.group(1) or m_cookies.group(2)

    cookies: dict[str, str] = {}
    for piece in cookie_str.split(";"):
        piece = piece.strip()
        if not piece or "=" not in piece:
            continue
        k, v = piece.split("=", 1)
        k = k.strip()
        v = v.strip()
        if k in USEFUL_COOKIES:
            cookies[k] = v

    missing = [c for c in REQUIRED_COOKIES if c not in cookies]
    if missing:
        raise SessionError(
            f"Cookie input is missing required keys: {missing}. "
            f"Make sure the captured curl is from a logged-in session."
        )
    return account_id, cookies


# ---------- HTTP verify ----------

def verify(cookies: dict[str, str] | None = None, account_id: str | None = None) -> bool:
    """Hit a known-good endpoint with the captured cookies; True = session alive."""
    if cookies is None or account_id is None:
        data = load_session()
        cookies = data["cookies"]
        account_id = data["account_id"]
    url = BASE_URL + VERIFY_PATH_TMPL.format(account_id=account_id)
    try:
        resp = requests.get(url, headers=_BASE_HEADERS, cookies=cookies, timeout=30, allow_redirects=False)
    except requests.RequestException:
        return False
    # 200 = ok, 302/401/403 = expired session
    return resp.status_code == 200


def base_headers() -> dict[str, str]:
    """Headers shared by every authenticated OnTheClock API request."""
    return dict(_BASE_HEADERS)


# ---------- CLI ----------

def _cli() -> int:
    parser = argparse.ArgumentParser(description="OnTheClock session manager.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_boot = sub.add_parser("bootstrap", help="Parse a saved curl blob into the session file.")
    p_boot.add_argument("--curl-file", required=True, help="Path to a text file containing the 'Copy as cURL (bash)' output.")

    sub.add_parser("status", help="Verify the current session works.")
    sub.add_parser("show",   help="Print the saved session JSON (sensitive!).")

    args = parser.parse_args()

    try:
        if args.cmd == "bootstrap":
            text = Path(args.curl_file).read_text(encoding="utf-8")
            account_id, cookies = parse_curl(text)
            save_session(account_id, cookies)
            print(f"saved {SESSION_PATH.name}")
            print(f"account_id: {account_id}")
            print(f"cookies: {sorted(cookies.keys())}")
            ok = verify(cookies, account_id)
            print(f"verify: {'ok' if ok else 'FAILED (session may be expired)'}")
            return 0 if ok else 2

        elif args.cmd == "status":
            data = load_session()
            ok = verify(data["cookies"], data["account_id"])
            print(f"account_id: {data['account_id']}")
            print(f"last_captured_at: {data.get('last_captured_at', '?')}")
            print(f"verify: {'ok' if ok else 'FAILED (re-capture cookies via bootstrap)'}")
            return 0 if ok else 1

        elif args.cmd == "show":
            print(SESSION_PATH.read_text(encoding="utf-8"))
            return 0

    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
