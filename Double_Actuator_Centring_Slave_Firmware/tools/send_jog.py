#!/usr/bin/env python3
"""Send one command to servo_jog on USB (DTR/RTS held inactive — no MCU reboot).

Usage (from repo root):
  python3 tools/send_jog.py S
  python3 tools/send_jog.py SEEK_TRAVEL_LOWER 180
  python3 tools/send_jog.py SEEK_HOME_LOWER 180
  python3 tools/send_jog.py STATUS

Trailing integer = timeout seconds (default 5; use 180 for seeks).
Prefer one long `pio device monitor -e servo_jog` session for multi-step
sequences — each open still takes the port exclusively.
"""
from __future__ import annotations

import os
import sys
import time

import serial

PORT = os.environ.get("JOG_PORT", os.environ.get("CENTRING_PORT", "/dev/ttyUSB2"))
BAUD = 115200


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__.strip())
        return 1

    timeout = 5.0
    if len(args) >= 2 and args[-1].replace(".", "", 1).isdigit():
        timeout = float(args[-1])
        args = args[:-1]

    cmd = " ".join(args)
    # Alias Test_PlatformIO STATUS → S
    if cmd.upper() == "STATUS":
        cmd = "S"

    ser = serial.Serial()
    ser.port = PORT
    ser.baudrate = BAUD
    ser.timeout = 0.4
    ser.dsrdtr = False
    ser.rtscts = False
    ser.dtr = False
    ser.rts = False
    ser.open()
    # Some USB-serial adapters pulse DTR on open; clear again immediately.
    ser.dtr = False
    ser.rts = False
    time.sleep(0.25)
    while ser.in_waiting:
        ser.readline()

    ser.write((cmd + "\n").encode())
    ser.flush()

    deadline = time.time() + timeout
    got = False
    while time.time() < deadline:
        raw = ser.readline().decode(errors="replace").strip()
        if not raw:
            continue
        print(raw)
        got = True
        u = raw.upper()
        if u.startswith(("DONE", "ERR", "OK ")) or raw.startswith("pu="):
            # Keep reading a bit more STATUS lines after DONE
            if u.startswith("DONE") or u.startswith("ERR"):
                time.sleep(0.15)
                while ser.in_waiting:
                    extra = ser.readline().decode(errors="replace").strip()
                    if extra:
                        print(extra)
                break
            if cmd.upper() in ("S", "STATUS", "PINS") and raw.startswith(
                ("pu=", "pins ")
            ):
                break

    ser.close()
    return 0 if got else 1


if __name__ == "__main__":
    sys.exit(main())
