#!/bin/bash
# UPark TV kiosk setup — Raspberry Pi 5, Raspberry Pi OS (Bookworm, desktop).
# Run as the desktop user (NOT root):  bash kiosk-setup.sh
# Configures: boot-to-Chromium kiosk at the dashboard URL, crash auto-restart,
# desktop auto-login, screen blanking off, nightly 4am reboot.
set -e

KIOSK_URL="${KIOSK_URL:-https://claudemadedashboard1.vercel.app/upark/tv}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the normal desktop user, not root/sudo." >&2
  exit 1
fi

# --- find chromium ------------------------------------------------------------
CHROME="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$CHROME" ]; then
  echo "Installing Chromium..."
  sudo apt-get update
  sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
  CHROME="$(command -v chromium-browser || command -v chromium)"
fi
echo "Using browser: $CHROME"

# --- kiosk launcher with crash-restart loop ----------------------------------
cat > "$HOME/kiosk.sh" <<EOF
#!/bin/bash
# Launched at session start. flock prevents double-launch if more than one
# autostart hook fires; the while-loop restarts the browser if it ever crashes.
exec 9>/tmp/kiosk.lock
flock -n 9 || exit 0

# wait for the network before first launch
sleep 5
until curl -fsm 5 "$KIOSK_URL" >/dev/null 2>&1; do sleep 3; done

while true; do
  "$CHROME" --kiosk --noerrdialogs --disable-infobars \\
    --disable-session-crashed-bubble --disable-features=Translate \\
    --autoplay-policy=no-user-gesture-required \\
    "$KIOSK_URL"
  sleep 5
done
EOF
chmod +x "$HOME/kiosk.sh"
echo "Wrote $HOME/kiosk.sh (URL: $KIOSK_URL)"

# --- autostart hooks (labwc / wayfire / X11 — only the active one fires) -----
# labwc (Raspberry Pi OS Bookworm 2024+)
mkdir -p "$HOME/.config/labwc"
grep -q "kiosk.sh" "$HOME/.config/labwc/autostart" 2>/dev/null || \
  echo "$HOME/kiosk.sh &" >> "$HOME/.config/labwc/autostart"

# wayfire (early Bookworm)
if [ -f "$HOME/.config/wayfire.ini" ] && ! grep -q "kiosk.sh" "$HOME/.config/wayfire.ini"; then
  if grep -q '^\[autostart\]' "$HOME/.config/wayfire.ini"; then
    sed -i "/^\[autostart\]/a kiosk = $HOME/kiosk.sh" "$HOME/.config/wayfire.ini"
  else
    printf '\n[autostart]\nkiosk = %s/kiosk.sh\n' "$HOME" >> "$HOME/.config/wayfire.ini"
  fi
fi

# X11 / LXDE fallback
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Kiosk
Exec=$HOME/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF
echo "Autostart hooks installed (labwc, wayfire, X11)."

# --- system settings ----------------------------------------------------------
echo "Enabling desktop auto-login..."
sudo raspi-config nonint do_boot_behaviour B4

echo "Disabling screen blanking..."
sudo raspi-config nonint do_blanking 1

echo "Installing nightly 4am reboot..."
echo "0 4 * * * root /sbin/shutdown -r now" | sudo tee /etc/cron.d/kiosk-nightly-reboot >/dev/null

echo "Disabling Wi-Fi power saving (prevents idle Wi-Fi dropouts)..."
printf '[connection]\nwifi.powersave = 2\n' | \
  sudo tee /etc/NetworkManager/conf.d/wifi-powersave-off.conf >/dev/null

echo
echo "=== Done. Reboot now (sudo reboot) — the Pi will boot straight into the dashboard."
echo "=== First boot only: log in on the dashboard with the tv account; the session persists."
