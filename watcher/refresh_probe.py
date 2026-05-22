r"""Phase 5.7 probe — discover Cove's JWT refresh mechanism.

Reads tokens from .probe_tokens.json (gitignored), runs several experiments,
prints findings. Does NOT mutate state.

Experiments:
  1. Decode both JWTs and print iat/exp + lifetime.
  2. Make a normal authed GQL request; print response Set-Cookie headers
     (does Cove silently rotate cove_auth on every authed call?).
  3. Make a GQL request with ONLY cove_refresh cookie (no Authorization,
     no cove_auth). Does Cove issue a fresh auth cookie just from refresh?
  4. Introspect the GQL schema for any mutations whose name mentions
     refresh / token / login (RefreshToken? RefreshAuth?).
  5. Try a few candidate refresh endpoints (POST /auth/refresh,
     /refresh, /token/refresh) with the refresh cookie and see what comes back.
"""
from __future__ import annotations

import base64
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
TOKENS = json.loads((HERE / ".probe_tokens.json").read_text(encoding="utf-8"))
AUTH = TOKENS["cove_auth"]
REFRESH = TOKENS["cove_refresh"]

GQL_URL = "https://api.cove.is/gql"
BASE_HEADERS = {
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


def decode_jwt(jwt: str) -> dict:
    seg = jwt.split(".")[1]
    seg += "=" * ((4 - len(seg) % 4) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))


