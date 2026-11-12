#!/usr/bin/env python3
"""wallpad — make the shop wall's two-key USB pad usable on a Raspberry Pi 5.

Why this exists (2026-11-12). The pad (FQ-K002 RGB, USB 5131:5345) never
answers the keyboard-LED SET_REPORT that the kernel's HID driver sends to
every boot keyboard when it connects. The request hangs on the control
endpoint, the next control request times out after 5 s, the kernel cancels
it, and the Pi 5's USB controller (RP1 / dwc3, kernel 6.18) never completes
the Stop Endpoint command: "xHCI host controller not responding, assume
dead" ten seconds after the pad is plugged in, taking every port on that
controller down until a reboot.

So the kernel is told to leave the pad alone
(cmdline: usbhid.quirks=0x5131:0x5345:0x4) and this service reads it
instead. It claims the pad's HID interfaces through usbfs, reads their
interrupt-IN endpoints (it never sends the pad anything) and replays each
physical key as a harmless F13 / F14 / ... press on a virtual keyboard.
The wall page (web/src/hooks/useTvKeypad.ts) learns which one is NEXT and
which is HOLD — whatever the pad was programmed to send.

Needs: python3-usb, python3-evdev. Runs as root (usbfs + /dev/uinput).
Installed by kiosk-setup.sh as wallpad.service.
"""
import json
import os
import threading
import time

import usb.core
import usb.util
from evdev import UInput, ecodes as e

VID, PID = 0x5131, 0x5345
MAP_FILE = '/var/lib/wallpad/keys.json'
# Output keys, handed out in order of first appearance. F13+ do nothing in a
# browser on their own, unlike whatever the pad itself sends (Ctrl+V, F5 ...).
SLOTS = [e.KEY_F13, e.KEY_F14, e.KEY_F15, e.KEY_F16, e.KEY_F17, e.KEY_F18,
         e.KEY_F19, e.KEY_F20, e.KEY_F21, e.KEY_F22, e.KEY_F23, e.KEY_F24]


def log(*args):
    print(*args, flush=True)


class Keys:
    """Physical key id -> output slot, remembered across restarts."""

    def __init__(self):
        try:
            with open(MAP_FILE) as f:
                self.ids = [str(x) for x in json.load(f)]
        except Exception:
            self.ids = []
        self.lock = threading.Lock()

    def slot(self, key_id):
        with self.lock:
            if key_id not in self.ids:
                self.ids.append(key_id)
                os.makedirs(os.path.dirname(MAP_FILE), exist_ok=True)
                with open(MAP_FILE, 'w') as f:
                    json.dump(self.ids, f)
                log(f'new key {key_id} -> F{12 + len(self.ids)}')
            return SLOTS[self.ids.index(key_id) % len(SLOTS)]


def pressed_ids(iface, boot_keyboard, data):
    """The keys a report says are down, as stable ids."""
    body = bytes(data)
    if boot_keyboard and len(body) >= 3:
        # Boot keyboard report: modifiers, reserved, up to six usages.
        # Usages 1-3 are error codes; a modifier alone is not a key.
        return {f'k{body[0]:02x}:{u:02x}' for u in body[2:8] if u > 3}
    # Anything else (consumer / vendor interface): a non-idle report is one
    # "key". Idle = all zero, or a small report id followed by zeros.
    if not any(body):
        return set()
    if len(body) > 1 and body[0] <= 8 and not any(body[1:]):
        return set()
    return {f'i{iface}:{body.hex()}'}


def reader(dev, iface, ep, boot_keyboard, keys, ui, ui_lock, stop):
    held = set()
    try:
        while not stop.is_set():
            # timeout=0: wait for a report however long it takes. A timed
            # read would cancel the transfer every time it expired, and a
            # cancelled transfer is what this pad and controller choke on.
            data = dev.read(ep.bEndpointAddress, ep.wMaxPacketSize, timeout=0)
            now = pressed_ids(iface, boot_keyboard, data)
            if now == held:
                continue
            with ui_lock:
                for k in sorted(now - held):
                    ui.write(e.EV_KEY, keys.slot(k), 1)
                    log(f'press {k}')
                for k in sorted(held - now):
                    ui.write(e.EV_KEY, keys.slot(k), 0)
                ui.syn()
            held = now
    except usb.core.USBError as ex:
        log(f'interface {iface}: {ex}')
    finally:
        with ui_lock:
            for k in held:
                ui.write(e.EV_KEY, keys.slot(k), 0)
            ui.syn()
        stop.set()


def serve(dev, keys, ui, ui_lock):
    stop = threading.Event()
    started = 0
    for intf in dev.get_active_configuration():
        if intf.bInterfaceClass != 3:      # HID only
            continue
        ep = next((x for x in intf
                   if usb.util.endpoint_direction(x.bEndpointAddress) == usb.util.ENDPOINT_IN
                   and usb.util.endpoint_type(x.bmAttributes) == usb.util.ENDPOINT_TYPE_INTR), None)
        if ep is None:
            continue
        n = intf.bInterfaceNumber
        if dev.is_kernel_driver_active(n):
            # Only happens when the usbhid quirk is missing from the cmdline.
            log(f'interface {n}: kernel driver bound — is usbhid.quirks set? detaching')
            dev.detach_kernel_driver(n)
        usb.util.claim_interface(dev, n)
        boot_keyboard = intf.bInterfaceSubClass == 1 and intf.bInterfaceProtocol == 1
        threading.Thread(target=reader, daemon=True,
                         args=(dev, n, ep, boot_keyboard, keys, ui, ui_lock, stop)).start()
        started += 1
    if started == 0:
        log('pad has no readable HID interface')
        time.sleep(10)
        return
    log(f'pad attached: reading {started} interface(s)')
    stop.wait()
    usb.util.dispose_resources(dev)
    log('pad detached')


def main():
    keys = Keys()
    # A full key range so every consumer treats the device as a keyboard;
    # only the F13+ slots are ever pressed.
    ui = UInput({e.EV_KEY: list(range(e.KEY_ESC, e.KEY_F24 + 1))},
                name='wallpad', vendor=VID, product=PID)
    ui_lock = threading.Lock()
    log(f'wallpad ready, waiting for {VID:04x}:{PID:04x}; known keys: {keys.ids}')
    while True:
        dev = usb.core.find(idVendor=VID, idProduct=PID)
        if dev is None:
            time.sleep(2)
            continue
        try:
            serve(dev, keys, ui, ui_lock)
        except usb.core.USBError as ex:
            log(f'pad error: {ex}')
        time.sleep(2)


if __name__ == '__main__':
    main()
