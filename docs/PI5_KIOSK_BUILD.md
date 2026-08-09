# Raspberry Pi 5 Kiosk Build — Step by Step

Turns a CanaKit Raspberry Pi 5 into a zero-touch TV kiosk that boots straight
into the UPark dashboard (`/upark/tv`), recovers from power blips on its own,
and needs no keyboard after day one.

**Kiosk URL:** `https://claudemadedashboard1.vercel.app/upark/tv`
(update here and in `~/kiosk.sh` on the Pi when the custom domain goes live)

---

## Phase 0 — What you need on the table

- CanaKit Raspberry Pi 5 kit (board, case, active cooler, 45W USB-C PSU, micro-HDMI cable, 32GB microSD + USB reader)
- Optional: SanDisk High Endurance 32GB microSD (use as boot card; kit card becomes the spare)
- A TV or monitor with HDMI (final TV or any test screen)
- USB keyboard and mouse (setup day only)
- Network: shop Wi-Fi works fine (the setup script disables Wi-Fi power
  saving, the usual cause of kiosk dropouts); use Ethernet if a jack is handy
- Your Mac, for flashing the card

---

## Phase 1 — Flash the SD card (on the Mac)

1. Download **Raspberry Pi Imager** from <https://www.raspberrypi.com/software/> and install it.
2. Put the microSD in the kit's USB reader and plug it into the Mac.
3. In Imager choose:
   - **Device:** Raspberry Pi 5
   - **OS:** Raspberry Pi OS (64-bit) — the regular desktop version
   - **Storage:** the microSD card
4. Click **Next → Edit Settings** (the OS customization screen) and set:
   - **Hostname:** `kiosk1` (kiosk2, kiosk3… for future locations)
   - **Username / password:** user `kiosk`, pick a password and write it down
   - **Wi-Fi:** the network where you'll first test (e.g. home). The shop's
     Wi-Fi gets added later in one step on the Pi's desktop — the Pi remembers
     both and picks whichever is present.
   - **Locale:** America/New_York, `us` keyboard
   - **Services tab:** enable **SSH** (password authentication) — this is how
     maintenance happens later without touching the TV
5. **Save → Yes → Yes.** Wait for write + verify (~5 min), then eject the card.

---

## Phase 2 — Assemble the Pi

1. **Active cooler onto the board:** peel the film off the thermal pads, seat
   the cooler over the CPU, press the two spring pins into the board holes
   until they click, and plug the fan cable into the small 4-pin **FAN** header.
2. **Board into the case**, lid on.
3. **Insert the microSD** (slot is under the board edge; contacts face the board).
4. **Cables:**
   - micro-HDMI into **HDMI0** — the port *closest to the USB-C power jack*
     (the other port can be blank on boot)
   - other end into the TV's HDMI 1
   - Ethernet, keyboard, mouse
5. **Power last:** plug in the USB-C supply. The Pi boots when power arrives —
   there is no power button. (This is exactly why it self-recovers from blips.)

---

## Phase 3 — First boot

1. The desktop appears in under a minute (first boot is the slowest).
2. If a welcome wizard appears, click through it (most of it is pre-answered
   from the Imager settings). Skip the "update software" step in the wizard.
3. Open a terminal (black icon in the top bar) and update the system:

   ```bash
   sudo apt update && sudo apt full-upgrade -y && sudo reboot
   ```

---

## Phase 4 — Run the kiosk setup script

After the reboot, open a terminal and run:

```bash
curl -fsSL https://claudemadedashboard1.vercel.app/kiosk-setup.sh -o kiosk-setup.sh
bash kiosk-setup.sh
```

What it configures (takes ~1 minute):

| Setting | Effect |
|---|---|
| Boot-to-browser | Chromium opens fullscreen at `/upark/tv` on every boot |
| Crash restart | If the browser ever crashes or closes, it relaunches in 5 s |
| Network wait | Browser doesn't launch until the dashboard URL is reachable |
| Auto-login | Desktop session starts without a password at power-on |
| No screen blanking | The display never sleeps |
| Nightly reboot | 4:00 AM clean reboot — clears memory, picks up dashboard updates |

Then:

```bash
sudo reboot
```

---

## Phase 5 — One-time dashboard login

1. After reboot the Pi lands on the dashboard **login screen**, fullscreen.
2. Log in with the **tv account** (not a personal account).
3. Done — the session is stored on the Pi and renews itself automatically.
   It survives reboots and power cuts. You will not log in again unless the
   account's password is changed or its sessions are revoked.

> **Why the filesystem stays writable:** the dashboard keeps a rotating login
> token on the card. A fully read-only setup would freeze an old token and
> log the kiosk out after the next reboot. The endurance card + clean nightly
> reboots are the corruption protection instead.

---

## Phase 6 — TV settings (do once, on the wall TV)

In the TV's service/settings menu:

1. **Auto power-on after power loss** — Samsung signage: *System → Power
   Control*; LG signage: Installation menu (hold Settings ~5 s, password
   `0000`) → *Power On Status = PWR*
2. **Fixed input:** the HDMI port the Pi is on
3. **Disable** every sleep/eco/auto-off timer ("4 Hour Off", "No Signal Off",
   "No IR Off")

---

## Phase 7 — The acceptance test

With everything running, **pull the TV and Pi power cords mid-day.** Wait 10
seconds, plug back in, and walk away. Within ~2 minutes the dashboard must be
back on screen with live data, untouched. If it is — the build is done.

Also worth testing once: unplug Ethernet for a minute and reconnect. The
dashboard reconnects and catches up on its own (realtime + polling).

---

## Phase 8 — Mount it

- Mount the TV, velcro the Pi to the back, dress the two power cables and
  Ethernet.
- Ideally both TV and Pi plug into the same outlet/strip so an outage hits
  both together — that's the scenario the build is designed to recover from.
- Unplug keyboard and mouse. Store them with the **spare flashed SD card**
  (the kit's EVO+ card): if the kiosk ever misbehaves beyond a power cycle,
  swap card → power on → redo Phase 5 login. Recovery in minutes.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Black screen on boot | Cable in HDMI0? (port nearest USB-C) |
| Login screen instead of dashboard | Session was revoked — redo Phase 5 |
| Dashboard stale / "no data" | Check shop internet; the Pi shows live data again on its own once the network returns |
| Browser shows old version of dashboard | Wait for the 4 AM reboot, or power-cycle the Pi |
| Anything weird | Power-cycle the Pi first; swap to spare SD card second |

Remote maintenance from the Mac, without touching the TV:

```bash
ssh kiosk@kiosk1.local
```