def fmt_ts(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def banner(title: str) -> None:
    print(f"\n{'=' * 8} {title} {'=' * 8}")


def show_response(label: str, resp: requests.Response, body_lines: int = 12) -> None:
    print(f"--- {label} ---")
    print(f"  status: {resp.status_code}")
    set_cookies = resp.headers.get_list("Set-Cookie") if hasattr(resp.headers, "get_list") else resp.raw.headers.get_all("Set-Cookie") if hasattr(resp.raw.headers, "get_all") else None
    if not set_cookies:
        raw = resp.raw.headers if hasattr(resp.raw, "headers") else None
        if raw:
            try:
                set_cookies = raw.get_all("Set-Cookie")
            except Exception:
                set_cookies = None
    if set_cookies:
        for sc in set_cookies:
            print(f"  Set-Cookie: {sc}")
    else:
        sc = resp.headers.get("Set-Cookie")
        if sc:
            print(f"  Set-Cookie (single): {sc}")
        else:
            print("  Set-Cookie: <none>")
    text = resp.text or ""
    if len(text) > 1500:
        text = text[:1500] + f"\n  ...(truncated, total {len(text)} chars)"
    for ln in text.splitlines()[:body_lines]:
        print(f"  | {ln}")


# ---------- Experiment 1: JWT timing ----------

def exp1_jwt_timing() -> None:
    banner("EXP 1: JWT decode + timing")
    auth_claims = decode_jwt(AUTH)
    refresh_claims = decode_jwt(REFRESH)
    now = int(time.time())
    print("cove_auth claims:")
    for k, v in auth_claims.items():
        print(f"  {k}: {v}")
    print(f"  -> iat:  {fmt_ts(auth_claims['iat'])}")
    print(f"  -> exp:  {fmt_ts(auth_claims['exp'])}")
    print(f"  -> now:  {fmt_ts(now)}")
    print(f"  -> remaining: {(auth_claims['exp'] - now) / 3600:.1f}h")
    print("cove_refresh claims:")
    for k, v in refresh_claims.items():
        print(f"  {k}: {v}")
    print(f"  -> iat:  {fmt_ts(refresh_claims['iat'])}")
    print(f"  -> exp:  {fmt_ts(refresh_claims['exp'])}")
    print(f"  -> lifetime: {(refresh_claims['exp'] - refresh_claims['iat']) / 86400:.1f} days")


# ---------- Experiment 2: normal authed request, check Set-Cookie ----------

def exp2_normal_request() -> None:
    banner("EXP 2: normal authed GQL request (check Set-Cookie rotation)")
    headers = dict(BASE_HEADERS)
    headers["Authorization"] = AUTH
    headers["Cookie"] = f"cove_auth={AUTH}; cove_refresh={REFRESH}"
    body = {
        "operationName": "GetWorkOrdersCount",
        "query": (
            "query GetWorkOrdersCount($networkId: ID!, $filter: GQLFilterInput) {\n"
            "  siteNetwork(id: $networkId) {\n"
            "    workOrders(filter: $filter) {\n"
            "      page { total }\n"
            "    }\n"
            "  }\n"
            "}"
        ),
        "variables": {
            "networkId": "OoxMP8BZJF",
            "filter": {"items": [{"field": "status", "operator": "CONTAINED_IN", "value": ["done"]}]},
        },
    }
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    show_response("authed POST /gql", resp)


# ---------- Experiment 3: refresh-cookie-only request ----------

def exp3_refresh_cookie_only() -> None:
    banner("EXP 3: GQL request with ONLY cove_refresh cookie (no Authorization)")
    headers = dict(BASE_HEADERS)
    headers["Cookie"] = f"cove_refresh={REFRESH}"
    body = {
        "operationName": "GetWorkOrdersCount",
        "query": (
            "query GetWorkOrdersCount($networkId: ID!, $filter: GQLFilterInput) {\n"
            "  siteNetwork(id: $networkId) {\n"
            "    workOrders(filter: $filter) {\n"
            "      page { total }\n"
            "    }\n"
            "  }\n"
            "}"
        ),
        "variables": {
            "networkId": "OoxMP8BZJF",
            "filter": {"items": [{"field": "status", "operator": "CONTAINED_IN", "value": ["done"]}]},
        },
    }
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    show_response("refresh-only POST /gql", resp)


# ---------- Experiment 4: introspect for refresh mutation ----------

def exp4_introspect() -> None:
    banner("EXP 4: GQL introspection — list mutations matching refresh/token/login/auth")
    headers = dict(BASE_HEADERS)
    headers["Authorization"] = AUTH
    headers["Cookie"] = f"cove_auth={AUTH}; cove_refresh={REFRESH}"
    body = {
        "query": (
            "{ __schema { mutationType { fields { name description args { name type { name kind ofType { name kind } } } } } "
            "queryType { fields { name } } } }"
        )
    }
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    if resp.status_code != 200:
        show_response("introspection", resp)
        return
    try:
        data = resp.json()
    except Exception:
        show_response("introspection (non-json)", resp)
        return
    if "errors" in data:
        print(f"  introspection errors: {data['errors']}")
        if "data" not in data or not data["data"]:
            return
    schema = (data.get("data") or {}).get("__schema") or {}
    mutations = ((schema.get("mutationType") or {}).get("fields") or [])
    queries = ((schema.get("queryType") or {}).get("fields") or [])
    needles = ("refresh", "token", "login", "auth", "session")
    print(f"  total mutations: {len(mutations)}, total queries: {len(queries)}")
    print("  --- mutations matching needles ---")
    hit = 0
    for f in mutations:
        name = (f.get("name") or "")
        if any(n in name.lower() for n in needles):
            hit += 1
            args = ", ".join(
                f"{a['name']}: {(a['type'] or {}).get('name') or (a['type'] or {}).get('kind')}"
                for a in (f.get("args") or [])
            )
            print(f"    mutation {name}({args})")
    if not hit:
        print("    <none>")
    print("  --- queries matching needles ---")
    hit = 0
    for f in queries:
        name = (f.get("name") or "")
        if any(n in name.lower() for n in needles):
            hit += 1
            print(f"    query {name}")
    if not hit:
        print("    <none>")


# ---------- Experiment 5: candidate REST refresh endpoints ----------

def exp5_rest_candidates() -> None:
    banner("EXP 5: probe candidate REST refresh endpoints")
    candidates = [
        "https://api.cove.is/auth/refresh",
        "https://api.cove.is/auth/token",
        "https://api.cove.is/refresh",
        "https://api.cove.is/token/refresh",
        "https://api.cove.is/v1/auth/refresh",
        "https://api.cove.is/api/auth/refresh",
        "https://manage.cove.is/api/auth/refresh",
    ]
    for url in candidates:
        headers = dict(BASE_HEADERS)
        headers["Cookie"] = f"cove_auth={AUTH}; cove_refresh={REFRESH}"
        try:
            resp = requests.post(url, headers=headers, json={}, timeout=15)
        except requests.RequestException as e:
            print(f"  POST {url} -> error: {e}")
            continue
        sc = resp.headers.get("Set-Cookie")
        snippet = (resp.text or "")[:200].replace("\n", " ")
        print(f"  POST {url} -> {resp.status_code}  set-cookie={'yes' if sc else 'no'}  body={snippet!r}")


def exp6_refresh_mutation() -> None:
    banner("EXP 6: call RefreshToken mutation (the real deal)")
    headers = dict(BASE_HEADERS)
    # No Authorization header — the mutation takes the refresh token as an arg.
    body = {
        "operationName": "RefreshToken",
        "query": (
            "mutation RefreshToken($token: String!) {\n"
            "  refreshToken(token: $token) {\n"
            "    authToken\n"
            "    expiresAt\n"
            "    refreshToken\n"
            "  }\n"
            "}"
        ),
        "variables": {"token": REFRESH},
    }
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    show_response("RefreshToken (no auth header)", resp)

    print("\n  -- Now retry with Authorization header AND cookies, in case Cove gates it --")
    headers2 = dict(BASE_HEADERS)
    headers2["Authorization"] = AUTH
    headers2["Cookie"] = f"cove_auth={AUTH}; cove_refresh={REFRESH}"
    resp2 = requests.post(GQL_URL, headers=headers2, json=body, timeout=30)
    show_response("RefreshToken (with full auth context)", resp2)

    # If we got a new auth token, decode it and confirm timing
    try:
        data = resp2.json()
        new_auth = ((data.get("data") or {}).get("refreshToken") or {}).get("authToken")
        if new_auth:
            claims = decode_jwt(new_auth)
            now = int(time.time())
            print(f"\n  NEW authToken decoded:")
            print(f"    iat: {fmt_ts(claims['iat'])}")
            print(f"    exp: {fmt_ts(claims['exp'])}")
            print(f"    valid for: {(claims['exp'] - now) / 3600:.1f}h")
            print(f"    is NEW? {new_auth != AUTH}")
    except Exception as e:
        print(f"  (decode failed: {e})")


def main() -> int:
    print(f"Probe run at {datetime.now(timezone.utc).isoformat()}")
    exp1_jwt_timing()
    exp2_normal_request()
    exp3_refresh_cookie_only()
    exp4_introspect()
    exp5_rest_candidates()
    exp6_refresh_mutation()
    return 0


if __name__ == "__main__":
    sys.exit(main())
