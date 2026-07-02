#!/usr/bin/env python3
"""Send serial commands to centring Nano without resetting on DTR toggle.

Usage (close device monitor first):
  py scripts/serial_cmd.py PING
  py scripts/serial_cmd.py --verbose STATUS
  py scripts/serial_cmd.py --seq ENABLE HOME STATUS
  py scripts/serial_cmd.py --async HOME
  py scripts/serial_cmd.py --async "MOVEBOTHMM 18 45"

Flash centring_nano_motor for USB serial debug:
  py -m platformio run -e centring_nano_motor -t upload
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

try:
    import serial
except ImportError:
    print("Install pyserial: py -m pip install pyserial", file=sys.stderr)
    sys.exit(1)

PORT = os.environ.get("CENTRING_SERIAL_PORT", "COM4")
BAUD = 115200

_REPLY_START = re.compile(
    r"^(PONG|OK|ERR|DONE|u=|MOTOR_ONLY|READY)",
    re.IGNORECASE,
)
_REPLY_ANYWHERE = re.compile(
    r"(PONG|OK\s|ERR\s|DONE\s|u=|homedU=|en=|hom=|rd=)",
    re.IGNORECASE,
)
_ASYNC_CMDS = {
    "HOME", "HOME_UPPER", "HOME_LOWER", "SEEK_TRAVEL",
    "MOVEBOTHMM", "MOVE_UPPERMM", "MOVE_LOWERMM",
}


def open_port() -> serial.Serial:
    ser = serial.Serial()
    ser.port = PORT
    ser.baudrate = BAUD
    ser.timeout = 0.2
    ser.dtr = False
    ser.rts = False
    ser.open()
    ser.dtr = False
    ser.rts = False
    return ser


def emit_line(line: str, verbose: bool, stats: dict) -> None:
    stats["rx_lines"] += 1
    if verbose:
        s = line.strip()
        if s:
            sys.stdout.write(s + "\n")
            sys.stdout.flush()
            stats["printed"] += 1
        return
    s = line.strip()
    if not s:
        return
    if _REPLY_START.match(s) or _REPLY_ANYWHERE.search(s):
        sys.stdout.write(s + "\n")
        sys.stdout.flush()
        stats["printed"] += 1


def drain(ser: serial.Serial, seconds: float, verbose: bool, stats: dict) -> None:
    end = time.time() + seconds
    buf = ""
    while time.time() < end:
        n = ser.in_waiting
        if n:
            buf += ser.read(n).decode("utf-8", errors="replace")
            while "\n" in buf or "\r" in buf:
                for sep in ("\r\n", "\n", "\r"):
                    if sep in buf:
                        chunk, buf = buf.split(sep, 1)
                        emit_line(chunk, verbose, stats)
                        break
        else:
            time.sleep(0.02)
    if buf.strip():
        emit_line(buf, verbose, stats)


def read_until_done(ser: serial.Serial, tag: str, max_s: float, verbose: bool, stats: dict) -> bool:
    buf = ""
    end = time.time() + max_s
    tag_up = tag.upper()
    while time.time() < end:
        n = ser.in_waiting
        if n:
            buf += ser.read(n).decode("utf-8", errors="replace")
            while "\n" in buf or "\r" in buf:
                for sep in ("\r\n", "\n", "\r"):
                    if sep in buf:
                        chunk, buf = buf.split(sep, 1)
                        emit_line(chunk, verbose, stats)
                        s = chunk.strip().upper()
                        if s.startswith(f"DONE {tag_up}") or s.startswith(f"ERR {tag_up}"):
                            return s.startswith("DONE")
                        break
        else:
            time.sleep(0.02)
    return False


def wait_after_cmd(cmd: str) -> float:
    parts = cmd.upper().split()
    if not parts:
        return 1.0
    name = parts[0]
    if name in _ASYNC_CMDS:
        return 180.0
    if name == "ENABLE":
        return 2.0
    return 1.2


def send_one(ser: serial.Serial, cmd: str, verbose: bool, stats: dict, wait_async: bool) -> None:
    ser.write((cmd + "\r\n").encode("ascii", errors="replace"))
    ser.flush()
    tag = cmd.split()[0].upper()
    if wait_async and tag in _ASYNC_CMDS:
        read_until_done(ser, tag, wait_after_cmd(cmd), verbose, stats)
    else:
        drain(ser, wait_after_cmd(cmd), verbose, stats)


def main() -> int:
    parser = argparse.ArgumentParser(description="Send line commands to centring Nano")
    parser.add_argument("--seq", action="store_true", help="Send multiple commands in one session")
    parser.add_argument("--async", dest="wait_async", action="store_true", help="Wait for DONE/ERR on HOME/MOVE*")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--boot", action="store_true", help="Listen 2s for boot text first")
    parser.add_argument("commands", nargs="*", help="Command(s)")
    opts = parser.parse_args()

    if not opts.commands:
        print(__doc__, file=sys.stderr)
        return 1

    commands = opts.commands if opts.seq else [" ".join(opts.commands)]
    stats = {"printed": 0, "rx_lines": 0}

    try:
        ser = open_port()
    except serial.SerialException as exc:
        print(f"Cannot open {PORT}: {exc}", file=sys.stderr)
        return 1

    try:
        time.sleep(0.5)
        drain(ser, 2.0 if opts.boot else 0.35, opts.verbose, stats)
        for cmd in commands:
            if opts.verbose:
                sys.stdout.write(f"# >> {cmd}\n")
                sys.stdout.flush()
            send_one(ser, cmd, opts.verbose, stats, opts.wait_async)
    finally:
        ser.close()

    if stats["printed"] == 0:
        print(
            f"No replies on {PORT} @ {BAUD} (rx_lines={stats['rx_lines']}).\n"
            "  Reflash: py -m platformio run -e centring_nano_motor -t upload\n"
            "  Test:    py scripts/serial_cmd.py --verbose --boot PING",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
