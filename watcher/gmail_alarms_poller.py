r"""Phase 8.0 — Gmail-forwarded BMS alarms poller.

Power Automate forwards alarm emails from Siemens Desigo CC (and possibly
other vendors over time) into bmrupark55@gmail.com under the label
"UPark Siemens Alarms from Power Automate". This poller reads that label
via IMAP every 5 minutes, parses the structured subject + body, and lands
rows into email_alarm_events.

Why IMAP not Gmail API: app-password IMAP is one .env entry, no OAuth
client, no token refresh, no Google Cloud project. The cost is needing
2-Step Verification on the gmail account, which the user has.

Identity / dedupe: Gmail's X-GM-MSGID is globally unique and immutable
across the whole gmail service. We upsert on it with ON CONFLICT DO NOTHING
so reruns are idempotent and cheap.

Schedule (install_gmail_alarms_poller_task.ps1):
  Every 5 minutes, 24/7. <20 emails/day expected, so this is overkill but
  consistent with the BMS alarm cadence and Task Scheduler's 1-minute
  minimum makes 5min a comfortable floor.

Run manually:
    .\.venv\Scripts\python.exe gmail_alarms_poller.py
"""
from __future__ import annotations

import email
import imaplib
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")
sys.path.insert(0, str(HERE))

from supabase_client import get_client  # noqa: E402

UTC = ZoneInfo("UTC")
SITE_TZ = ZoneInfo("America/New_York")  # UPark is east coast — alarm timestamps in subject are local time

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993

# How far back to ask Gmail for messages. 2 days covers normal poll cadence
# even after a weekend outage. The PK dedupes anything we've already seen.
LOOKBACK_DAYS = 2

# Known building name prefixes — used to split "<building> <point_name>" out
# of the subject's free-text region. Add new entries as more sites appear.
KNOWN_BUILDINGS = [
    "The Point",
]

# Subject pattern produced by Siemens Desigo CC at UPark:
#   "At 5/24 7:47 AM The Point AHU1 LOW TEMP DT [88_AHU1_LTD] is Active"
# After we strip "FW: " / "Fwd: " / "RE: " prefixes (case-insensitive) the
# regex matches the four core fields.
_SUBJECT_RE = re.compile(
    r"""^
    At\s+(?P<time>\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}\s*[AP]M)\s+   # "5/24 7:47 AM"
    (?P<location_and_point>.+?)\s+                                # building + point words
    \[(?P<point_ref>[^\]]+)\]\s+                                  # [88_AHU1_LTD]
    is\s+(?P<state>\S+)                                           # Active | Quiet
    \s*$""",
    re.IGNORECASE | re.VERBOSE,
)

_FW_PREFIX_RE = re.compile(r"^(?:fw|fwd|re):\s*", re.IGNORECASE)

# Inside the body: a line that's just "<event_class> (<event_value>)".
# Examples we've seen:
#   "Off Normal (ON)"
#   "Off Normal (OFF)"
#   "High Limit (30.71)"
#   "Low Limit (12.4)"
#   "Fault (something)"
_BODY_EVENT_RE = re.compile(
    r"""^\s*
    (?P<event_class>Off\s+Normal|High\s+Limit|Low\s+Limit|Fault|Out\s+of\s+Service|[A-Za-z][A-Za-z ]{1,40}?)
    \s*\(\s*(?P<event_value>[^)]+?)\s*\)\s*$""",
    re.VERBOSE,
)

# Recognize the original sender inside the forwarded body. The line looks like:
#   "From: noreply@siemens.com <noreply@siemens.com>"
# We match emails inside the body and pick the first one that looks like a
# vendor noreply / system address rather than a real person.
_BODY_FROM_RE = re.compile(
    r"From:\s*(?P<from>.+?)$",
    re.IGNORECASE | re.MULTILINE,
)


# ---------- header helpers ----------

