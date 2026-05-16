"""COVE CSV watcher — Phase 1 MVP.

Watches the CSV DB/ folder. When a CSV is added or modified, classifies it by
filename, parses it, inserts a snapshots row + matching *_rows, and logs the
result to ingestion_log.

Phase 1 supports PM12 only; Labor + WO ingest land in the next step.

Usage:
    python -m watcher.main                  # runs as a foreground daemon
    python -m watcher.main --backfill       # ingest every existing CSV in the folder, then watch
    python -m watcher.main --once <path>    # ingest a single file and exit (for testing)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

# When run as `python -m watcher.main`, package imports work; for direct script
# usage we fall back to adjusting sys.path so sibling modules import.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from filename_parser import Parsed, parse as parse_filename  # noqa: E402
from supabase_client import get_client  # noqa: E402


# ---- dispatch ---------------------------------------------------------------

def _ingest_pm12(csv_path: Path, snapshot_id: str) -> int:
    from ingest_pm12 import ingest
    return ingest(csv_path, snapshot_id)


def _ingest_labor(csv_path: Path, snapshot_id: str) -> int:
    from ingest_labor import ingest
    return ingest(csv_path, snapshot_id)


def _ingest_wo(csv_path: Path, snapshot_id: str) -> int:
    from ingest_wo import ingest
    return ingest(csv_path, snapshot_id)


_HANDLERS: dict[str, Callable[[Path, str], int]] = {
    "pm12":  _ingest_pm12,
    "labor": _ingest_labor,
    "wo":    _ingest_wo,
}


# Upload the raw CSV to Storage under csv-archive/{kind}/{filename}.
# Failures here are logged but do not fail the ingest — DB rows are the source of truth.
def _archive(csv_path: Path, kind: str) -> str | None:
    try:
        client = get_client()
        key = f"{kind}/{csv_path.name}"
        with csv_path.open("rb") as fh:
            client.storage.from_("csv-archive").upload(
                path=key,
                file=fh,
                file_options={"content-type": "text/csv", "upsert": "true"},
            )
        return key
    except Exception as e:  # noqa: BLE001
        print(f"[warn] archive upload failed for {csv_path.name}: {e}", file=sys.stderr)
        return None


# ---- per-file processing ----------------------------------------------------

def _wait_until_stable(path: Path, settle_seconds: float = 2.0, max_wait: float = 30.0) -> bool:
    """Wait until the file size stops changing — guards against ingesting a
    half-written CSV the moment FileCreated fires."""
    deadline = time.monotonic() + max_wait
    last_size = -1
    last_change = time.monotonic()
    while time.monotonic() < deadline:
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size != last_size:
            last_size = size
            last_change = time.monotonic()
        elif time.monotonic() - last_change >= settle_seconds and size > 0:
            return True
        time.sleep(0.5)
    return False


def _already_ingested(client, kind: str, filename: str) -> bool:
    res = client.table("snapshots").select("id").eq("kind", kind).eq("filename", filename).limit(1).execute()
    return bool(res.data)


def process(csv_path: Path) -> None:
    """Ingest one CSV. Logs success or failure to ingestion_log."""
    filename = csv_path.name
    parsed: Parsed | None = parse_filename(filename)

    client = get_client()

    if parsed is None:
        print(f"[skip] unrecognised filename: {filename}")
        client.table("ingestion_log").insert({
            "filename": filename,
            "kind":     None,
            "status":   "skipped",
            "rows":     None,
            "error_msg": "filename did not match COVE PM12/Labor/WO12 pattern",
        }).execute()
        return

    handler = _HANDLERS.get(parsed.kind)
    if handler is None:
        print(f"[skip] no handler for kind={parsed.kind}: {filename}")
        return

    if _already_ingested(client, parsed.kind, filename):
        print(f"[skip] already ingested: {filename}")
        return

    if not _wait_until_stable(csv_path):
        print(f"[skip] file never stabilised: {filename}")
        client.table("ingestion_log").insert({
            "filename":  filename,
            "kind":      parsed.kind,
            "status":    "error",
            "error_msg": "file did not stabilise within 30s",
        }).execute()
        return

    # Insert the snapshot row first so we have an id to attach rows to.
    snap = client.table("snapshots").insert({
        "kind":        parsed.kind,
        "taken_at":    parsed.taken_at.isoformat(),
        "filename":    filename,
        "source_path": str(csv_path.resolve()),
    }).execute()
    snapshot_id = snap.data[0]["id"]

    try:
        n = handler(csv_path, snapshot_id)
        _archive(csv_path, parsed.kind)
        client.table("snapshots").update({"row_count": n}).eq("id", snapshot_id).execute()
        client.table("ingestion_log").insert({
            "filename":    filename,
            "kind":        parsed.kind,
            "status":      "ok",
            "rows":        n,
            "snapshot_id": snapshot_id,
        }).execute()
        print(f"[ok]   {filename}: {n} rows")
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        client.table("ingestion_log").insert({
            "filename":    filename,
            "kind":        parsed.kind,
            "status":      "error",
            "rows":        0,
            "error_msg":   f"{e}\n{tb}",
            "snapshot_id": snapshot_id,
        }).execute()
        # Roll back the snapshot row so a retry can re-insert cleanly.
        client.table("snapshots").delete().eq("id", snapshot_id).execute()
        print(f"[err]  {filename}: {e}", file=sys.stderr)


# ---- watchdog ---------------------------------------------------------------

class _Handler(FileSystemEventHandler):
    def __init__(self, watch_dir: Path) -> None:
        self.watch_dir = watch_dir

    def _maybe_process(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() != ".csv":
            return
        process(path)

    def on_created(self, event: FileSystemEvent) -> None:
        self._maybe_process(event)

    def on_moved(self, event: FileSystemEvent) -> None:
        # Some apps write to a temp name then rename — treat the rename target.
        if event.is_directory:
            return
        dest = Path(event.dest_path)
        if dest.suffix.lower() != ".csv":
            return
        process(dest)


def _backfill(watch_dir: Path) -> None:
    for csv in sorted(watch_dir.glob("*.csv")):
        process(csv)


def main() -> int:
    load_dotenv(Path(__file__).resolve().parent / ".env")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backfill", action="store_true", help="Ingest every existing CSV before watching")
    parser.add_argument("--once", type=Path, help="Ingest a single CSV and exit")
    args = parser.parse_args()

    if args.once:
        process(args.once)
        return 0

    watch_dir = Path(os.environ.get("WATCH_DIR", "")).expanduser()
    if not watch_dir.is_dir():
        print(f"ERROR: WATCH_DIR not a directory: {watch_dir}", file=sys.stderr)
        return 1

    if args.backfill:
        print(f"[backfill] scanning {watch_dir}")
        _backfill(watch_dir)

    observer = Observer()
    observer.schedule(_Handler(watch_dir), str(watch_dir), recursive=False)
    observer.start()
    print(f"[watch] {watch_dir}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
    return 0


if __name__ == "__main__":
    sys.exit(main())
