r"""Phase 8.0 + 8.1 — Gmail-forwarded BMS alarms + heartbeats poller.

Reads two Gmail labels every 5 minutes:

  GMAIL_ALARM_LABEL     — Siemens Desigo CC alarms from The Point. Each
                          email = one alarm transition. Lands in
                          email_alarm_events.
  GMAIL_HEARTBEAT_LABEL — Daily-test alarms from all 4 BMS systems (Mon-Fri).
                          Per-vendor "I'm alive" signal. Lands in
                          bms_heartbeats, powers the §09 pipeline-staleness
                          indicator.

Why IMAP not Gmail API: app-password IMAP is one .env entry, no OAuth
client, no token refresh, no Google Cloud project. The cost is needing
2-Step Verification on the gmail account.

Identity / dedupe: Gmail's X-GM-MSGID is globally unique and immutable
across the whole gmail service. We upsert on it with ON CONFLICT DO NOTHING
so reruns are idempotent and cheap. Both labels share PK semantics.

Heartbeat vendor classifier (primary signal = inner From address):
  takedabms@albireoenergy.com       -> delta_takeda
  noreply@siemens.com               -> siemens_thepoint
  jll750mainbms@northeast-tech.com  -> northeasttech_730_750
  deltabms@albireoenergy.com        -> delta_10green

Run manually:
    .\.venv\Scripts\python.exe gmail_alarms_poller.py
"""
from __future__ import annotations

import email
import imaplib
import os
import re
import socket
import sys
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

# Hard timeouts on every blocking I/O call. Without this, an unresponsive
# IMAP server or stalled Supabase HTTP call will hang the script indefinitely,
# Task Scheduler keeps re-firing every 5 min, hung processes accumulate, and
# the dashboard goes stale until someone notices and UAC-kills the orphans.
# Seen in the wild on 2026-05-25: 13h of cascading log-lock failures.
socket.setdefaulttimeout(60)

# Line-buffer stdout/stderr so the log file shows progress in real time —
# the default block-buffering hid the exact line where the script hung,
# making the post-mortem much harder.
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

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


# ---------- heartbeat vendor classifier + per-vendor parsers ----------

# Mapping: inner From address (lowercased) -> vendor slug.
HB_SENDER_TO_VENDOR: dict[str, str] = {
    "takedabms@albireoenergy.com":      "delta_takeda",
    "noreply@siemens.com":              "siemens_thepoint",
    "jll750mainbms@northeast-tech.com": "northeasttech_730_750",
    "deltabms@albireoenergy.com":       "delta_10green",
}

HB_VENDOR_META: dict[str, tuple[str, str]] = {
    # vendor_slug: (vendor_label_for_ui, building)
    "delta_takeda":          ("Delta @ Takeda",           "Takeda"),
    "siemens_thepoint":      ("Siemens @ The Point",      "The Point"),
    "northeasttech_730_750": ("Northeast Tech @ 730/750", "730/750 Main"),
    "delta_10green":         ("Delta @ 10 Green Street",  "10 Green Street"),
}

# Delta enteliWEB heartbeat body has a "Time of Transition: YYYY-MM-DD HH:MM:SS"
# line; Northeast Tech has "Timestamp: YYYY-MM-DD HH:MM:SS -4H, DST". Both are
# ET-local with no parseable offset, so we attach SITE_TZ.
_HB_TIME_OF_TRANSITION_RE = re.compile(
    r"Time\s+of\s+Transition:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.IGNORECASE,
)
_HB_TIMESTAMP_LINE_RE = re.compile(
    r"Timestamp:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.IGNORECASE,
)
# Forwarded-body "Sent: <RFC2822-ish date>" — last-ditch fallback.
_HB_SENT_LINE_RE = re.compile(r"^Sent:\s*(.+?)$", re.IGNORECASE | re.MULTILINE)

# Delta subjects end with "(Alarm)" or "(Normal)"; the leading words before
# " - " are the building / alarm-group context, and the part between " - "
# and " (" is the point name.
_HB_DELTA_SUBJECT_RE = re.compile(
    r"-\s+(?P<point>.+?)\s+\((?P<state>Alarm|Normal)\)\s*$",
    re.IGNORECASE,
)
# Northeast Tech body has "Alarm text: <free-form>".
_HB_NORTHEAST_ALARMTEXT_RE = re.compile(r"^Alarm text:\s*(.+?)\s*$", re.MULTILINE)


