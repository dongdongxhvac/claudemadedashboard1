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

With usbhid out of the picture nobody performs the HID handshake, and the
pad stays silent without it. The service does the two harmless parts the
kernel did successfully in the capture — SET_IDLE and reading the report
descriptor — per interface, and never the LED SET_REPORT.

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
# The first reports of each interface go to the journal raw, so a pad that
# speaks an unexpected format can be read off `journalctl -u wallpad`.
RAW_LOG_LIMIT = 40
CTRL_TIMEOUT_MS = 2000


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


def pressed_ids(iface, kind, data):
    """The keys a report says are down, as stable ids."""
    body = bytes(data)
    if kind == 'keyboard' and len(body) >= 3:
        # Boot keyboard report: modifiers, reserved, up to six usages.
        # Usages 1-3 are error codes; a modifier alone is not a key.
        return {f'k{body[0]:02x}:{u:02x}' for u in body[2:8] if u > 3}
    if kind == 'mouse' and len(body) >= 1:
        # Boot mouse report: buttons, dx, dy(, wheel). A key programmed as a
        # mouse button is still a key; movement is not.
        return {f'm{bit}' for bit in range(8) if body[0] >> bit & 1}
    # Anything else (consumer / vendor interface): a non-idle report is one
    # "key". Idle = all zero — after the report id, when the interface's
    # descriptor uses ids ("numbered").
    payload = body[1:] if kind == 'numbered' else body
    if not any(payload):
        return set()
    return {f'i{iface}:{body.hex()}'}


def reader(dev, iface, ep, kind, keys, ui, ui_lock, stop):
    held = set()
    seen = 0
    try:
        while not stop.is_set():
            # timeout=0: wait for a report however long it takes. A timed
            # read would cancel the transfer every time it expired, and a
            # cancelled transfer is what this pad and controller choke on.
            data = dev.read(ep.bEndpointAddress, ep.wMaxPacketSize, timeout=0)
            if seen < RAW_LOG_LIMIT:
                seen += 1
                log(f'report if{iface} {bytes(data).hex()}')
            now = pressed_ids(iface, kind, data)
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


def uses_report_ids(desc):
    """True when a HID report descriptor contains a Report ID item (0x85)."""
    i = 0
    while i < len(desc):
        prefix = desc[i]
        if prefix == 0xFE:                      # long item
            i += 3 + (desc[i + 1] if i + 1 < len(desc) else 0)
            continue
        if prefix & 0xFC == 0x84:
            return True
        i += 1 + (4 if prefix & 3 == 3 else prefix & 3)
    return False


def hid_handshake(dev, intf):
    """What usbhid does when it binds an interface, minus the LED report:
    SET_IDLE, then read the report descriptor. Both are answered by the pad
    (seen in the usbmon capture); failures are logged, never fatal.
    Returns the report descriptor (empty when it could not be read)."""
    n = intf.bInterfaceNumber
    extra = bytes(intf.extra_descriptors or [])
    length = 0
    i = 0
    while i + 1 < len(extra) and extra[i]:
        if extra[i + 1] == 0x21 and extra[i] >= 9:
            length = extra[i + 7] | extra[i + 8] << 8
        i += extra[i]
    try:
        dev.ctrl_transfer(0x21, 0x0A, 0x0000, n, None, timeout=CTRL_TIMEOUT_MS)
    except usb.core.USBError as ex:
        log(f'interface {n}: SET_IDLE: {ex}')
    if length:
        try:
            desc = bytes(dev.ctrl_transfer(0x81, 0x06, 0x2200, n, length, timeout=CTRL_TIMEOUT_MS))
            log(f'interface {n}: report descriptor {desc.hex()}')
            return desc
        except usb.core.USBError as ex:
            log(f'interface {n}: report descriptor: {ex}')
    return b''


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
        desc = hid_handshake(dev, intf)
        boot = intf.bInterfaceSubClass == 1
        kind = ('keyboard' if boot and intf.bInterfaceProtocol == 1
                else 'mouse' if boot and intf.bInterfaceProtocol == 2
                else 'numbered' if uses_report_ids(desc) else 'other')
        threading.Thread(target=reader, daemon=True,
                         args=(dev, n, ep, kind, keys, ui, ui_lock, stop)).start()
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
