r"""Phase 6.4 — Plantlog auth session.

Stateless login wrapper for plantlog's JSESSIONID cookie auth. Each call to
`get_session_cookies()` runs a fresh `POST /plantlog/api/auth/signin` and
returns the resulting cookie dict, ready to pass to `requests.get(..., cookies=...)`.

Why stateless: Tomcat sessions are opaque (no parseable expiry) and idle out
silently. Re-logging in each poller run costs one extra HTTP request — 4
pollers × ~12 runs/day = ~48 logins/day, well below any reasonable rate limit.
Avoids file races, stale-session detection logic, and `last_modified_at` math.

Credentials live in `watcher/.env` as:
    PLANTLOG_BASE_URL=https://cwservices-bmrupark.plantlog.com
    PLANTLOG_USERNAME=...
    PLANTLOG_PASSWORD=...

CLI:
    .\.venv\Scripts\python.exe plantlog_session.py status   # verify creds work end-to-end
    .\.venv\Scripts\python.exe plantlog_session.py login    # print cookies (DO NOT paste publicly)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

DEFAULT_BASE_URL = "https://cwservices-bmrupark.plantlog.com"
SIGNIN_PATH = "/plantlog/api/auth/signin"
VERIFY_PATH = "/plantlog/api/users"  # small authenticated read

_BASE_HEADERS = {
    "Accept": "*/*",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    ),
}


class SessionError(RuntimeError):
    """Raised when login fails or credentials are missing."""


def _base_url() -> str:
    return os.environ.get("PLANTLOG_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def login(username: str | None = None, password: str | None = None) -> dict[str, str]:
    """POST credentials, return the cookie dict from the response."""
    username = username or os.environ.get("PLANTLOG_USERNAME", "").strip()
    password = password or os.environ.get("PLANTLOG_PASSWORD", "")
    if not username or not password:
        raise SessionError(
            "Missing PLANTLOG_USERNAME or PLANTLOG_PASSWORD in watcher/.env."
        )

    url = _base_url() + SIGNIN_PATH
    headers = dict(_BASE_HEADERS)
    headers["Content-Type"] = "application/json"
    headers["Origin"] = _base_url()
    headers["Referer"] = _base_url() + "/"

    try:
        resp = requests.post(
            url,
            headers=headers,
            json={"username": username, "password": password},
            timeout=30,
        )
    except requests.RequestException as e:
        raise SessionError(f"network error during signin: {e}") from e

    if resp.status_code != 200:
        raise SessionError(
            f"signin HTTP {resp.status_code}: {resp.text[:300]}"
        )

    cookies = {k: v for k, v in resp.cookies.items()}
    if "JSESSIONID" not in cookies:
        raise SessionError(
            f"signin returned 200 but no JSESSIONID; cookies={list(cookies.keys())}"
        )
    return cookies


def get_session_cookies() -> dict[str, str]:
    """Convenience for pollers: do a fresh login, return cookies."""
    return login()


def verify(cookies: dict[str, str] | None = None) -> bool:
    """Hit a known authenticated endpoint to confirm cookies actually work."""
    if cookies is None:
        cookies = login()
    url = _base_url() + VERIFY_PATH
    headers = dict(_BASE_HEADERS)
    headers["Accept"] = "application/json"
    headers["Referer"] = _base_url() + "/"
    resp = requests.get(url, cookies=cookies, headers=headers, timeout=30)
    return resp.status_code == 200


def _cli() -> int:
    parser = argparse.ArgumentParser(description="Plantlog session manager.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="Login + hit a read endpoint; print pass/fail.")
    sub.add_parser("login", help="Login and print the cookie dict (sensitive!).")

    args = parser.parse_args()
    try:
        if args.cmd == "status":
            cookies = login()
            ok = verify(cookies)
            print(f"login: ok")
            print(f"verify {VERIFY_PATH}: {'ok' if ok else 'FAILED'}")
            print(f"cookies set: {sorted(cookies.keys())}")
            return 0 if ok else 1
        elif args.cmd == "login":
            cookies = login()
            for k, v in cookies.items():
                print(f"{k}={v}")
            return 0
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
