# Pi 5 Kiosk — Command Cheat Sheet

Quick reference for operating the shop TV kiosk (`kiosk1`). Run these from
the Mac unless marked "on the Pi." Reminder: the terminal prompt tells you
where you are — `don@Jies-MBP` = Mac, `kiosk1@kiosk1` = Pi. Password prompts
show nothing while you type; that's normal.

---

## Remote access

| What | Command / where |
|---|---|
| SSH from same network | `ssh kiosk1@kiosk1.local` |
| SSH by IP (if `.local` fails) | `ssh kiosk1@<ip>` — find IP on the Pi with `hostname -I` |
| From **anywhere** (screen view + shell) | browser → **connect.raspberrypi.com** → kiosk1 |
| Pi Connect status (on the Pi) | `rpi-connect status` |
| Re-link Pi Connect (on the Pi) | `rpi-connect signin` |
| Copy a file to the Pi | `scp file.txt kiosk1@kiosk1.local:~/` |
| Copy a file from the Pi | `scp kiosk1@kiosk1.local:~/file.txt .` |
| Console under the kiosk (on the Pi, keyboard) | `Ctrl+Alt+F2` → login → work → `Ctrl+Alt+F1` (or `F7`) back |

## Kiosk control

| What | Command |
|---|---|
| **Refresh the dashboard** (loads latest deploy) | `ssh kiosk1@kiosk1.local pkill -f chromium` — watchdog relaunches in 5 s |
| Reboot the Pi | `ssh kiosk1@kiosk1.local sudo reboot` |
| Stop the kiosk (browser stays closed) | `ssh kiosk1@kiosk1.local "pkill -f kiosk.sh; pkill -f chromium"` |
| Start the kiosk again | `ssh kiosk1@kiosk1.local sudo reboot` |
| Change the kiosk URL | edit `~/kiosk.sh` on the Pi (`nano ~/kiosk.sh`), then refresh |
| Switch layout (TV1 ↔ TV2) | sign in with the other screen's account (the account picks the layout); set the URL to `/upark/tv` or `/upark/tv2` to match |
| Shut down cleanly (before unplugging for transport) | `ssh kiosk1@kiosk1.local sudo shutdown -h now` |
| Power on | no button — plug in the USB-C cable |

## Wi-Fi / network

| What | Command (on the Pi) |
|---|---|
| Interactive Wi-Fi menu | `sudo nmtui` |
| List visible networks + signal | `nmcli device wifi list` |
| Join a network | `sudo nmcli device wifi connect 'NETWORK' password 'PASSWORD'` |
| Pre-save a network that isn't in range yet | `sudo nmcli connection add type wifi ifname wlan0 con-name shopwifi ssid 'NETWORK' wifi-sec.key-mgmt wpa-psk wifi-sec.psk 'PASSWORD' connection.autoconnect yes` |
| Current connection + signal strength | `nmcli -f IN-USE,SSID,SIGNAL,RATE device wifi \| head -5` |
| Show the Pi's IP | `hostname -I` |
| Saved connections | `nmcli connection show` |
| Internet reachable? | `ping -c 3 claudemadedashboard1.vercel.app` |

## Health checks

| What | Command (on the Pi) | Good looks like |
|---|---|---|
| Up how long? | `uptime` | resets ~4 AM daily (nightly reboot) |
| CPU temperature | `vcgencmd measure_temp` | < 70 °C |
| Throttling ever? | `vcgencmd get_throttled` | `throttled=0x0` |
| Memory | `free -h` | some MB free — Chromium eats most, that's fine |
| Disk | `df -h /` | plenty free on 32 GB |
| Browser running? | `pgrep -af chromium \| head -2` | at least one line |
| Kiosk watchdog running? | `pgrep -af kiosk.sh` | one line |
| Recent reboots | `last reboot \| head -5` | one per day ≈ nightly cron |

## Updates & maintenance

| What | Command (on the Pi) |
|---|---|
| System update | `sudo apt update && sudo apt full-upgrade -y && sudo reboot` |
| Re-run kiosk setup (safe to repeat) | `curl -fsSL https://claudemadedashboard1.vercel.app/kiosk-setup.sh -o kiosk-setup.sh && bash kiosk-setup.sh` |
| Nightly reboot schedule | `/etc/cron.d/kiosk-nightly-reboot` (default 4:00 AM) |
| Change Pi password | `passwd` |

## The big fixes, in escalation order

1. **Dashboard looks stale/stuck:** refresh — `ssh kiosk1@kiosk1.local pkill -f chromium`
2. **That didn't help:** reboot — `ssh kiosk1@kiosk1.local sudo reboot`
3. **Can't reach it at all:** pull the Pi's power, count to five, plug back in
4. **Still broken:** swap in the spare flashed SD card, power on, log in with `tv@cove.local` — recovery in minutes

## Wall stuck on one board / ignores the Shop TV card (2026-10-30)

Symptom: the Pi shows `UPark TV0` (its boot URL's board) with no rotate chip,
and changes on the admin page's Shop TV card never reach it, while the same
account in a laptop browser behaves. Cause found with a Chromium NetLog: the
Pi's browser answered the kiosk's own profile query (`/rest/v1/users?…
auth_user_id=eq.…`) from its HTTP disk cache — the CORS preflight went out,
the GET never did — so the layout gate worked from a months-old copy of the
Shop TV row. Supabase sends no `Cache-Control`; the web app now sends every
Supabase request with `cache: 'no-store'` (`web/src/lib/supabase.ts`), so a
current build cannot hit this again. If an old build is stuck:

```bash
# on the Pi — stop the launcher loop and the browser, drop the HTTP cache, reboot
pkill -f "kios[k][.]sh"; pkill -x chromium; sleep 3
rm -rf ~/.config/chromium/Default/Cache "$HOME/.config/chromium/Default/Code Cache"
sudo reboot
```

Notes:
- `~/kiosk.sh` is a `while true` loop started at boot; it relaunches Chromium
  with the arguments it read back then. Editing the script changes nothing
  until the loop restarts (reboot).
- The Pi's `/usr/bin/chromium` wrapper strips `--disable-extensions`. Raspberry
  Pi OS bundles uBlock Origin Lite and h264ify; `kiosk-setup.sh` now installs
  `/etc/chromium/policies/managed/kiosk-no-extensions.json` (an
  `ExtensionInstallBlocklist` for everything) so the wall runs without them.
- Don't `pkill -f kiosk.sh` from an ssh one-liner that itself contains
  `kiosk.sh` — it kills your own shell; hence the bracket pattern above.
- To capture a NetLog: add `--log-net-log=/home/kiosk1/netlog.json
  --net-log-capture-mode=IncludeSensitive` to the chromium line in kiosk.sh,
  reboot, wait a minute, read it, then remove the flag and delete the file
  (it contains tokens).