def _decode_header_str(raw: str | None) -> str:
    """Decode an RFC 2047 / MIME-encoded header into plain text, handling
    folding and any encoded-word segments."""
    if not raw:
        return ""
    parts = []
    for chunk, enc in decode_header(raw):
        if isinstance(chunk, bytes):
            try:
                parts.append(chunk.decode(enc or "utf-8", errors="replace"))
            except (LookupError, TypeError):
                parts.append(chunk.decode("utf-8", errors="replace"))
        else:
            parts.append(chunk)
    # Normalize whitespace — IMAP folds long subjects across lines.
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _strip_fw_prefix(subject: str) -> str:
    # Strip any combination of "FW: ", "Fwd: ", "RE: " from the front.
    s = subject
    while True:
        m = _FW_PREFIX_RE.match(s)
        if not m:
            return s.strip()
        s = s[m.end():]


def _internaldate_to_utc(date_str: str | None) -> datetime:
    """IMAP INTERNALDATE comes back like '24-May-2026 11:45:10 +0000'.
    Fall back to now() if it's missing or unparseable."""
    if not date_str:
        return datetime.now(UTC)
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return datetime.now(UTC)


# ---------- body helpers ----------

def _extract_bodies(msg: email.message.Message) -> tuple[str, str]:
    """Return (text, html) decoded from the most appropriate parts."""
    text_parts: list[str] = []
    html_parts: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except LookupError:
                decoded = payload.decode("utf-8", errors="replace")
            if ctype == "text/plain":
                text_parts.append(decoded)
            elif ctype == "text/html":
                html_parts.append(decoded)
    else:
        payload = msg.get_payload(decode=True) or b""
        charset = msg.get_content_charset() or "utf-8"
        try:
            decoded = payload.decode(charset, errors="replace")
        except LookupError:
            decoded = payload.decode("utf-8", errors="replace")
        if msg.get_content_type() == "text/html":
            html_parts.append(decoded)
        else:
            text_parts.append(decoded)
    return "\n".join(text_parts).strip(), "\n".join(html_parts).strip()


def _split_building_and_point(loc_and_point: str) -> tuple[str | None, str]:
    """Given the free-text region between the timestamp and the [point_ref]
    block (e.g. "The Point AHU1 LOW TEMP DT"), peel off a known building
    prefix and return (building, point_name)."""
    s = loc_and_point.strip()
    for b in KNOWN_BUILDINGS:
        if s.lower().startswith(b.lower() + " "):
            return b, s[len(b):].strip()
    return None, s


def _parse_subject(subject_clean: str) -> dict:
    m = _SUBJECT_RE.match(subject_clean)
    if not m:
        return {}
    building, point_name = _split_building_and_point(m["location_and_point"])
    return {
        "alarm_time_local": m["time"].strip(),
        "building":         building,
        "point_name":       point_name,
        "point_ref":        m["point_ref"].strip(),
        "alarm_state":      m["state"].strip(),
    }


def _parse_alarm_time_utc(local_str: str | None, received_at_utc: datetime) -> datetime | None:
    """Subject timestamps are like '5/24 7:47 AM' with no year — assume the
    year from the email's received date in SITE_TZ. Edge case: an email
    received in early January about an alarm from Dec 31 — we detect the
    year wrap by checking if the resulting time is more than 60 days
    ahead of the email's received date."""
    if not local_str:
        return None
    try:
        recv_local = received_at_utc.astimezone(SITE_TZ)
        # "%-m" isn't portable on Windows; pad-tolerant parse:
        m = re.match(r"(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP]M)", local_str.strip(), re.IGNORECASE)
        if not m:
            return None
        mo, da, hr, mi, ampm = m.groups()
        hr = int(hr); mi = int(mi); mo = int(mo); da = int(da)
        if ampm.upper() == "PM" and hr != 12: hr += 12
        elif ampm.upper() == "AM" and hr == 12: hr = 0
        year = recv_local.year
        candidate = datetime(year, mo, da, hr, mi, tzinfo=SITE_TZ)
        # If the email arrived early January but the alarm month is December,
        # the year actually rolled — back up by one.
        if candidate > recv_local + timedelta(days=60):
            candidate = candidate.replace(year=year - 1)
        return candidate.astimezone(UTC)
    except (ValueError, AttributeError):
        return None


