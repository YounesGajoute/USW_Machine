#!/usr/bin/env python3
"""Test etch-module HOME (closed) and SEEK_TRAVEL (full open) on production firmware.

Requires centring_nano_motor (not bench firmware):
  py -m platformio run -e centring_nano_motor -t upload

Usage (close Serial Monitor first):
  py scripts/test_home_travel.py
  py scripts/test_home_travel.py --home-only
  py scripts/test_home_travel.py --travel-only
  py scripts/test_home_travel.py --return-home

Expected after HOME:     u=0  l=0  h=0   (guides closed, 0 mm per side)
Expected after TRAVEL:   u=90 l=90 h=67.6 (guides open, 33.8 mm per side)
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
TIMEOUT_S = 120.0

STATUS_RE = re.compile(
    r"u=([\d.-]+)\s+l=([\d.-]+)\s+h=([\d.-]+).*?"
    r"homedUpper=(\d+)\s+homedLower=(\d+).*?"
    r"uh=(\d+)\s+ut=(\d+)\s+lh=(\d+)\s+lt=(\d+)\s+pu=(\d+)\s+pl=(\d+)"
)

DONE_RE = re.compile(
    r"^DONE\s+(\S+)\s+u=([\d.-]+)\s+l=([\d.-]+)\s+h=([\d.-]+)\s+"
    r"homedUpper=(\d+)\s+homedLower=(\d+)\s+pu=(\d+)\s+pl=(\d+)"
)


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


def drain(ser: serial.Serial, seconds: float = 0.4) -> list[str]:
    lines: list[str] = []
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
                        s = chunk.strip()
                        if s:
                            lines.append(s)
                            print(s)
                        break
        else:
            time.sleep(0.02)
    return lines


def send_async(ser: serial.Serial, cmd: str, tag: str, max_s: float = TIMEOUT_S) -> str | None:
    print(f"\n>> {cmd}")
    ser.write((cmd + "\r\n").encode("ascii"))
    ser.flush()
    end = time.time() + max_s
    buf = ""
    tag_up = tag.upper()
    while time.time() < end:
        n = ser.in_waiting
        if n:
            buf += ser.read(n).decode("utf-8", errors="replace")
            while "\n" in buf or "\r" in buf:
                for sep in ("\r\n", "\n", "\r"):
                    if sep in buf:
                        chunk, buf = buf.split(sep, 1)
                        s = chunk.strip()
                        if s:
                            print(s)
                        up = s.upper()
                        if up.startswith("PROG "):
                            continue
                        if up.startswith(f"DONE {tag_up}"):
                            return s
                        if up.startswith(f"ERR {tag_up}"):
                            return s
                        break
        else:
            time.sleep(0.02)
    print(f"TIMEOUT waiting for {tag}")
    return None


def send_sync(ser: serial.Serial, cmd: str) -> list[str]:
    print(f"\n>> {cmd}")
    ser.write((cmd + "\r\n").encode("ascii"))
    ser.flush()
    return drain(ser, 2.0)


def parse_status(line: str) -> dict | None:
    m = STATUS_RE.search(line)
    if not m:
        return None
    keys = ["u", "l", "h", "homedUpper", "homedLower", "uh", "ut", "lh", "lt", "pu", "pl"]
    out = {}
    for k, v in zip(keys, m.groups()):
        out[k] = float(v) if k in ("u", "l", "h") else int(v)
    return out


def parse_done(line: str) -> dict | None:
    m = DONE_RE.match(line.strip())
    if not m:
        return None
    return {
        "tag": m.group(1),
        "u": float(m.group(2)),
        "l": float(m.group(3)),
        "h": float(m.group(4)),
        "homedUpper": int(m.group(5)),
        "homedLower": int(m.group(6)),
        "pu": int(m.group(7)),
        "pl": int(m.group(8)),
    }


def fetch_status(ser: serial.Serial) -> dict | None:
    for _ in range(3):
        for line in send_sync(ser, "STATUS"):
            if line.startswith("u=") and "pl=" in line:
                st = parse_status(line)
                if st:
                    return st
        time.sleep(0.2)
    return None


def print_position(label: str, st: dict | None, expect: dict) -> bool:
    print(f"\n--- {label} ---")
    if not st:
        print("FAIL: no STATUS parsed")
        return False
    ok = True
    rows = [
        ("u (upper °)", st["u"], expect.get("u"), 1.0),
        ("l (lower °)", st["l"], expect.get("l"), 1.0),
        ("h total mm", st["h"], expect.get("h"), 0.6),
        ("homedUpper", st["homedUpper"], expect.get("homedUpper"), 0),
        ("homedLower", st["homedLower"], expect.get("homedLower"), 0),
    ]
    print(f"{'Field':<14} {'Actual':>10} {'Expected':>10}  {'':>8}")
    print("-" * 46)
    for name, actual, expected, tol in rows:
        if expected is None:
            print(f"{name:<14} {actual:>10}")
            continue
        diff = abs(float(actual) - float(expected))
        pass_row = diff <= tol
        if not pass_row:
            ok = False
        mark = "OK" if pass_row else "FAIL"
        print(f"{name:<14} {actual:>10} {expected:>10}  {mark}")
    sw = [
        ("UH (HOME pin 4)", st["uh"]),
        ("UT (TRAVEL pin 3)", st["ut"]),
        ("LH (HOME pin 15)", st["lh"]),
        ("LT (TRAVEL pin 14)", st["lt"]),
    ]
    print("\nSwitches (1 = pressed):")
    for name, val in sw:
        print(f"  {name}: {val}")
    print(f"  PWM  pu={st['pu']} us  pl={st['pl']} us")
    return ok


def check_done(line: str | None, tag: str, expect: dict) -> bool:
    if not line:
        return False
    if line.startswith("ERR"):
        print(f"FAIL: {line}")
        return False
    done = parse_done(line)
    if not done or done["tag"] != tag:
        print(f"FAIL: unexpected reply: {line}")
        return False
    ok = True
    for key in ("u", "l", "h"):
        if key not in expect:
            continue
        if abs(done[key] - expect[key]) > (1.0 if key != "h" else 0.6):
            ok = False
    if done["homedUpper"] != 1 or done["homedLower"] != 1:
        ok = False
    print(f"{'PASS' if ok else 'FAIL'}: {line}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Test etch module HOME and TRAVEL")
    parser.add_argument("--home-only", action="store_true")
    parser.add_argument("--travel-only", action="store_true")
    parser.add_argument("--return-home", action="store_true", help="HOME again after TRAVEL")
    parser.add_argument("--port", default=PORT)
    args = parser.parse_args()

    try:
        ser = open_port(args.port)
    except serial.SerialException as exc:
        print(f"Cannot open {args.port}: {exc}", file=sys.stderr)
        return 1

    fails = 0
    try:
        time.sleep(0.5)
        boot = drain(ser, 2.0)
        if any("BENCH_TEST" in ln for ln in boot):
            print(
                "ERROR: bench firmware detected — flash production first:\n"
                "  py -m platformio run -e centring_nano_motor -t upload",
                file=sys.stderr,
            )
            return 2

        send_sync(ser, "PING")
        send_sync(ser, "CLRFAULT")

        expect_home = {"u": 0.0, "l": 0.0, "h": 0.0, "homedUpper": 1, "homedLower": 1}
        expect_travel = {"u": 90.0, "l": 90.0, "h": 67.6, "homedUpper": 1, "homedLower": 1}

        if not args.travel_only:
            print("\n========== STEP 1: HOME (guides closed) ==========")
            print("Seeks UH pin 4 + LH pin 15 — auto-detects upper servo direction")
            home_line = send_async(ser, "HOME", "HOME")
            if not check_done(home_line, "HOME", expect_home):
                fails += 1
                send_sync(ser, "CLRFAULT")
            st = fetch_status(ser)
            if not print_position("After HOME", st, expect_home):
                fails += 1

        if not args.home_only:
            send_sync(ser, "CLRFAULT")
            if args.travel_only:
                st = fetch_status(ser)
                if not st or st["homedUpper"] != 1 or st["homedLower"] != 1:
                    print("\nNot homed — running HOME first…")
                    send_async(ser, "HOME", "HOME")

            print("\n========== STEP 2: SEEK_TRAVEL (guides full open) ==========")
            print("Seeks UT pin 3 + LT pin 14, sets u=l=90°, h=67.6 mm")
            travel_line = send_async(ser, "SEEK_TRAVEL", "SEEK_TRAVEL")
            if not check_done(travel_line, "SEEK_TRAVEL", expect_travel):
                fails += 1
            st = fetch_status(ser)
            if not print_position("After TRAVEL", st, expect_travel):
                fails += 1
            if st and (st["ut"] != 1 or st["lt"] != 1):
                print("NOTE: ut/lt not both 1 — may be retracted off switch; check DONE h/u/l")

        if args.return_home and not args.home_only:
            print("\n========== STEP 3: HOME (return closed) ==========")
            send_async(ser, "HOME", "HOME")
            st = fetch_status(ser)
            print_position("Returned HOME", st, expect_home)

    finally:
        ser.close()

    print("\n" + "=" * 60)
    if fails:
        print(f"RESULT: {fails} check(s) FAILED")
        return 1
    print("RESULT: HOME / TRAVEL test PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
