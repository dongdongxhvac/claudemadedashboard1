#!/bin/bash
# Register the UPark OT API poller as a macOS LaunchAgent, every 5 minutes.
# The Mac must be on the OT viewer's tailnet. launchd does not fire while
# the Mac is asleep; a missed slot runs once on wake.
#
#   ./install_ot_api_poller_mac.sh            # install + load
#   ./install_ot_api_poller_mac.sh uninstall  # remove
set -euo pipefail

WATCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.claudemade.upark-ot-api-poller"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PYTHON="$WATCHER_DIR/.venv/bin/python"
LOG="$WATCHER_DIR/logs/ot_api_poller.log"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

[[ -x "$PYTHON" ]] || { echo "ERROR: venv python not found at $PYTHON — create it first (python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)"; exit 1; }
grep -q '^UPARK_OT_API_KEY=' "$WATCHER_DIR/.env" 2>/dev/null || echo "WARN: UPARK_OT_API_KEY is not set in $WATCHER_DIR/.env — the poller will fail until it is."
mkdir -p "$WATCHER_DIR/logs"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$WATCHER_DIR/ot_api_poller.py</string>
  </array>
  <key>WorkingDirectory</key><string>$WATCHER_DIR</string>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Registered $LABEL:"
echo "  Fires : every 5 minutes (and once now)"
echo "  Log   : $LOG"
echo "Tail:    tail -f \"$LOG\""