def _classify_hb_vendor(original_sender: str | None, body_text: str) -> str | None:
    """Identify which BMS sent the heartbeat. Inner From is the primary
    signal; fall back to body scan if the From line was stripped."""
    if original_sender:
        v = HB_SENDER_TO_VENDOR.get(original_sender.lower().strip())
        if v:
            return v
    btxt = body_text.lower()
    for sender, vendor in HB_SENDER_TO_VENDOR.items():
        if sender in btxt:
            return vendor
    return None


def _parse_hb_event_time(
    vendor: str | None,
    body_text: str,
    subject_clean: str,
    received_at: datetime,
) -> datetime:
    """Extract the original BMS-side timestamp from the email body. We must
    NOT use Gmail's INTERNALDATE — backfills land everything at "now" but
    the actual heartbeat could be days old."""
    # Pattern: Delta enteliWEB body has "Time of Transition: YYYY-MM-DD HH:MM:SS"
    if vendor in ("delta_takeda", "delta_10green"):
        m = _HB_TIME_OF_TRANSITION_RE.search(body_text)
        if m:
            try:
                return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=SITE_TZ).astimezone(UTC)
            except ValueError:
                pass
    # Northeast Tech body has "Timestamp: YYYY-MM-DD HH:MM:SS -4H, DST"
    if vendor == "northeasttech_730_750":
        m = _HB_TIMESTAMP_LINE_RE.search(body_text)
        if m:
            try:
                return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=SITE_TZ).astimezone(UTC)
            except ValueError:
                pass
    # Siemens heartbeat uses same subject pattern as Siemens alarms; reuse parser.
    if vendor == "siemens_thepoint":
        sf = _parse_subject(subject_clean)
        dt = _parse_alarm_time_utc(sf.get("alarm_time_local"), received_at)
        if dt:
            return dt
    # Last resort: the forwarded "Sent:" line in the body.
    m = _HB_SENT_LINE_RE.search(body_text)
    if m:
        try:
            dt = parsedate_to_datetime(m.group(1).strip())
            if dt is not None:
                return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=SITE_TZ).astimezone(UTC)
        except (TypeError, ValueError):
            pass
    return received_at


def _parse_hb_state(vendor: str | None, subject_clean: str, body_text: str) -> str | None:
    """Return the state token: Alarm | Normal (Delta), Active | Quiet
    (Siemens), or a snippet of "Alarm text" (Northeast Tech)."""
    if vendor in ("delta_takeda", "delta_10green"):
        m = _HB_DELTA_SUBJECT_RE.search(subject_clean)
        if m:
            return m.group("state")
    if vendor == "siemens_thepoint":
        sf = _parse_subject(subject_clean)
        return sf.get("alarm_state")
    if vendor == "northeasttech_730_750":
        m = _HB_NORTHEAST_ALARMTEXT_RE.search(body_text)
        if m:
            return m.group(1).strip()[:120]
    return None


def _parse_hb_point(vendor: str | None, subject_clean: str) -> str | None:
    if vendor in ("delta_takeda", "delta_10green"):
        m = _HB_DELTA_SUBJECT_RE.search(subject_clean)
        if m:
            return m.group("point").strip()
    if vendor == "siemens_thepoint":
        sf = _parse_subject(subject_clean)
        nm = sf.get("point_name")
        rf = sf.get("point_ref")
        if nm and rf:
            return f"{nm} [{rf}]"
        return nm or rf
    if vendor == "northeasttech_730_750":
        return "Daily Test Alarm"
    return None


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


def _process_heartbeat(M: imaplib.IMAP4_SSL, uid: bytes, label: str) -> dict | None:
    """Fetch one heartbeat email and return a row ready for upsert into
    bms_heartbeats, or None if vendor classification fails."""
    fetched = _fetch_msg(M, uid)
    if not fetched or not fetched["gmail_msg_id"]:
        return None
    msg = email.message_from_bytes(fetched["raw_rfc822"])
    subject_raw = _decode_header_str(msg.get("Subject"))
    subject_clean = _strip_fw_prefix(subject_raw)
    received_at = _internaldate_to_utc(fetched["internaldate"])
    body_text, _body_html = _extract_bodies(msg)
    original_sender = _extract_original_sender(body_text)
    vendor = _classify_hb_vendor(original_sender, body_text)
    if not vendor:
        # Don't insert mystery emails — the staleness logic depends on
        # accurate vendor labels and a wrong row would lie.
        return None
    vlabel, building = HB_VENDOR_META.get(vendor, (vendor, None))
    event_ts = _parse_hb_event_time(vendor, body_text, subject_clean, received_at)
    state = _parse_hb_state(vendor, subject_clean, body_text)
    point = _parse_hb_point(vendor, subject_clean)
    return {
        "gmail_msg_id":        fetched["gmail_msg_id"],
        "vendor":              vendor,
        "vendor_label":        vlabel,
        "building":            building,
        "point_name":          point,
        "state":               state,
        "event_timestamp_utc": event_ts.isoformat(),
        "received_at_utc":     received_at.isoformat(),
        "original_sender":     original_sender,
        "subject_raw":         subject_raw,
        "body_text":           body_text[:50_000] if body_text else None,
        "parsed_fields": {
            "subject_clean": subject_clean,
            "label":         label,
            "state":         state,
            "point":         point,
        },
    }


