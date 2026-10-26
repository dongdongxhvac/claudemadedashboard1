#!/bin/bash
# Install the Binney St Cove pollers (pm12 / wo12 / labor) as systemd
# services + timers on the Hetzner VM. Same scripts as UPark's units, run
# with COVE_SITE=binney (see cove_sites.py) so they poll the Binney Portfolio
# network and tag their snapshots site_code='binney' (migration 0152).
#
# Schedules mirror UPark's but run 7 days (Binney's Sun–Wed / Wed–Sat crews):
#   pm12-poller-binney   08,10,12,14,16,18 America/New_York
#   wo12-poller-binney   hourly 07–19
#   labor-poller-binney  hourly 07–19
#
#   sudo ./install_binney_cove_pollers_linux.sh            # install + enable
#   sudo ./install_binney_cove_pollers_linux.sh uninstall  # remove
set -euo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
PYTHON="$WATCHER_DIR/.venv/bin/python"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: needs root to write systemd units — rerun with sudo." >&2
  exit 1
fi

declare -A SCRIPT=( [pm12-poller-binney]=pm12_poller.py [wo12-poller-binney]=wo12_poller.py [labor-poller-binney]=labor_poller.py )
declare -A DESC=(   [pm12-poller-binney]="COVE PM12 poller — Binney St (open PM snapshot + close events)"
                    [wo12-poller-binney]="COVE WO12 poller — Binney St (open WO snapshot + close events)"
                    [labor-poller-binney]="COVE Labor poller — Binney St (week-to-date labor hours)" )
declare -A CAL=(    [pm12-poller-binney]="*-*-* 08,10,12,14,16,18:00:00 America/New_York"
                    [wo12-poller-binney]="*-*-* 07..19:00:00 America/New_York"
                    [labor-poller-binney]="*-*-* 07..19:00:00 America/New_York" )

if [[ "${1:-}" == "uninstall" ]]; then
  for u in "${!SCRIPT[@]}"; do
    systemctl disable --now "$u.timer" 2>/dev/null || true
    rm -f "/etc/systemd/system/$u.service" "/etc/systemd/system/$u.timer"
  done
  systemctl daemon-reload
  echo "Removed Binney Cove poller units"
  exit 0
fi

[[ -x "$PYTHON" ]] || { echo "ERROR: venv python not found at $PYTHON" >&2; exit 1; }
[[ -f "$WATCHER_DIR/cove_session.json" ]] || echo "WARN: no cove_session.json — pollers will fail until the Cove session is bootstrapped here."

for u in "${!SCRIPT[@]}"; do
  cat > "/etc/systemd/system/$u.service" <<UNIT
[Unit]
Description=${DESC[$u]}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$WATCHER_DIR
Environment=COVE_SITE=binney
ExecStart=$PYTHON $WATCHER_DIR/${SCRIPT[$u]}
UNIT

  cat > "/etc/systemd/system/$u.timer" <<UNIT
[Unit]
Description=${DESC[$u]} schedule

[Timer]
OnCalendar=${CAL[$u]}
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
UNIT
done

systemctl daemon-reload
for u in "${!SCRIPT[@]}"; do systemctl enable --now "$u.timer"; done
systemctl list-timers --no-pager | grep -E "binney" || true
echo "Installed. Fire one now:  systemctl start pm12-poller-binney.service && journalctl -u pm12-poller-binney.service -n 40 --no-pager"
