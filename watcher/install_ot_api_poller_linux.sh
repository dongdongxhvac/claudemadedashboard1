#!/bin/bash
# Install the UPark OT API poller as a systemd service + timer (Hetzner VM /
# any Linux host that is on the OT viewer's tailnet). Fires every 5 minutes,
# around the clock — the schedule changes whenever Outlook does, and Steve's
# handoff asks for no more than one read a minute.
#
#   sudo ./install_ot_api_poller_linux.sh            # install + enable
#   sudo ./install_ot_api_poller_linux.sh uninstall  # remove
#
# Paths are derived from this script's location. Expects the same
# watcher/.venv + .env layout as the other pollers, with UPARK_OT_API_KEY set.
set -euo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT="upark-ot-api-poller"
RUN_USER="${SUDO_USER:-$(id -un)}"
PYTHON="$WATCHER_DIR/.venv/bin/python"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: needs root to write systemd units — rerun with sudo." >&2
  exit 1
fi

if [[ "${1:-}" == "uninstall" ]]; then
  systemctl disable --now "$UNIT.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer"
  systemctl daemon-reload
  echo "Removed $UNIT"
  exit 0
fi

[[ -x "$PYTHON" ]] || { echo "ERROR: venv python not found at $PYTHON — create it first (python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)" >&2; exit 1; }
grep -q '^UPARK_OT_API_KEY=' "$WATCHER_DIR/.env" 2>/dev/null || echo "WARN: UPARK_OT_API_KEY is not set in $WATCHER_DIR/.env — the poller will fail until it is."

cat > "/etc/systemd/system/$UNIT.service" <<UNIT_EOF
[Unit]
Description=UPark Overtime API poller (feeds /upark/manager §11b + TV2)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$WATCHER_DIR
ExecStart=$PYTHON $WATCHER_DIR/ot_api_poller.py
TimeoutStartSec=120
UNIT_EOF

cat > "/etc/systemd/system/$UNIT.timer" <<UNIT_EOF
[Unit]
Description=Poll the UPark Overtime API every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=false

[Install]
WantedBy=timers.target
UNIT_EOF

systemctl daemon-reload
systemctl enable --now "$UNIT.timer"

echo "Registered $UNIT:"
echo "  Fires : every 5 minutes"
echo "  As    : $RUN_USER"
echo ""
echo "Run once now:  systemctl start $UNIT.service"
echo "Logs:          journalctl -u $UNIT -n 30 --no-pager"
echo "Timer status:  systemctl list-timers $UNIT.timer"
