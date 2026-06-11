"""Seed Gmail SMTP credentials into Supabase Vault for the email-report
edge function.

Run this YOURSELF (it moves a real credential, so the AI assistant is
intentionally not allowed to run it for you):

    cd "D:\\Dashboard PMs WOs Events Claude made\\watcher"
    .venv\\Scripts\\python.exe seed_email_secrets.py

Reads GMAIL_USER / GMAIL_APP_PASSWORD from watcher/.env (already present
for the compliance-alert emails) and stores them in Supabase Vault via
the service-role-only set_app_secret RPC (migration 0078). Values travel
over TLS and are never printed.

The email-report function checks edge-function env secrets first, then
falls back to Vault — so running this once makes the Water Billing
"Email report" button work with no dashboard steps.
"""
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

URL = os.environ["SUPABASE_URL"]
SVC = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
HDRS = {"apikey": SVC, "Authorization": f"Bearer {SVC}", "Content-Type": "application/json"}


def main() -> int:
    for key in ("GMAIL_USER", "GMAIL_APP_PASSWORD"):
        value = os.environ.get(key)
        if not value:
            print(f"FAIL: {key} missing from watcher/.env")
            return 1
        r = requests.post(f"{URL}/rest/v1/rpc/set_app_secret",
                          headers=HDRS, json={"k": key, "v": value})
        if r.status_code >= 300:
            print(f"FAIL: set {key} -> {r.status_code} {r.text[:200]}")
            return 1
        print(f"ok: {key} stored in Vault")

    # Presence round-trip (never prints the secret itself).
    r = requests.post(f"{URL}/rest/v1/rpc/get_app_secret",
                      headers=HDRS, json={"k": "GMAIL_APP_PASSWORD"})
    if r.status_code == 200 and r.json():
        print("ok: round-trip verified — the Email report button should work now")
        return 0
    print(f"WARN: round-trip check failed ({r.status_code}) — try the dashboard route")
    return 1


if __name__ == "__main__":
    sys.exit(main())
