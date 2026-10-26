"""Per-site configuration for the Cove pollers (pm12 / wo12 / labor).

One set of scripts, two Cove networks. The systemd unit sets COVE_SITE
(default 'upark' so every existing unit behaves exactly as before); the
pollers read NETWORK_ID, the snapshot site_code tag, the roster scope and
the filename label from here. Migration 0152 adds site_code to snapshots /
pm_close_events / wo_close_events and site-aware views.

    COVE_SITE=binney .venv/bin/python pm12_poller.py

Binney specifics:
  * no legacy assignee list — the roster (engineer_profiles.cove_user_id,
    backfilled 2026-10-26) is the only source, and the pollers refuse to run
    with an empty list (an empty Cove assignee filter pulls the whole
    network: BioMed Realty staff, janitorial, security…);
  * managers included — Andrew Balbo / Ed Nardone carry and close PMs;
  * no Sunday skip — the Sun–Wed crew works Sundays;
  * WO status 'scheduled' is open there (absent from UPark's WO12).
"""
from __future__ import annotations

import os

SITE: str = (os.environ.get("COVE_SITE") or "upark").strip().lower()

_SITES: dict[str, dict] = {
    "upark": {
        "network_id":    os.environ.get("COVE_NETWORK_ID", "OoxMP8BZJF").strip(),
        "label":         "",                      # filenames unchanged for UPark
        "roster_roles":  ("engineer",),
        "sunday_skip":   True,
        "use_legacy":    True,
        "wo_extra_open": [],
    },
    "binney": {
        "network_id":    os.environ.get("COVE_BINNEY_NETWORK_ID", "moBABfC2ZR").strip(),
        "label":         "Binney",
        "roster_roles":  ("engineer", "manager"),
        "sunday_skip":   False,
        "use_legacy":    False,
        "wo_extra_open": ["scheduled"],
    },
}

if SITE not in _SITES:
    raise SystemExit(f"COVE_SITE={SITE!r} unknown — expected one of {sorted(_SITES)}")

CFG: dict = _SITES[SITE]
NETWORK_ID: str = CFG["network_id"]


def filename_label(base: str) -> str:
    """'COVE PM12' → 'COVE PM12' (upark) / 'COVE Binney PM12' (binney).
    Keeps the (kind, filename) unique index from colliding across sites."""
    label = CFG["label"]
    if not label:
        return base
    head, _, tail = base.partition(" ")
    return f"{head} {label} {tail}" if tail else f"{base} {label}"


def sunday_skip() -> bool:
    return bool(CFG["sunday_skip"])
