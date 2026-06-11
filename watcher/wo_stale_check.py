"""Stale work order check + digest email.

Called at the tail of wo12_poller.main() after a successful ingest.
Reads v_wo_stale (open WOs whose last Cove update — updated_at_cmms,
falling back to submitted_date — is older than 7 days) and emails ONE
digest to ALERT_RECIPIENT listing the work orders that have NEWLY
crossed the threshold since the last alert.

Dedupe via wo_stale_alerts (migration 0079): UNIQUE(wo_id,
last_update_at) + INSERT ... claim. A WO alerts once per update-state —
if it gets touched in Cove and later goes stale again, the changed
updated_at_cmms forms a new key and it alerts again. Mirrors the
plantlog_compliance pattern.
"""
from __future__ import annotations

import os
import smtplib
import sys
from email.message import EmailMessage

ALERT_RECIPIENT = "jie.lao@cwservices.com"
STALE_DAYS = 7  # informational only — the 7d cutoff lives in v_wo_stale


def _try_claim(client, row: dict) -> bool:
    """Insert the dedupe row. True = this run should include the WO in
    the email; False = already alerted for this (wo_id, last_update_at)."""
    try:
        res = client.table("wo_stale_alerts").insert({
            "wo_id": row.get("wo_id"),
            "last_update_at": row.get("last_update_at"),
            "days_stale": row.get("days_stale"),
            "recipient": ALERT_RECIPIENT,
        }).execute()
        return bool(res.data)
    except Exception as e:
        msg = str(e)
        if "duplicate" in msg.lower() or "unique" in msg.lower() or "23505" in msg:
            return False
        print(f"WARN: failed to claim stale-WO alert ({row.get('wo_id')}): {e}",
              file=sys.stderr)
        return False


def _fmt_row(row: dict) -> str:
    wo = row.get("wo_id") or "?"
    bld = row.get("building_code") or "—"
    who = (row.get("assigned_to_name") or "(unassigned)").strip()
    days = row.get("days_stale")
    status = row.get("status") or "—"
    desc = (row.get("description") or "").strip().replace("\n", " ")
    if len(desc) > 90:
        desc = desc[:87] + "..."
    return f"  • {wo} · {bld} · {who} · {status} · {days}d since update — {desc}"


def _send_email(new_rows: list[dict], total_stale: int) -> None:
    user = os.environ.get("GMAIL_USER", "").strip()
    pw = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    if not user or not pw:
        print("WARN: GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping "
              "stale-WO email", file=sys.stderr)
        return

    subject = (f"[WO stale] {len(new_rows)} work order(s) crossed "
               f"{STALE_DAYS} days with no update")
    body_lines = [
        f"{len(new_rows)} open work order(s) just crossed {STALE_DAYS} days "
        f"without a Cove update:",
        "",
    ]
    body_lines.extend(_fmt_row(r) for r in new_rows)
    body_lines.extend([
        "",
        f"Total currently stale ({STALE_DAYS}d+): {total_stale} open WO(s).",
        "",
        ("Each WO alerts once per update-state — updating it in Cove "
         "resets its clock; if it goes stale again you'll get a fresh "
         "alert."),
        "",
        "— Dashboard WO12-Poller",
    ])
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = ALERT_RECIPIENT
    msg["Subject"] = subject
    msg.set_content("\n".join(body_lines))

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as s:
        s.starttls()
        s.login(user, pw)
        s.send_message(msg)
    print(f"[ok] sent stale-WO email to {ALERT_RECIPIENT}: "
          f"{len(new_rows)} new, {total_stale} total")


def run_stale_wo_check(client) -> None:
    """Entry point — called by wo12_poller after a successful ingest."""
    try:
        res = client.table("v_wo_stale").select("*").execute()
    except Exception as e:
        print(f"WARN: stale-WO query failed: {e}", file=sys.stderr)
        return

    stale = res.data or []
    if not stale:
        print("[ok] stale-WO check: none stale")
        return

    newly_claimed = [r for r in stale if _try_claim(client, r)]
    if not newly_claimed:
        print(f"[skip] stale-WO check: {len(stale)} stale, all already alerted")
        return

    # Oldest first so the most neglected WOs lead the email.
    newly_claimed.sort(key=lambda r: -(r.get("days_stale") or 0))
    try:
        _send_email(newly_claimed, total_stale=len(stale))
    except Exception as e:
        print(f"ERROR: stale-WO email send failed: {e}", file=sys.stderr)
