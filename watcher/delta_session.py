r"""Phase 7.0 - Delta enteliWEB session manager.

Manages the `enteliWebID` cookie + `_csrfToken` pair that every enteliWEB API
call requires. Unlike Cove (JWT with explicit exp) or plantlog (stateless
re-login each run), enteliWEB sessions are server-side opaque - we don't know
when they expire, we just discover it when a call comes back as either:
  - HTTP 401 / 403
  - HTTP 200 with the login page HTML in the body
  - JSON response with a known auth-failed shape

So this module caches the cookie+csrf to disk and only re-logs in on demand
when the daemon detects an auth failure mid-poll.

Login flow:
  1. GET /enteliweb/  -> server sets a fresh `enteliWebID` cookie (anonymous
     session) AND embeds the `_csrfToken` in the page HTML.
  2. Scrape the CSRF from HTML (multiple regex fallbacks; enteliWEB renders
     it in a JS bootstrap blob).
  3. POST /enteliweb/index/verify with base64(username) + base64(password)
     + the scraped CSRF. Server promotes the cookie to an authenticated
     session. Returns JSON {"message":"OK", ...}.
  4. Persist (cookie, csrf) to watcher/.delta_session.json.

Credentials in watcher/.env as plaintext:
    DELTA_BASE_URL=https://takedabms.albireoenergy.net
    DELTA_USERNAME=<plaintext>
    DELTA_PASSWORD=<plaintext>
The base64 encoding the SPA does is obfuscation, not auth - we re-do it at
request time. Never store the base64'd form on disk either.

CLI:
    .\.venv\Scripts\python.exe delta_session.py status
    .\.venv\Scripts\python.exe delta_session.py login    # force fresh login
    .\.venv\Scripts\python.exe delta_session.py verify   # use cached session
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

SESSION_PATH = HERE / ".delta_session.json"

DEFAULT_BASE_URL = "https://takedabms.albireoenergy.net"
INDEX_PATH = "/enteliweb/"
LOGIN_PATH = "/enteliweb/index/verify"
# Authenticated probe - if cookie + csrf are valid this returns JSON OK.
VERIFY_PATH = "/enteliweb/wsnotification/get"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/148.0.0.0 Safari/537.36"
)


# ---------- exceptions ----------

class SessionError(RuntimeError):
    """Login failed, creds missing, or session file unrecoverable."""


class AuthExpired(RuntimeError):
    """Cached session is no longer valid - caller should call relogin()."""


# ---------- config ----------

def _base_url() -> str:
    return os.environ.get("DELTA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _creds() -> tuple[str, str]:
    u = os.environ.get("DELTA_USERNAME", "").strip()
    p = os.environ.get("DELTA_PASSWORD", "")
    if not u or not p:
        raise SessionError(
            "Missing DELTA_USERNAME or DELTA_PASSWORD in watcher/.env."
        )
    return u, p


def _b64(s: str) -> str:
    return base64.b64encode(s.encode("utf-8")).decode("ascii")


# ---------- state I/O ----------

def _atomic_write(state: dict) -> None:
    tmp = SESSION_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, SESSION_PATH)


def load_state() -> dict | None:
    if not SESSION_PATH.exists():
        return None
    try:
        return json.loads(SESSION_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _persist(enteliweb_id: str, csrf: str, source: str) -> dict:
    state = {
        "enteliweb_id": enteliweb_id,
        "csrf_token": csrf,
        "minted_at": datetime.now(timezone.utc).isoformat(),
        "minted_from": source,
    }
    _atomic_write(state)
    return state


# ---------- CSRF scraping ----------

# enteliWEB renders the CSRF token into the landing page HTML as inline JS:
#   var _tokenName = "_csrfToken";
#   var _token     = "yc3tfdKGwFqIzsMEuI2AUGI70qKBFuETat5pyQw6hUs";
# The token allows base64-style characters (A-Za-z0-9 with no padding observed,
# but allow + / = for safety). Anchored to "var _token" to avoid matching e.g.
# a stray "token" elsewhere in the page.
_CSRF_PATTERNS = [
    re.compile(r'\bvar\s+_token\s*=\s*"([A-Za-z0-9+/=_-]+)"'),
    re.compile(r'\b_token\s*=\s*["\']([A-Za-z0-9+/=_-]+)["\']'),
    # Fallback patterns in case enteliWEB ever changes the embedding format.
    re.compile(r'"_csrfToken"\s*:\s*"([A-Za-z0-9+/=_-]+)"'),
    re.compile(r'name=["\']_csrfToken["\']\s+(?:content|value)=["\']([A-Za-z0-9+/=_-]+)["\']'),
]


def _scrape_csrf(html: str) -> str:
    for pat in _CSRF_PATTERNS:
        m = pat.search(html)
        if m:
            return m.group(1)
    raise SessionError(
        "Could not find _csrfToken in /enteliweb/ HTML. The login page format "
        "may have changed. First 500 chars of HTML follows:\n"
        f"{html[:500]}"
    )


# ---------- login ----------

def login() -> dict:
    """Run the full bootstrap-CSRF + verify flow. Returns persisted state."""
    username, password = _creds()
    base = _base_url()

    with requests.Session() as s:
        s.headers.update({"User-Agent": _UA, "Accept": "*/*"})

        # Step 1: prime the session, pick up the anonymous enteliWebID cookie
        # and the embedded CSRF.
        try:
            r1 = s.get(base + INDEX_PATH, timeout=30)
        except requests.RequestException as e:
            raise SessionError(f"network error fetching {INDEX_PATH}: {e}") from e
        if r1.status_code != 200:
            raise SessionError(f"GET {INDEX_PATH} returned HTTP {r1.status_code}")

        csrf = _scrape_csrf(r1.text)
        enteliweb_id = s.cookies.get("enteliWebID")
        if not enteliweb_id:
            raise SessionError(
                "Index page did not set enteliWebID cookie. "
                f"Cookies received: {list(s.cookies.keys())}"
            )

        # Step 2: POST login with base64-encoded creds.
        headers = {
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": base,
            "Referer": base + INDEX_PATH,
            "X-Requested-With": "XMLHttpRequest",
        }
        data = {
            "username": _b64(username),
            "password": _b64(password),
            "_csrfToken": csrf,
        }
        try:
            r2 = s.post(base + LOGIN_PATH, headers=headers, data=data, timeout=30)
        except requests.RequestException as e:
            raise SessionError(f"network error during login: {e}") from e

        if r2.status_code != 200:
            raise SessionError(
                f"POST {LOGIN_PATH} returned HTTP {r2.status_code}: {r2.text[:300]}"
            )

        # enteliWEB returns JSON on success:
        #   {"success": true, "msg": "OK", "lockoutMsg": "", ...}
        # Other API endpoints (e.g. wsnotification/get) use the {code:"OK"}
        # envelope - the login endpoint is the odd one out, hence the dual check.
        try:
            body = r2.json()
        except ValueError:
            raise SessionError(
                f"login returned non-JSON body (probable auth failure HTML): "
                f"{r2.text[:300]}"
            )
        ok_signal = (
            body.get("success") is True
            or str(body.get("code", "")).upper() in ("OK", "SUCCESS")
            or str(body.get("msg", "")).upper() == "OK"
        )
        if not ok_signal:
            raise SessionError(f"login JSON not OK: {body}")

        # After login the cookie may have been rotated to the authenticated one.
        enteliweb_id = s.cookies.get("enteliWebID") or enteliweb_id

        # Step 3: enteliWEB rotates the CSRF after promoting the session to
        # authenticated. The token we used for /verify is now stale - subsequent
        # API calls will get 403 "CSRF verification failed". Re-fetch the
        # landing page (now as authenticated) to pick up the post-login CSRF.
        try:
            r3 = s.get(base + INDEX_PATH, timeout=30)
        except requests.RequestException as e:
            raise SessionError(f"network error refetching {INDEX_PATH} post-login: {e}") from e
        if r3.status_code != 200:
            raise SessionError(f"post-login GET {INDEX_PATH} returned HTTP {r3.status_code}")
        csrf = _scrape_csrf(r3.text)
        enteliweb_id = s.cookies.get("enteliWebID") or enteliweb_id

    return _persist(enteliweb_id, csrf, source="login")


# ---------- request wrapper ----------

def _is_auth_failure(resp: requests.Response) -> bool:
    if resp.status_code in (401, 403):
        return True
    # Some enteliWEB endpoints respond 200 with a redirect-to-login HTML body
    # or with a JSON envelope whose code is not OK.
    ct = resp.headers.get("Content-Type", "")
    if "html" in ct.lower() and "<form" in resp.text.lower() and "password" in resp.text.lower():
        return True
    if "application/json" in ct.lower():
        try:
            j = resp.json()
        except ValueError:
            return False
        code = str(j.get("code", "")).upper()
        if code in ("NOT_AUTHORIZED", "NOTAUTHORIZED", "SESSION_EXPIRED", "AUTH_REQUIRED"):
            return True
    return False


def request(
    method: str,
    path: str,
    *,
    data: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30,
    state: dict | None = None,
    auto_relogin: bool = True,
) -> tuple[requests.Response, dict]:
    """Make an authenticated request. Returns (response, current_state).

    On auth failure: re-logs in once and retries. Raises SessionError if the
    retry also fails.
    """
    state = state or load_state() or login()
    base = _base_url()

    def _do(s: dict) -> requests.Response:
        merged_headers = {
            "User-Agent": _UA,
            "Accept": "*/*",
            "Origin": base,
            "Referer": base + INDEX_PATH,
            "X-Requested-With": "XMLHttpRequest",
        }
        if headers:
            merged_headers.update(headers)
        # enteliWEB needs the csrf in EVERY form post.
        body = dict(data) if data else None
        if body is not None and "_csrfToken" not in body:
            body["_csrfToken"] = s["csrf_token"]
            merged_headers.setdefault(
                "Content-Type",
                "application/x-www-form-urlencoded; charset=UTF-8",
            )
        cookies = {"enteliWebID": s["enteliweb_id"]}
        return requests.request(
            method,
            base + path,
            headers=merged_headers,
            cookies=cookies,
            data=body,
            params=params,
            timeout=timeout,
        )

    resp = _do(state)
    if _is_auth_failure(resp) and auto_relogin:
        state = login()
        resp = _do(state)
        if _is_auth_failure(resp):
            raise SessionError(
                f"Re-login succeeded but {path} still returns auth failure "
                f"(HTTP {resp.status_code}). Check that the account isn't locked."
            )
    return resp, state


# ---------- verify ----------

def verify(state: dict | None = None) -> bool:
    """Probe an authenticated endpoint with the cached session."""
    state = state or load_state()
    if not state:
        return False
    try:
        resp, _ = request(
            "POST", VERIFY_PATH,
            data={"lastIndex": 0, "maxResult": 1},
            state=state,
            auto_relogin=False,
        )
    except SessionError:
        return False
    return resp.status_code == 200 and not _is_auth_failure(resp)


# ---------- CLI ----------

def _cli() -> int:
    parser = argparse.ArgumentParser(description="Delta enteliWEB session manager.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="Show cached session info.")
    sub.add_parser("login", help="Run full login flow, persist new session.")
    sub.add_parser("verify", help="Hit a known endpoint with cached session.")

    args = parser.parse_args()
    try:
        if args.cmd == "status":
            s = load_state()
            if not s:
                print("no session file at", SESSION_PATH)
                return 1
            print(f"session_file:  {SESSION_PATH}")
            print(f"enteliweb_id:  {s.get('enteliweb_id', '')[:8]}...  (redacted)")
            print(f"csrf_token:    {s.get('csrf_token', '')[:8]}...  (redacted)")
            print(f"minted_at:     {s.get('minted_at')}")
            print(f"minted_from:   {s.get('minted_from')}")
            return 0
        if args.cmd == "login":
            s = login()
            print("login: ok")
            print(f"enteliweb_id: {s['enteliweb_id'][:8]}...")
            print(f"csrf:         {s['csrf_token'][:8]}...")
            return 0
        if args.cmd == "verify":
            ok = verify()
            print("verify:", "ok" if ok else "FAILED")
            return 0 if ok else 1
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
