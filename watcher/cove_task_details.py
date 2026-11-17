"""
cove_task_details.py — pull checklist + attachments for Cove PM tasks into Supabase.

Runs on the VM next to pm12_poller.py. Two modes:
    python cove_task_details.py backfill          # drain v_pm_task_details_backlog
    python cove_task_details.py fetch NxkLXNJUkR   # one task, print normalized row

Auth: reuses whatever session pm12_poller already has. Pass a requests.Session that
carries the cove_manage_auth cookie. Standalone runs take COVE_AUTH_COOKIE if set,
else the pollers' rotating session (cove_session.get_fresh_token) and watcher/.env.

Env:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
    COVE_AUTH_COOKIE   (optional, standalone only) value of cove_manage_auth cookie
    COVE_RATE_SLEEP    (optional) seconds between task fetches, default 0.5
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

import requests
from supabase import create_client

GQL_URL = "https://api.cove.is/gql"
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".heic", ".webp")

# Trimmed from the browser's GetPMTaskDetails — only what the audit needs.
QUERY = """
query GetPMTaskAudit($id: ID!) {
  pmTask(id: $id) {
    id altId name templateName status dueDate createdAt updatedAt
    estimatedHours hoursLogged answers
    category { name }
    assignee { id firstName lastName }
    equipment { id name category { name } building { name } }
    steps { description type value }
    attachments { name url uploadedAt isInternalVisibility }
    history {
      id eventType createdAt status note
      invokedBy { id firstName lastName }
      attachments { name url }
      laborItem { hours performedAt performedBy { id firstName lastName } }
    }
  }
}
"""


# ---------- Cove ----------

def make_session(cookie: str | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "accept": "*/*",
        "content-type": "application/json",
        "referer": "https://manage.cove.is/",
        "origin": "https://manage.cove.is",
    })
    cookie = cookie or os.getenv("COVE_AUTH_COOKIE")
    if cookie:
        s.cookies.set("cove_manage_auth", cookie, domain="api.cove.is")
    return s


def fetch_task(session: requests.Session, cove_task_id: str) -> dict:
    r = session.post(
        GQL_URL,
        json={"query": QUERY, "variables": {"id": cove_task_id},
              "operationName": "GetPMTaskAudit"},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(f"{cove_task_id}: {body['errors']}")
    task = body["data"]["pmTask"]
    if task is None:
        raise RuntimeError(f"{cove_task_id}: pmTask returned null (deleted or no access)")
    return task


# ---------- normalize ----------

def _name(u: dict | None) -> str | None:
    if not u:
        return None
    return f"{u.get('firstName', '')} {u.get('lastName', '')}".strip() or None


def _ts(s: str | None) -> str | None:
    return s  # Cove already returns ISO-8601 Z; Postgres parses it directly


def normalize(t: dict) -> dict:
    hist = t.get("history") or []
    hist_sorted = sorted(hist, key=lambda h: h.get("createdAt") or "")

    opened = next((h for h in hist_sorted if h.get("eventType") == "opened"), None)
    started = next((h for h in hist_sorted
                    if h.get("eventType") == "status_changed" and h.get("status") == "in_progress"), None)
    completed = next((h for h in reversed(hist_sorted)
                      if h.get("eventType") == "status_changed" and h.get("status") == "completed"), None)

    # attachments: task-level list is canonical; history tells us who uploaded
    uploader_by_name: dict[str, str | None] = {}
    for h in hist_sorted:
        if h.get("eventType") == "attachment_added":
            for a in h.get("attachments") or []:
                uploader_by_name[a["name"]] = _name(h.get("invokedBy"))

    atts = []
    for a in t.get("attachments") or []:
        atts.append({
            "name": a["name"],
            "url": a["url"],
            "uploadedAt": a.get("uploadedAt"),
            "uploadedBy": uploader_by_name.get(a["name"]),
            "internal": a.get("isInternalVisibility"),
        })
    att_times = sorted(a["uploadedAt"] for a in atts if a.get("uploadedAt"))
    photos = [a for a in atts if a["name"].lower().endswith(PHOTO_EXT)]

    steps = t.get("steps") or []
    checked = sum(
        1 for s in steps
        if (s.get("type") == "check_box" and s.get("value") is True)
        or (s.get("type") != "check_box" and s.get("value") not in (None, "", False))
    )

    # notes: every place a tech can write text on the task, deduped by content.
    #   - history note_added events (any number, during the task)
    #   - the note on the completed event (the "close" box)
    #   - text-type steps (template sections like "Important Notes")
    # Cove copies the close-box text onto both the note_added and completed
    # events, so identical text is kept once.
    notes: list[dict] = []
    seen: set[str] = set()

    def _add(text, at, by, source):
        txt = (text or "").strip()
        key = " ".join(txt.lower().split())
        if not txt or key in seen:
            return
        seen.add(key)
        notes.append({"at": at, "by": by, "text": txt, "source": source})

    for h in hist_sorted:
        if h.get("eventType") == "note_added":
            _add(h.get("note"), h.get("createdAt"), _name(h.get("invokedBy")), "note_added")
    if completed:
        _add(completed.get("note"), completed.get("createdAt"), _name(completed.get("invokedBy")), "completed")
    for s in steps:
        if s.get("type") != "check_box" and isinstance(s.get("value"), str):
            _add(s["value"], None, None, f"step:{(s.get('description') or '')[:40]}")

    close_note_all = "\n".join(n["text"] for n in notes) or None

    eq = t.get("equipment") or {}
    return {
        "cove_task_id": t["id"],
        "task_no": t["altId"],
        "task_name": t.get("name"),
        "template_name": t.get("templateName"),
        "category": (t.get("category") or {}).get("name"),
        "status": t.get("status"),
        "equipment_id": eq.get("id"),
        "equipment_name": eq.get("name"),
        "equipment_category": (eq.get("category") or {}).get("name"),
        "building_name": (eq.get("building") or {}).get("name"),
        "assignee_id": (t.get("assignee") or {}).get("id"),
        "assignee_name": _name(t.get("assignee")),
        "due_date": (t.get("dueDate") or "")[:10] or None,
        "opened_at": _ts(opened and opened.get("createdAt")),
        "started_at": _ts(started and started.get("createdAt")),
        "completed_at": _ts(completed and completed.get("createdAt")),
        "completed_by": _name(completed and completed.get("invokedBy")),
        "close_note": close_note_all,        # combined text of every note (audit judges the whole thing)
        "notes": notes,                      # [{at, by, text, source}]
        "note_count": len(notes),
        "labor_hours": t.get("hoursLogged"),
        "est_labor_hours": t.get("estimatedHours"),
        "steps_total": len(steps),
        "steps_checked": checked,
        "steps": steps,
        "attachment_count": len(atts),
        "photo_count": len(photos),
        "first_attachment_at": att_times[0] if att_times else None,
        "last_attachment_at": att_times[-1] if att_times else None,
        "attachments": atts,
        "history": hist,
        "answers": t.get("answers"),
        "updated_at_cove": _ts(t.get("updatedAt")),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------- Supabase ----------

def sb():
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def upsert(client, row: dict):
    client.table("pm_task_details").upsert(row, on_conflict="cove_task_id").execute()


def backlog(client, limit: int = 500) -> list[dict]:
    res = (client.table("v_pm_task_details_backlog")
           .select("task_no,cove_task_id")
           .limit(limit).execute())
    return res.data or []


def run_backfill(session: requests.Session, client, limit: int = 500):
    sleep = float(os.getenv("COVE_RATE_SLEEP", "0.5"))
    todo = backlog(client, limit)
    print(f"[task_details] {len(todo)} tasks in backlog")
    ok = err = 0
    for i, item in enumerate(todo, 1):
        tid = item["cove_task_id"]
        try:
            row = normalize(fetch_task(session, tid))
            upsert(client, row)
            ok += 1
            print(f"  {i}/{len(todo)} {row['task_no']} steps {row['steps_checked']}/{row['steps_total']} "
                  f"photos {row['photo_count']} by {row['completed_by']}")
        except Exception as e:  # noqa: BLE001
            err += 1
            print(f"  {i}/{len(todo)} {tid} ERROR {e}", file=sys.stderr)
        time.sleep(sleep)
    print(f"[task_details] done ok={ok} err={err}")


# ---------- hook for pm12_poller ----------

def on_close_events(session: requests.Session, client, cove_task_ids: list[str]):
    """Call from pm12_poller right after it inserts new pm_close_events rows."""
    for tid in cove_task_ids:
        try:
            upsert(client, normalize(fetch_task(session, tid)))
        except Exception as e:  # noqa: BLE001
            print(f"[task_details] {tid} ERROR {e}", file=sys.stderr)
        time.sleep(float(os.getenv("COVE_RATE_SLEEP", "0.5")))


if __name__ == "__main__":
    # Standalone on the VM: same .env and rotating Cove session as the pollers.
    from pathlib import Path
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    _cookie = os.getenv("COVE_AUTH_COOKIE")
    if not _cookie:
        from cove_session import get_fresh_token
        _cookie = get_fresh_token()

    cmd = sys.argv[1] if len(sys.argv) > 1 else "backfill"
    s = make_session(_cookie)
    if cmd == "fetch":
        print(json.dumps(normalize(fetch_task(s, sys.argv[2])), indent=2, default=str))
    elif cmd == "backfill":
        run_backfill(s, sb(), limit=int(sys.argv[2]) if len(sys.argv) > 2 else 500)
    else:
        sys.exit(f"unknown command {cmd}")