# ---------- Delta enteliWEB alarm-body parsers ----------
#
# Delta alarms (both Takeda direct and 10 Green Street remote) come from
# enteliWEB with this body structure:
#   [enteliWEB]
#   <site>
#   <device tag>
#   Monitored Object
#   <point name>
#   ...
#   Alarm State
#   <from> -> <to>
#   ...
#   Message
#   <free-form alarm text>
#   Time of Transition
#   YYYY-MM-DD HH:MM:SS
#   ...
# We extract: point_name (from "Monitored Object" block + first non-blank
# line below), alarm_state transition (from "Alarm State" block), message
# text (from "Message" block), and timestamp (from "Time of Transition").
# Subject pattern: "<group> : <site> - <point> (Alarm|Normal)"

_DELTA_SUBJECT_RE = re.compile(
    r"^(?:[\w\s]+:\s*)?(?P<site>[^-]+?)\s+-\s+(?P<point>.+?)\s+\((?P<state>Alarm|Normal)\)\s*$",
    re.IGNORECASE,
)


def _parse_delta_block(body_text: str, header: str) -> str | None:
    """Extract the value that follows a single-line header in a Delta
    enteliWEB email body. e.g. 'Time of Transition\\n2026-05-24 19:24:11'."""
    pattern = re.compile(
        rf"^{re.escape(header)}\s*$\s*(?P<val>.+?)\s*$",
        re.IGNORECASE | re.MULTILINE,
    )
    m = pattern.search(body_text)
    return m.group("val").strip() if m else None


def _process_delta_alarm(
    subject_clean: str,
    body_text: str,
    received_at: datetime,
) -> dict:
    """Extract Delta-specific fields from a Delta enteliWEB alarm email."""
    subj = _DELTA_SUBJECT_RE.match(subject_clean) or _DELTA_SUBJECT_RE.match(subject_clean.replace("FW:", "").strip())
    site = subj["site"].strip() if subj else None
    point_from_subject = subj["point"].strip() if subj else None
    state_from_subject = subj["state"].strip() if subj else None

    # Body fields
    time_str = _parse_delta_block(body_text, "Time of Transition")
    alarm_state_str = _parse_delta_block(body_text, "Alarm State")
    message_str = _parse_delta_block(body_text, "Message")

    alarm_time_utc = None
    if time_str:
        try:
            alarm_time_utc = (
                datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=SITE_TZ)
                .astimezone(UTC)
            )
        except ValueError:
            pass

    # Interpret state — subject's (Alarm)/(Normal) is the most reliable.
    # Map to the canonical Active/Quiet vocabulary used by Siemens-side rows
    # so v_email_alarms_open's "WHERE state='Active'" works across vendors.
    state_canonical = None
    if state_from_subject:
        state_canonical = "Active" if state_from_subject.lower() == "alarm" else "Quiet"

    return {
        "building":         site,
        "point_name":       point_from_subject,
        "point_ref":        point_from_subject,  # Delta uses point name as ref in subjects
        "alarm_state":      state_canonical,
        "event_class":      "Off Normal" if state_from_subject and state_from_subject.lower() == "alarm" else "Normal",
        "event_value":      message_str,
        "alarm_time_local": time_str,
        "alarm_time_utc":   alarm_time_utc.isoformat() if alarm_time_utc else None,
        "parsed_fields": {
            "subject_clean":     subject_clean,
            "site":              site,
            "point":             point_from_subject,
            "state":             state_from_subject,
            "alarm_state_block": alarm_state_str,
            "message":           message_str,
            "time_of_transition": time_str,
        },
    }


