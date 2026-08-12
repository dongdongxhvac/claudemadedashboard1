#!/bin/bash
# Install the Binney Escort poller as a systemd service + timer on the
# Hetzner VM (Ubuntu). Fires hourly 07:00-19:00 America/New_York, daily;
# Persistent=true catches up a missed slot after downtime.
#
# Also installs the manual-run watcher (binney-escort-watch): a per-minute
# timer that services the /binney/exp "Refresh now" button by starting the
# poller when a run request appears in Supabase.
#
#   sudo ./install_binney_escort_poller_linux.sh            # install + enable
#   sudo ./install_binney_escort_poller_linux.sh uninstall  # remove
#
# Paths are derived from this script's location, so the repo can live
# anywhere on the VM. Expects the same watcher/.venv + .env +
# cove_session.json layout as the other pollers.
set -euo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT="binney-escort-poller"
WATCH_UNIT="binney-escort-watch"
RUN_USER="${SUDO_USER:-$(id -un)}"
PYTHON="$WATCHER_DIR/.venv/bin/python"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: needs root to write systemd units — rerun with sudo." >&2
  exit 1
fi

if [[ "${1:-}" == "uninstall" ]]; then
  systemctl disable --now "$UNIT.timer" "$WATCH_UNIT.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer" \
        "/etc/systemd/system/$WATCH_UNIT.service" "/etc/systemd/system/$WATCH_UNIT.timer"
  systemctl daemon-reload
  echo "Removed $UNIT + $WATCH_UNIT"
  exit 0
fi

[[ -x "$PYTHON" ]] || { echo "ERROR: venv python not found at $PYTHON — create it first (python3 -m venv .venv && .venv/bin/pip install supabase python-dotenv requests)" >&2; exit 1; }
[[ -f "$WATCHER_DIR/cove_session.json" ]] || echo "WARN: no cove_session.json — poller will fail until the Cove session is bootstrapped/copied here."

cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Cove Binney Escort poller (feeds /binney/exp)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$WATCHER_DIR
ExecStart=$PYTHON $WATCHER_DIR/binney_escort_poller.py
EOF

cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Hourly Binney escort poll, 7 AM - 7 PM ET

[Timer]
OnCalendar=*-*-* 07..19:00:00 America/New_York
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > "/etc/systemd/system/$WATCH_UNIT.service" <<EOF
[Unit]
Description=Binney escort manual-run watcher (services the /binney/exp button)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$WATCHER_DIR
ExecStart=$PYTHON $WATCHER_DIR/escort_run_watcher.py
TimeoutStartSec=660
EOF

cat > "/etc/systemd/system/$WATCH_UNIT.timer" <<EOF
[Unit]
Description=Check for /binney/exp manual run requests every minute

[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=1s
Persistent=false

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "$UNIT.timer" "$WATCH_UNIT.timer"

echo "Registered $UNIT:"
echo "  Fires : hourly 07:00-19:00 America/New_York (Persistent=true)"
echo "  As    : $RUN_USER"
echo "Registered $WATCH_UNIT:"
echo "  Fires : every minute (services manual run requests)"
echo ""
echo "Run once now:  systemctl start $UNIT.service"
echo "Logs:          journalctl -u $UNIT -n 30 --no-pager"
echo "Watcher logs:  journalctl -u $WATCH_UNIT -n 30 --no-pager"
echo "Timer status:  systemctl list-timers $UNIT.timer $WATCH_UNIT.timer"
