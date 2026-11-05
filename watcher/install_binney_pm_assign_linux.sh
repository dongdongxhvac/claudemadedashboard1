#!/bin/bash
# Install the PM assign watcher (binney-pm-assign) as a systemd service +
# per-minute timer on the Hetzner VM. It services the Binney manager page's
# "Assign in Cove" button: claims pm_assign_requests rows (migration 0156)
# and runs Cove's UpdatePMTask mutation with the VM's Cove session.
#
# Same shape as the escort manual-run watcher in
# install_binney_escort_poller_linux.sh. Expects watcher/.venv + .env +
# cove_session.json already set up (the pollers' session is reused — the
# Cove account must be allowed to edit PM tasks on the Binney network).
#
#   sudo ./install_binney_pm_assign_linux.sh            # install + enable
#   sudo ./install_binney_pm_assign_linux.sh uninstall  # remove
set -euo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
PYTHON="$WATCHER_DIR/.venv/bin/python"
UNIT="binney-pm-assign"

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

[[ -x "$PYTHON" ]] || { echo "ERROR: venv python not found at $PYTHON" >&2; exit 1; }
[[ -f "$WATCHER_DIR/cove_session.json" ]] || echo "WARN: no cove_session.json — assignments will fail until the Cove session is bootstrapped here."

cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Cove PM assign watcher (services the dashboard's Assign in Cove button)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$WATCHER_DIR
ExecStart=$PYTHON $WATCHER_DIR/pm_assign_watcher.py
TimeoutStartSec=300
EOF

cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Check for PM assign requests every minute

[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=1s
Persistent=false

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "$UNIT.timer"
echo "Installed $UNIT (every minute)."
echo "Logs:   journalctl -u $UNIT.service -n 40 --no-pager"
echo "Status: systemctl list-timers $UNIT.timer"
