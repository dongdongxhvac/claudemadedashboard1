r"""PM assign watcher — services the dashboard's "Assign in Cove" button.

The Binney manager page INSERTs into pm_assign_requests (migration 0156):
one row = "set PM task <cove_task_id> to assignee <assignee_cove_id>". This
script (per-minute systemd timer, install_binney_pm_assign_linux.sh) claims
every pending row, runs Cove's UpdatePMTask mutation for each, and stamps
done / error with Cove's answer.

The mutation, captured from manage.cove.is DevTools on 2026-11-05 while
reassigning PM-ROG-6743:

    mutation UpdatePMTask($id: ID!, $input: GQLPMTaskUpdateInput!) {
      updatePMTask(id: $id, input: $input) { id }
    }
    variables: {"id": "<GQLPMTask.id>", "input": {"assigneeId": "<Cove user id>"}}

No network id is needed — the task id is global — so one watcher serves
every site; site_code on the request is just for the log.

After a successful write the latest pm12 snapshot row for that task gets its
assigned_to_name patched, so the dashboard shows the new assignee at once
instead of waiting for the next two-hourly poll (which then confirms it from
Cove's side).

Exits 0 quickly when there is nothing to do, which is the common case.

Run manually:
    ./.venv/bin/python pm_assign_watcher.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402
from cove_session import get_fresh_token  # noqa: E402

GQL_URL = "https://api.cove.is/gql"

# Verbatim from the Cove web app (whitespace preserved, same reason as the
# pollers' queries: the operation hash must match if Cove ever turns on APQ).
MUTATION = """
    mutation UpdatePMTask($id: ID!, $input: GQLPMTaskUpdateInput!) {
  updatePMTask(id: $id, input: $input) {
    id
  }
}
    """

# Same mutation, also asking for the assignee as Cove now spells it, so the
# dashboard can show "Ed Nardone" (Cove's firstName lastName — what the pm12
# poller writes) rather than whatever name the request carried. Tried
# first; if Cove rejects the extra selection the bare MUTATION is used.
MUTATION_WITH_ASSIGNEE = """
    mutation UpdatePMTask($id: ID!, $input: GQLPMTaskUpdateInput!) {
  updatePMTask(id: $id, input: $input) {
    id
    assignee {
      id
      firstName
      lastName
    }
  }
}
    """


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def update_pm_assignee(token: str, task_id: str, assignee_id: str) -> tuple[bool, str, str | None]:
    """Run UpdatePMTask. Returns (ok, detail, cove_assignee_name). The name is
    Cove's own spelling of the new assignee when the reply carries it, else
    None. Tries the richer selection first and falls back to the bare one on
    a GraphQL validation error (which never executes the write)."""
    ok, detail, name = _run_mutation(token, task_id, assignee_id, MUTATION_WITH_ASSIGNEE)
    if not ok and "Cannot query field" in detail:
        ok, detail, name = _run_mutation(token, task_id, assignee_id, MUTATION)
    return ok, detail, name


def _run_mutation(token: str, task_id: str, assignee_id: str, query: str) -> tuple[bool, str, str | None]:
    """One POST. Mirrors the pollers' post_gql headers: raw JWT in
    Authorization AND as the cove_manage_auth cookie."""
    headers = {
        "Authorization": token,
        "Cookie": f"cove_manage_auth={token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": "https://manage.cove.is",
        "Referer": "https://manage.cove.is/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
    }
    body = {
        "operationName": "UpdatePMTask",
        "query": query,
        "variables": {"id": task_id, "input": {"assigneeId": assignee_id}},
    }
    try:
        resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    except requests.RequestException as e:
        return False, f"network: {e}", None
    if resp.status_code != 200:
        return False, f"HTTP {resp.status_code}: {resp.text[:500]}", None
    try:
        data = resp.json()
    except ValueError:
        return False, f"non-JSON reply: {resp.text[:500]}", None
    if not isinstance(data, dict):
        return False, f"unexpected reply: {str(data)[:500]}", None
    if data.get("errors"):
        msgs = "; ".join(
            str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in data["errors"]
        )
        return False, f"Cove: {msgs[:900]}", None
    # Cove answers {"data":{"updatePMTask":[{"id":…}]}} — a LIST (seen
    # 2026-11-05, first live run), even though the query asks for one object.
    # Accept either shape; the write is confirmed when our id comes back.
    returned = (data.get("data") or {}).get("updatePMTask")
    items = [it for it in (returned if isinstance(returned, list) else [returned]) if isinstance(it, dict)]
    mine = next((it for it in items if it.get("id") == task_id), None)
    if mine is not None:
        return True, "ok", _assignee_name(mine.get("assignee"))
    ids = sorted(str(it.get("id")) for it in items if it.get("id"))
    if ids:
        # Something came back but not our id — treat as success with a note,
        # since Cove reported no error; the next poll shows the truth.
        return True, f"ok (Cove returned ids {ids})", _assignee_name(items[0].get("assignee"))
    return False, f"unexpected reply: {str(data)[:500]}", None


def _assignee_name(assignee) -> str | None:
    """'Ed Nardone' from Cove's assignee object — same rule as pm12_poller."""
    if not isinstance(assignee, dict):
        return None
    name = f"{(assignee.get('firstName') or '').strip()} {(assignee.get('lastName') or '').strip()}".strip()
    return name or None