def _process(M: imaplib.IMAP4_SSL, uid: bytes, label: str) -> dict | None:
    """Fetch one message and return a row ready for upsert into
    email_alarm_events, or None on parse failure. Dispatches to a
    vendor-specific parser based on the inferred From-line."""
    fetched = _fetch_msg(M, uid)
    if not fetched or not fetched["gmail_msg_id"]:
        return None
    msg = email.message_from_bytes(fetched["raw_rfc822"])
    subject_raw = _decode_header_str(msg.get("Subject"))
    subject_clean = _strip_fw_prefix(subject_raw)
    from_addr = parseaddr(_decode_header_str(msg.get("From")))[1] or None
    received_at = _internaldate_to_utc(fetched["internaldate"])
    body_text, body_html = _extract_bodies(msg)
    original_sender = _extract_original_sender(body_text)
    vendor = _infer_vendor(original_sender, body_text)

    # Per-vendor structured extraction. Falls back to the original Siemens
    # parser on unknown senders so we still capture something useful.
    if vendor == "delta":
        v_fields = _process_delta_alarm(subject_clean, body_text, received_at)
        # Vendor field can be more granular: distinguish Takeda vs 10 Green by sender
        if original_sender == "deltabms@albireoenergy.com":
            vendor = "delta_10green"
        elif original_sender == "takedabms@albireoenergy.com":
            vendor = "delta_takeda"
    else:
        # Default = Siemens-shaped parser
        subj_fields = _parse_subject(subject_clean)
        ec, ev = _parse_event_class(body_text)
        atu = _parse_alarm_time_utc(subj_fields.get("alarm_time_local"), received_at)
        v_fields = {
            "building":         subj_fields.get("building"),
            "point_name":       subj_fields.get("point_name"),
            "point_ref":        subj_fields.get("point_ref"),
            "alarm_state":      subj_fields.get("alarm_state"),
            "event_class":      ec,
            "event_value":      ev,
            "alarm_time_local": subj_fields.get("alarm_time_local"),
            "alarm_time_utc":   atu.isoformat() if atu else None,
            "parsed_fields":    {**subj_fields, "event_class": ec, "event_value": ev},
        }
    parsed = v_fields["parsed_fields"]

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
        "building":         v_fields.get("building"),
        "point_name":       v_fields.get("point_name"),
        "point_ref":        v_fields.get("point_ref"),
        "alarm_state":      v_fields.get("alarm_state"),
        "event_class":      v_fields.get("event_class"),
        "event_value":      v_fields.get("event_value"),
        "alarm_time_local": v_fields.get("alarm_time_local"),
        "alarm_time_utc":   v_fields.get("alarm_time_utc"),
        "body_text":        body_text[:50_000] if body_text else None,
        "body_html":        body_html[:200_000] if body_html else None,
        "parsed_fields":    parsed,
    }


# ---------- main ----------

def _drain_label(
    M: imaplib.IMAP4_SSL,
    label: str,
    process_fn,
) -> tuple[int, list[dict]]:
    """SELECT + SEARCH SINCE + fetch every match, returning the rows produced
    by process_fn(M, uid, label). Returns (uids_seen, rows)."""
    import time as _time
    t0 = _time.monotonic()
    print(f"    drain[{label}]: SELECT…")
    typ, _ = M.select(f'"{label}"', readonly=True)
    if typ != "OK":
        raise RuntimeError(f"SELECT label {label!r} failed (typ={typ})")
    print(f"    drain[{label}]: SELECT done in {_time.monotonic()-t0:.1f}s")
    since = (datetime.now(UTC) - timedelta(days=LOOKBACK_DAYS)).strftime("%d-%b-%Y")
    t1 = _time.monotonic()
    print(f"    drain[{label}]: SEARCH SINCE {since}…")
    typ, ids = M.search(None, f'(SINCE "{since}")')
    if typ != "OK":
        raise RuntimeError(f"SEARCH on {label!r} failed (typ={typ})")
    print(f"    drain[{label}]: SEARCH done in {_time.monotonic()-t1:.1f}s")
    uids = ids[0].split() if ids and ids[0] else []
    print(f"    drain[{label}]: {len(uids)} uids, fetching…")
    rows: list[dict] = []
    # Per-label time budget. Without this, a single 5-min Task Scheduler
    # cycle can be locked up indefinitely when Gmail is slow / throttling.
    # On 2026-05-25 we observed 5.8 s/msg — at 458 heartbeats that's 44min.
    # Skip the rest and let LOOKBACK_DAYS=2 catch them on a healthier run.
    PER_LABEL_BUDGET_S = 45
    # Process newest first by reversing UIDs — IMAP's natural order is
    # ascending (oldest first). On time-budget cutoff we'd rather lose the
    # tail (oldest) than the head (newest).
    uids = list(reversed(uids))
    t_start = _time.monotonic()
    for i, uid in enumerate(uids):
        if _time.monotonic() - t_start > PER_LABEL_BUDGET_S:
            print(f"    drain[{label}]: time budget exhausted at {i}/{len(uids)} — "
                  f"remaining {len(uids)-i} uids will be retried next run", file=sys.stderr)
            break
        try:
            row = process_fn(M, uid, label)
        except Exception as e:
            print(f"  parse error on uid={uid!r} in {label!r}: {e}", file=sys.stderr)
            continue
        if row:
            rows.append(row)
        if (i + 1) % 50 == 0:
            print(f"    drain[{label}]: fetched {i+1}/{len(uids)} in {_time.monotonic()-t_start:.0f}s")
    return len(uids), rows