def _parse_event_class(body_text: str) -> tuple[str | None, str | None]:
    """Walk body lines looking for the '<class> (<value>)' line. We bail
    out as soon as we find one that doesn't look like English boilerplate."""
    for line in body_text.splitlines():
        line = line.strip()
        if not line or len(line) > 80:
            continue
        m = _BODY_EVENT_RE.match(line)
        if m:
            ec = re.sub(r"\s+", " ", m["event_class"]).strip()
            ev = m["event_value"].strip()
            # Skip false positives like "(see attached)" or
            # "(intended for use by the named recipient(s) only)".
            if len(ev) > 32 or any(s in ec.lower() for s in ("information", "received", "intended")):
                continue
            return ec, ev
    return None, None


def _extract_original_sender(body_text: str) -> str | None:
    """Find the first 'From: ...' line in the forwarded body and return
    the email address portion."""
    for m in _BODY_FROM_RE.finditer(body_text):
        addr = parseaddr(m["from"].strip())[1]
        if addr and "@" in addr:
            return addr.lower()
    return None


def _infer_vendor(original_sender: str | None, body_text: str) -> str | None:
    if original_sender:
        s = original_sender.lower()
        if "siemens" in s:    return "siemens"
        if "schneider" in s:  return "schneider"
        if "delta" in s or "albireo" in s: return "delta"
        if "honeywell" in s:  return "honeywell"
        if "tridium" in s or "niagara" in s: return "tridium"
    if "siemens" in body_text.lower():
        return "siemens"
    return None


# ---------- IMAP helpers ----------

def _fetch_msg(M: imaplib.IMAP4_SSL, uid: bytes) -> dict | None:
    """Fetch one message's gmail extension IDs + headers + body."""
    typ, data = M.fetch(uid, "(X-GM-MSGID X-GM-THRID UID INTERNALDATE BODY.PEEK[])")
    if typ != "OK" or not data:
        return None
    # data layout: [(b'1 (X-GM-MSGID 16... UID 42 INTERNALDATE "24-May-..." BODY[] {nnnn}', b'<raw-rfc822>'), b')']
    header_blob = None
    raw_rfc822 = None
    for part in data:
        if isinstance(part, tuple) and len(part) >= 2:
            header_blob = part[0].decode("ascii", errors="replace") if isinstance(part[0], bytes) else str(part[0])
            raw_rfc822 = part[1]
            break
    if header_blob is None or raw_rfc822 is None:
        return None
    def _grab(field: str) -> str | None:
        m = re.search(rf"{field}\s+(\S+)", header_blob)
        if not m: return None
        return m.group(1).strip().strip('"').strip(")")
    def _grab_date() -> str | None:
        m = re.search(r'INTERNALDATE\s+"([^"]+)"', header_blob)
        return m.group(1) if m else None
    return {
        "gmail_msg_id":   _grab("X-GM-MSGID"),
        "gmail_thread_id":_grab("X-GM-THRID"),
        "gmail_uid":      _grab("UID"),
        "internaldate":   _grab_date(),
        "raw_rfc822":     raw_rfc822,
    }


def _process(M: imaplib.IMAP4_SSL, uid: bytes, label: str) -> dict | None:
    """Fetch one message and return a row ready for upsert, or None on
    parse failure."""
    fetched = _fetch_msg(M, uid)
    if not fetched or not fetched["gmail_msg_id"]:
        return None
    msg = email.message_from_bytes(fetched["raw_rfc822"])
    subject_raw = _decode_header_str(msg.get("Subject"))
    subject_clean = _strip_fw_prefix(subject_raw)
    from_addr = parseaddr(_decode_header_str(msg.get("From")))[1] or None
    received_at = _internaldate_to_utc(fetched["internaldate"])
    body_text, body_html = _extract_bodies(msg)

    subj_fields = _parse_subject(subject_clean)
    event_class, event_value = _parse_event_class(body_text)
    original_sender = _extract_original_sender(body_text)
    vendor = _infer_vendor(original_sender, body_text)
    alarm_time_utc = _parse_alarm_time_utc(subj_fields.get("alarm_time_local"), received_at)

    parsed = {**subj_fields, "event_class": event_class, "event_value": event_value}

    return {
        "gmail_msg_id":     fetched["gmail_msg_id"],
        "gmail_thread_id":  fetched["gmail_thread_id"],
        "gmail_uid":        int(fetched["gmail_uid"]) if fetched["gmail_uid"] else None,
        "label":            label,
        "from_addr":        (from_addr or "").lower() or None,
        "original_sender":  original_sender,
        "vendor":           vendor,
        "subject_raw":      subject_raw,
        "subject_clean":    subject_clean,
        "received_at_utc":  received_at.isoformat(),
        "building":         subj_fields.get("building"),
        "point_name":       subj_fields.get("point_name"),
        "point_ref":        subj_fields.get("point_ref"),
        "alarm_state":      subj_fields.get("alarm_state"),
        "event_class":      event_class,
        "event_value":      event_value,
        "alarm_time_local": subj_fields.get("alarm_time_local"),
        "alarm_time_utc":   alarm_time_utc.isoformat() if alarm_time_utc else None,
        "body_text":        body_text[:50_000] if body_text else None,
        "body_html":        body_html[:200_000] if body_html else None,
        "parsed_fields":    parsed,
    }