def patch_snapshot(client, req: dict) -> None:
    """Best effort: show the new assignee on the dashboard right away by
    patching the current snapshot's row. The next pm12 poll overwrites it
    with whatever Cove says, so this can never drift from the truth."""
    latest = (
        client.table("snapshots")
        .select("id")
        .eq("kind", "pm12")
        .eq("site_code", req.get("site_code") or "binney")
        .order("taken_at", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        return
    client.table("pm_rows").update(
        {"assigned_to_name": req.get("assignee_name")}
    ).eq("snapshot_id", latest.data[0]["id"]).eq("cove_task_id", req["cove_task_id"]).execute()


# A request left in 'running' longer than this is a watcher that died mid-run
# (crash, VM reboot, systemd timeout). Stamp it as error so the dashboard's
# chip stops saying "writing to Cove…" forever and the PM can be retried.
STALE_RUNNING_MINUTES = 5


def reap_stale_running(client) -> None:
    cutoff = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() - STALE_RUNNING_MINUTES * 60, tz=timezone.utc
    ).isoformat()
    stale = (
        client.table("pm_assign_requests")
        .select("id, task_no")
        .eq("status", "running")
        .lt("started_at", cutoff)
        .execute()
    )
    ids = [r["id"] for r in (stale.data or [])]
    if not ids:
        return
    print(f"  reaping {len(ids)} stale running request(s): {[r.get('task_no') for r in stale.data]}")
    client.table("pm_assign_requests").update({
        "status": "error", "finished_at": _now(),
        "detail": f"watcher died mid-run (no result after {STALE_RUNNING_MINUTES} min) — check journalctl -u binney-pm-assign and retry",
    }).in_("id", ids).execute()


def main() -> int:
    client = get_client()

    try:
        reap_stale_running(client)
    except Exception as e:
        print(f"WARN: stale reap failed: {e}", file=sys.stderr)

    pending = (
        client.table("pm_assign_requests")
        .select("id, site_code, cove_task_id, task_no, assignee_cove_id, assignee_name")
        .eq("status", "pending")
        .order("requested_at")
        .execute()
    )
    reqs = pending.data or []
    if not reqs:
        return 0

    ids = [r["id"] for r in reqs]
    print(f"[{_now()}] {len(reqs)} pending assign request(s)")
    client.table("pm_assign_requests").update(
        {"status": "running", "started_at": _now()}
    ).in_("id", ids).execute()

    try:
        token = get_fresh_token()
    except Exception as e:  # SessionError, a missing session file, a network error on refresh…
        detail = f"cove_session: {type(e).__name__}: {e}"
        print(f"ERROR: {detail}", file=sys.stderr)
        client.table("pm_assign_requests").update(
            {"status": "error", "finished_at": _now(), "detail": detail[:1000]}
        ).in_("id", ids).execute()
        return 1

    failures = 0
    for r in reqs:
        label = f"{r.get('task_no') or r['cove_task_id']} → {r.get('assignee_name') or r['assignee_cove_id']}"
        # Nothing may leave a row in 'running': any surprise becomes an error
        # row with the exception text, and the loop moves on.
        try:
            ok, detail, cove_name = update_pm_assignee(token, r["cove_task_id"], r["assignee_cove_id"])
        except Exception as e:
            ok, detail, cove_name = False, f"watcher exception: {type(e).__name__}: {e}", None
        outcome = {"status": "done" if ok else "error", "finished_at": _now(), "detail": detail[:1000]}
        if ok and cove_name:
            # Cove's spelling wins — it is what the poller writes, so the
            # patched snapshot row and the log read like every other row.
            outcome["assignee_name"] = cove_name
            r["assignee_name"] = cove_name
        try:
            client.table("pm_assign_requests").update(outcome).eq("id", r["id"]).execute()
        except Exception as e:
            failures += 1
            print(f"  ERROR {label}: could not stamp outcome ({outcome['status']}): {e}", file=sys.stderr)
            continue
        if ok:
            print(f"  done  {label}")
            try:
                patch_snapshot(client, r)
            except Exception as e:  # the write to Cove already succeeded; don't fail the run
                print(f"  WARN: snapshot patch failed for {label}: {e}", file=sys.stderr)
        else:
            failures += 1
            print(f"  ERROR {label}: {detail}", file=sys.stderr)

    print(f"[{_now()}] {len(reqs) - failures} done, {failures} failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