def main() -> int:
    user = os.environ.get("GMAIL_USER", "").strip()
    pw = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    # All alarm labels read into the same email_alarm_events table — the
    # per-row `vendor` column distinguishes them.
    alarm_labels = [
        l for l in (
            os.environ.get("GMAIL_ALARM_LABEL", "").strip(),         # Siemens (legacy var name, original)
            os.environ.get("GMAIL_DELTA_ALARM_LABEL", "").strip(),   # Delta @ Takeda (overlaps §08 direct-API)
            os.environ.get("GMAIL_730750_ALARM_LABEL", "").strip(),  # Northeast Tech (currently empty)
        ) if l
    ]
    hb_label = os.environ.get("GMAIL_HEARTBEAT_LABEL", "").strip()
    if not (user and pw and alarm_labels):
        print("ERROR: GMAIL_USER / GMAIL_APP_PASSWORD / at least one alarm label must be set in watcher/.env",
              file=sys.stderr)
        _update_state(status="error", err="missing env vars")
        return 1

    print(f"[{datetime.now(UTC).isoformat()}] gmail_alarms_poller starting")
    for l in alarm_labels:
        print(f"  alarm label:     {l!r}")
    print(f"  heartbeat label: {hb_label!r}" if hb_label else "  heartbeat label: (unset — skipping)")
    print("  step: connecting Supabase…")
    client = get_client()
    print("  step: connecting IMAP…")

    alarm_seen = alarm_added = 0
    hb_seen = hb_added = 0
    alarm_rows: list[dict] = []
    hb_rows: list[dict] = []

    try:
        M = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=60)
        print("  step: IMAP connected, logging in…")
        M.login(user, pw)
        print("  step: IMAP login OK")
        for label in alarm_labels:
            seen, rows = _drain_label(M, label, _process)
            alarm_seen += seen
            alarm_rows.extend(rows)
            print(f"  [{label}] {seen} msgs, {len(rows)} parsed")
        if hb_label:
            hb_seen, hb_rows = _drain_label(M, hb_label, _process_heartbeat)
            print(f"  [{hb_label}] {hb_seen} msgs, {len(hb_rows)} classified")
        try:
            M.close()
        except Exception:
            pass
        M.logout()
    except Exception as e:
        print(f"ERROR (imap stage): {e}", file=sys.stderr)
        _update_state(status="error", err=str(e)[:1000], seen=alarm_seen + hb_seen)
        return 1

    # Write each batch under its own try so a Supabase blip on one doesn't
    # eat the other's data.
    try:
        if alarm_rows:
            CHUNK = 100
            for i in range(0, len(alarm_rows), CHUNK):
                resp = client.table("email_alarm_events").upsert(
                    alarm_rows[i:i + CHUNK],
                    on_conflict="gmail_msg_id",
                    ignore_duplicates=True,
                ).execute()
                alarm_added += len(resp.data) if resp.data else 0
        if hb_rows:
            CHUNK = 100
            for i in range(0, len(hb_rows), CHUNK):
                resp = client.table("bms_heartbeats").upsert(
                    hb_rows[i:i + CHUNK],
                    on_conflict="gmail_msg_id",
                    ignore_duplicates=True,
                ).execute()
                hb_added += len(resp.data) if resp.data else 0
    except Exception as e:
        print(f"ERROR (db write): {e}", file=sys.stderr)
        _update_state(
            status="error",
            err=str(e)[:1000],
            seen=alarm_seen + hb_seen,
            added=alarm_added + hb_added,
        )
        return 1

    _update_state(
        status="ok",
        seen=alarm_seen + hb_seen,
        added=alarm_added + hb_added,
        err=None,
    )
    print(f"[ok] alarms: seen={alarm_seen} new={alarm_added}  heartbeats: seen={hb_seen} new={hb_added}")
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