# ---------- main ----------

def main() -> int:
    user = os.environ.get("GMAIL_USER", "").strip()
    pw = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    label = os.environ.get("GMAIL_ALARM_LABEL", "").strip()
    if not (user and pw and label):
        print("ERROR: GMAIL_USER / GMAIL_APP_PASSWORD / GMAIL_ALARM_LABEL must all be set in watcher/.env",
              file=sys.stderr)
        _update_state(status="error", err="missing env vars")
        return 1

    print(f"[{datetime.now(UTC).isoformat()}] gmail_alarms_poller starting; label={label!r}")
    client = get_client()
    seen = 0
    added = 0
    rows: list[dict] = []

    try:
        M = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        M.login(user, pw)
        typ, _ = M.select(f'"{label}"', readonly=True)
        if typ != "OK":
            raise RuntimeError(f"SELECT label {label!r} failed (typ={typ})")
        since = (datetime.now(UTC) - timedelta(days=LOOKBACK_DAYS)).strftime("%d-%b-%Y")
        typ, ids = M.search(None, f'(SINCE "{since}")')
        if typ != "OK":
            raise RuntimeError(f"SEARCH failed (typ={typ})")
        uids = ids[0].split() if ids and ids[0] else []
        seen = len(uids)
        print(f"  {seen} messages in last {LOOKBACK_DAYS}d")
        for uid in uids:
            try:
                row = _process(M, uid, label)
            except Exception as e:
                print(f"  parse error on uid={uid!r}: {e}", file=sys.stderr)
                continue
            if row:
                rows.append(row)
        try:
            M.close()
        except Exception:
            pass
        M.logout()
    except Exception as e:
        print(f"ERROR (imap stage): {e}", file=sys.stderr)
        _update_state(status="error", err=str(e)[:1000], seen=seen)
        return 1

    if rows:
        # ON CONFLICT DO NOTHING on PK keeps reruns idempotent.
        try:
            CHUNK = 100
            for i in range(0, len(rows), CHUNK):
                resp = client.table("email_alarm_events").upsert(
                    rows[i:i + CHUNK],
                    on_conflict="gmail_msg_id",
                    ignore_duplicates=True,
                ).execute()
                added += len(resp.data) if resp.data else 0
        except Exception as e:
            print(f"ERROR (db write): {e}", file=sys.stderr)
            _update_state(status="error", err=str(e)[:1000], seen=seen, added=added)
            return 1

    _update_state(status="ok", seen=seen, added=added, err=None)
    print(f"[ok] seen={seen} new={added}")
    return 0


def _update_state(*, status: str, seen: int = 0, added: int = 0, err: str | None = None) -> None:
    try:
        get_client().table("email_poll_state").update({
            "last_run_at":     datetime.now(UTC).isoformat(),
            "last_run_status": status,
            "last_run_seen":   seen,
            "last_run_added":  added,
            "last_error":      err,
            "updated_at":      datetime.now(UTC).isoformat(),
        }).eq("id", 1).execute()
    except Exception as e:
        print(f"WARN: also failed to write email_poll_state: {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
