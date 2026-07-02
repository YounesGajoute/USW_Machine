#!/usr/bin/env python3
"""Manual switch test only — press switches and see which pin triggers.

Requires centring_nano_bench firmware:
  py -m platformio run -e centring_nano_bench -t upload

Usage (close Serial Monitor first):
  py scripts/bench_switch_monitor.py              # lower module J2 only
  py scripts/bench_switch_monitor.py --all        # upper + lower
  py scripts/bench_switch_monitor.py --once      # single INPUTS snapshot

Set port: $env:CENTRING_SERIAL_PORT="COM4"
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

INPUTS_RE = re.compile(
    r"INPUTS uh=(\d+) raw=(\d+) act=(\d+) ut=(\d+) raw=(\d+) act=(\d+) "
    r"lh=(\d+) raw=(\d+) act=(\d+) lt=(\d+) raw=(\d+) act=(\d+)"
)

INPUTS_LOWER_RE = re.compile(
    r"INPUTS_LOWER lh=(\d+) raw=(\d+) act=(\d+) lt=(\d+) raw=(\d+) act=(\d+)"
)

SWITCHES_ALL = [
    ("Upper HOME", "uh", "UH", "J1 closed"),
    ("Upper TRAVEL", "ut", "UT", "J1 open"),
    ("Lower HOME", "lh", "LH", "J2 closed"),
    ("Lower TRAVEL", "lt", "LT", "J2 open"),
]

SWITCHES_UPPER = [
    ("Upper HOME", "uh", "UH", "J1 closed — pin 4 (D4)"),
    ("Upper TRAVEL", "ut", "UT", "J1 open — pin 3 (D3)"),
]

SWITCHES_LOWER = [
    ("Lower HOME", "lh", "LH", "J2 closed — pin 15 (A1)"),
    ("Lower TRAVEL", "lt", "LT", "J2 open — pin 14 (A0)"),
]


def open_port(port: str) -> serial.Serial:
    ser = serial.Serial()
    ser.port = port
    ser.baudrate = BAUD
    ser.timeout = 0.2
    ser.dtr = False
    ser.rts = False
    ser.open()
    ser.dtr = False
    ser.rts = False
    return ser


def parse_all(line: str) -> dict[str, int] | None:
    m = INPUTS_RE.search(line)
    if not m:
        return None
    keys = [
        "uh_pin", "uh_raw", "uh_act",
        "ut_pin", "ut_raw", "ut_act",
        "lh_pin", "lh_raw", "lh_act",
        "lt_pin", "lt_raw", "lt_act",
    ]
    return {k: int(v) for k, v in zip(keys, m.groups())}


def parse_lower(line: str) -> dict[str, int] | None:
    m = INPUTS_LOWER_RE.search(line)
    if not m:
        return None
    keys = ["lh_pin", "lh_raw", "lh_act", "lt_pin", "lt_raw", "lt_act"]
    d = {k: int(v) for k, v in zip(keys, m.groups())}
    return d


def print_header(mode: str) -> None:
    print()
    print("=" * 60)
    print("Manual switch monitor — press switches one at a time")
    print("act=1 means firmware sees switch CLOSED to GND (pressed)")
    print("=" * 60)
    if mode == "lower":
        print("Lower module J2:")
        print("  LH  pin 15 (A1) — HOME / guides closed")
        print("  LT  pin 14 (A0) — TRAVEL / guides open")
    elif mode == "upper":
        print("Upper module J1:")
        print("  UH  pin 4 (D4) — HOME / guides closed")
        print("  UT  pin 3 (D3) — TRAVEL / guides open")
    else:
        print("Upper J1:  UH pin 4 (D4) HOME   UT pin 3 (D3) TRAVEL")
        print("Lower J2:  LH pin 15 (A1)  LT pin 14 (A0)")
    print("Ctrl+C to stop")
    print("-" * 60)


def switch_list(mode: str) -> list:
    if mode == "lower":
        return SWITCHES_LOWER
    if mode == "upper":
        return SWITCHES_UPPER
    return SWITCHES_ALL


def format_row(name: str, pin: int, raw: int, act: int, prev_act: int | None) -> str:
    state = "PRESSED" if act else "open"
    marker = "  <-- TRIGGERED" if act and prev_act == 0 else ""
    marker = marker or ("  (released)" if not act and prev_act == 1 else "")
    return f"{name:<14} pin={pin:>2}  raw={raw}  act={act}  [{state}]{marker}"


def show_snapshot(data: dict[str, int], mode: str, prev: dict[str, int] | None) -> bool:
    """Print rows; return True if any act flag changed."""
    switches = switch_list(mode)
    changed = False
    rows: list[str] = []

    for name, key, tag, note in switches:
        pin = data[f"{key}_pin"]
        raw = data[f"{key}_raw"]
        act = data[f"{key}_act"]
        p_act = prev[f"{key}_act"] if prev else None
        if prev is None or act != p_act:
            changed = True
        rows.append((name, tag, pin, raw, act, p_act, note))

    if not changed and prev is not None:
        return False

    ts = time.strftime("%H:%M:%S")
    print(f"\n[{ts}]")
    for name, tag, pin, raw, act, p_act, note in rows:
        line = format_row(name, pin, raw, act, p_act)
        print(line)
        if act and (prev is None or p_act == 0):
            print(f"  >>> {tag} triggered on pin {pin} ({note})")
    return True


def drain_boot(ser: serial.Serial, seconds: float = 2.0) -> None:
    end = time.time() + seconds
    while time.time() < end:
        n = ser.in_waiting
        if n:
            ser.read(n)
        else:
            time.sleep(0.05)


def read_lines(ser: serial.Serial) -> list[str]:
    lines: list[str] = []
    buf = ""
    while ser.in_waiting:
        buf += ser.read(ser.in_waiting).decode("utf-8", errors="replace")
    while "\n" in buf or "\r" in buf:
        for sep in ("\r\n", "\n", "\r"):
            if sep in buf:
                chunk, buf = buf.split(sep, 1)
                s = chunk.strip()
                if s:
                    lines.append(s)
                break
    return lines


def run_once(ser: serial.Serial, mode: str) -> None:
    cmd = "INPUTS_LOWER" if mode == "lower" else "INPUTS"
    ser.write((cmd + "\r\n").encode("ascii"))
    ser.flush()
    time.sleep(0.4)
    parser = parse_lower if mode == "lower" else parse_all
    for line in read_lines(ser):
        data = parser(line)
        if data:
            show_snapshot(data, mode, None)
            return
    print("No INPUTS reply — is centring_nano_bench flashed?")


def run_monitor(ser: serial.Serial, mode: str) -> None:
    cmd = "MONITOR_LOWER" if mode == "lower" else "MONITOR"
    ser.write((cmd + "\r\n").encode("ascii"))
    ser.flush()
    time.sleep(0.3)

    parser = parse_lower if mode == "lower" else parse_all
    prev: dict[str, int] | None = None

    print_header(mode)
    print("Waiting for switch changes…\n")

    try:
        while True:
            for line in read_lines(ser):
                if line.startswith("OK MONITOR"):
                    continue
                data = parser(line)
                if not data:
                    continue
                if show_snapshot(data, mode, prev):
                    prev = dict(data)
            time.sleep(0.05)
    except KeyboardInterrupt:
        print()
    finally:
        ser.write(b"STOP\r\n")
        ser.flush()
        time.sleep(0.3)
        drain_boot(ser, 0.5)
        print("Stopped.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manual switch monitor (no servo motion)")
    parser.add_argument("--all", action="store_true", help="Monitor all 4 switches (default: lower only)")
    parser.add_argument("--upper", action="store_true", help="Upper module only (J1: UH pin 4, UT pin 3)")
    parser.add_argument("--once", action="store_true", help="Single INPUTS snapshot, no streaming")
    parser.add_argument("--port", default=PORT)
    args = parser.parse_args()
    if args.upper and args.all:
        print("Use --upper OR --all, not both", file=sys.stderr)
        return 1
    if args.upper:
        mode = "upper"
    elif args.all:
        mode = "all"
    else:
        mode = "lower"

    try:
        ser = open_port(args.port)
    except serial.SerialException as exc:
        print(f"Cannot open {args.port}: {exc}", file=sys.stderr)
        return 1

    try:
        time.sleep(0.5)
        drain_boot(ser, 2.0)
        if args.once:
            print_header(mode)
            run_once(ser, mode)
        else:
            run_monitor(ser, mode)
    finally:
        ser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
