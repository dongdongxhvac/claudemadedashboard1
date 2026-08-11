#!/bin/bash
# Register the Binney Escort poller as a macOS LaunchAgent.
# Hourly 7 AM - 7 PM local time, daily — mirrors the Windows Task Scheduler
# setup (install_binney_escort_poller_task.ps1). Note: launchd does not fire
# while the Mac is asleep; a missed slot runs once on wake.
#
#   ./install_binney_escort_poller_mac.sh            # install + load
#   ./install_binney_escort_poller_mac.sh uninstall  # remove
set -euo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.claudemade.binney-escort-poller"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PYTHON="$WATCHER_DIR/.venv/bin/python"
LOG="$WATCHER_DIR/logs/binney_escort_poller.log"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

[[ -x "$PYTHON" ]] || { echo "ERROR: venv python not found at $PYTHON — create it first (python3 -m venv .venv && .venv/bin/pip install supabase python-dotenv requests)"; exit 1; }
[[ -f "$WATCHER_DIR/cove_session.json" ]] || echo "WARN: no cove_session.json yet — poller will fail until you run: .venv/bin/python cove_session.py bootstrap"
mkdir -p "$WATCHER_DIR/logs"

# One StartCalendarInterval entry per hour, 7..19.
INTERVALS=""
for h in 7 8 9 10 11 12 13 14 15 16 17 18 19; do
  INTERVALS+="    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>
"
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$WATCHER_DIR/binney_escort_poller.py</string>
  </array>
  <key>WorkingDirectory</key><string>$WATCHER_DIR</string>
  <key>StartCalendarInterval</key>
  <array>
$INTERVALS  </array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Registered $LABEL:"
echo "  Fires : hourly 7 AM - 7 PM local, daily"
echo "  Log   : $LOG"
echo ""
echo "Run once now:   launchctl kickstart gui/$(id -u)/$LABEL"
echo "Tail the log:   tail -20 '$LOG'"
