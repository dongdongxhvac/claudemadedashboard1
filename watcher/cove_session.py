r"""Phase 5.7 — Cove auth session manager.

Replaces the static COVE_AUTH_TOKEN env var with a rotating session backed by
the `RefreshToken` GraphQL mutation. Each poller calls `get_fresh_token()`
once at the top of its run; we refresh transparently when the access JWT is
within `margin_hours` of expiry.

Session file: `watcher/cove_session.json` (gitignored, same directory as .env).
Shape:
    {
      "auth_token": "<JWT>",
      "refresh_token": "<JWT>",
      "auth_iat": <unix>,
      "auth_exp": <unix>,
      "refresh_iat": <unix>,
      "refresh_exp": <unix>,
      "last_refreshed_at": "2026-05-22T04:24:42+00:00",
      "last_refreshed_from": "auto" | "bootstrap" | "manual"
    }

Concurrency: simple — single-writer assumed. The three pollers don't run
concurrently in practice (Task Scheduler staggers them by minutes). Worst
case if they race: loser refreshes with a just-rotated token, fails, exits
non-zero, Task Scheduler retries next hour. Acceptable.

CLI for manual ops:
    .\.venv\Scripts\python.exe cove_session.py status     # show current session
    .\.venv\Scripts\python.exe cove_session.py refresh    # force refresh now
    .\.venv\Scripts\python.exe cove_session.py bootstrap  # one-time init from
                                                          # env vars or args
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
SESSION_PATH = HERE / "cove_session.json"
GQL_URL = "https://api.cove.is/gql"

REFRESH_MUTATION = (
    "mutation RefreshToken($token: String!) {\n"
    "  refreshToken(token: $token) {\n"
    "    authToken\n"
    "    expiresAt\n"
    "    refreshToken\n"
    "  }\n"
    "}"
)

_BASE_HEADERS = {
    "Accept": "*/*",
    "Content-Type": "application/json",
    "Origin": "https://manage.cove.is",
    "Referer": "https://manage.cove.is/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    ),
}


# ---------- JWT helpers ----------

def _decode_jwt_claims(jwt: str) -> dict:
    seg = jwt.split(".")[1]
    seg += "=" * ((4 - len(seg) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))


def _claim_pair(jwt: str) -> tuple[int, int]:
    c = _decode_jwt_claims(jwt)
    return int(c["iat"]), int(c["exp"])


# ---------- Session I/O ----------

class SessionError(RuntimeError):
    """Raised when the session can't be loaded, refreshed, or persisted."""


def _load_session_raw() -> dict:
    if not SESSION_PATH.exists():
        raise SessionError(
            f"No session file at {SESSION_PATH}. "
            f"Run `cove_session.py bootstrap` once to create it."
        )
    try:
        return json.loads(SESSION_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SessionError(f"Session file corrupt ({e}). Re-bootstrap.") from e


def _atomic_write(session: dict) -> None:
    tmp = SESSION_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(session, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, SESSION_PATH)


def _build_session(
    auth_token: str,
    refresh_token: str,
    source: str,
) -> dict:
    a_iat, a_exp = _claim_pair(auth_token)
    r_iat, r_exp = _claim_pair(refresh_token)
    return {
        "auth_token": auth_token,
        "refresh_token": refresh_token,
        "auth_iat": a_iat,
        "auth_exp": a_exp,
        "refresh_iat": r_iat,
        "refresh_exp": r_exp,
        "last_refreshed_at": datetime.now(timezone.utc).isoformat(),
        "last_refreshed_from": source,
    }


# ---------- Refresh ----------

def _call_refresh(refresh_token: str) -> tuple[str, str]:
    """Call Cove's RefreshToken mutation. Returns (new_auth, new_refresh)."""
    body = {
        "operationName": "RefreshToken",
        "query": REFRESH_MUTATION,
        "variables": {"token": refresh_token},
    }
    try:
        resp = requests.post(GQL_URL, headers=_BASE_HEADERS, json=body, timeout=30)
    except requests.RequestException as e:
        raise SessionError(f"network error during refresh: {e}") from e

    if resp.status_code != 200:
        raise SessionError(f"refresh HTTP {resp.status_code}: {resp.text[:500]}")

    try:
        data = resp.json()
    except ValueError as e:
        raise SessionError(f"refresh returned non-JSON: {resp.text[:500]}") from e

    if "errors" in data and data["errors"]:
        msgs = " | ".join(e.get("message", "") for e in data["errors"])
        hint = ""
        if "Session Expired" in msgs or "Not Authenticated" in msgs:
            hint = (
                " — refresh token is no longer valid. "
                "Re-capture cove_auth + cove_refresh from DevTools and run "
                "`cove_session.py bootstrap`."
            )
        raise SessionError(f"refresh GraphQL errors: {msgs}{hint}")

    inner = ((data.get("data") or {}).get("refreshToken") or {})
    new_auth = inner.get("authToken")
    new_refresh = inner.get("refreshToken")
    if not new_auth or not new_refresh:
        raise SessionError(f"refresh response missing tokens: {data}")
    return new_auth, new_refresh


def refresh_now(source: str = "manual") -> dict:
    """Force a refresh and persist the result. Returns the new session."""
    sess = _load_session_raw()
    new_auth, new_refresh = _call_refresh(sess["refresh_token"])
    new_sess = _build_session(new_auth, new_refresh, source=source)
    _atomic_write(new_sess)
    return new_sess


# ---------- Public API ----------

def get_fresh_token(margin_hours: float = 24.0) -> str:
    """Return a non-expired access JWT.

    Refreshes (and rotates the file) if the current access token will expire
    within `margin_hours`. The pollers should call this once at top-of-run.
    """
    sess = _load_session_raw()
    now = int(time.time())
    margin_s = int(margin_hours * 3600)

    if sess["refresh_exp"] - now < margin_s:
        # The refresh token itself is also close to expiry — alarming, but
        # technically we can still attempt a refresh which rotates both.
        # Surface it loudly via stderr so it shows up in Task Scheduler logs.
        print(
            f"WARN: refresh token expires in "
            f"{(sess['refresh_exp'] - now) / 3600:.1f}h "
            f"({datetime.fromtimestamp(sess['refresh_exp'], tz=timezone.utc).isoformat()}). "
            f"Will attempt refresh anyway — if it fails, re-bootstrap from DevTools.",
            file=sys.stderr,
        )

    if sess["auth_exp"] - now < margin_s:
        sess = refresh_now(source="auto")

    return sess["auth_token"]


def session_status() -> dict:
    """Snapshot of the current session — for CLI inspection."""
    sess = _load_session_raw()
    now = int(time.time())
    return {
        "auth_exp_iso":    datetime.fromtimestamp(sess["auth_exp"], tz=timezone.utc).isoformat(),
        "auth_remaining_h": round((sess["auth_exp"] - now) / 3600, 1),
        "refresh_exp_iso": datetime.fromtimestamp(sess["refresh_exp"], tz=timezone.utc).isoformat(),
        "refresh_remaining_d": round((sess["refresh_exp"] - now) / 86400, 1),
        "last_refreshed_at":   sess.get("last_refreshed_at"),
        "last_refreshed_from": sess.get("last_refreshed_from"),
    }


# ---------- Bootstrap ----------

def bootstrap(
    auth_token: str | None = None,
    refresh_token: str | None = None,
    overwrite: bool = False,
) -> dict:
    """One-time init: write the initial session file.

    Token sources (in order):
        1. Explicit args (used by the CLI when you paste fresh tokens)
        2. Env vars COVE_AUTH_TOKEN + COVE_REFRESH_TOKEN
        3. Fallback to env via load_dotenv on watcher/.env

    Raises if a session file already exists (unless overwrite=True).
    """
    if SESSION_PATH.exists() and not overwrite:
        raise SessionError(
            f"{SESSION_PATH} already exists. Pass overwrite=True (CLI: --force) "
            f"to replace."
        )

    if auth_token is None or refresh_token is None:
        load_dotenv(HERE / ".env")
        auth_token = auth_token or os.environ.get("COVE_AUTH_TOKEN", "").strip()
        refresh_token = refresh_token or os.environ.get("COVE_REFRESH_TOKEN", "").strip()

    if not auth_token or not refresh_token:
        raise SessionError(
            "Need both auth_token and refresh_token. Either pass them as args, "
            "or set COVE_AUTH_TOKEN and COVE_REFRESH_TOKEN in watcher/.env."
        )

    if auth_token.lower().startswith("bearer "):
        auth_token = auth_token[len("bearer "):].strip()
    if auth_token.count(".") != 2 or refresh_token.count(".") != 2:
        raise SessionError("One of the tokens is not a JWT (wrong dot count).")

    sess = _build_session(auth_token, refresh_token, source="bootstrap")
    _atomic_write(sess)
    return sess


# ---------- CLI ----------

def _cli() -> int:
    parser = argparse.ArgumentParser(description="Cove session manager.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Print current session status.")
    sub.add_parser("refresh", help="Force-refresh the access token now.")

    boot = sub.add_parser("bootstrap", help="Create session file from tokens.")
    boot.add_argument("--auth", help="Access JWT (else read from env).")
    boot.add_argument("--refresh", help="Refresh JWT (else read from env).")
    boot.add_argument("--force", action="store_true", help="Overwrite existing session file.")

    args = parser.parse_args()
    try:
        if args.cmd == "status":
            for k, v in session_status().items():
                print(f"{k}: {v}")
        elif args.cmd == "refresh":
            new = refresh_now(source="manual")
            print(f"refreshed; new auth exp = "
                  f"{datetime.fromtimestamp(new['auth_exp'], tz=timezone.utc).isoformat()}")
        elif args.cmd == "bootstrap":
            new = bootstrap(
                auth_token=args.auth,
                refresh_token=args.refresh,
                overwrite=args.force,
            )
            print(f"bootstrapped; auth exp = "
                  f"{datetime.fromtimestamp(new['auth_exp'], tz=timezone.utc).isoformat()}, "
                  f"refresh exp = "
                  f"{datetime.fromtimestamp(new['refresh_exp'], tz=timezone.utc).isoformat()}")
        return 0
    except SessionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(_cli())
