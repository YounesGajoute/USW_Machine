#!/usr/bin/env python3
"""Interactive bench test for centring switch inputs and servo sweep direction.

Flash bench firmware first:
  py -m platformio run -e centring_nano_bench -t upload

Run full checklist (close Serial Monitor first):
  py scripts/bench_switch_test.py
  py scripts/bench_switch_test.py --lower-only
  py scripts/bench_lower_test.py
  py scripts/bench_switch_test.py --monitor-only
  py scripts/bench_switch_test.py --sweep-only
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
    r"INPUTS_LOWER lh=(\d+) raw=(\d+) act=(\d+) lt=(\d+) raw=(\d+) act=(\d+) "
    r"pl=(\d+) home_us=(\d+) travel_us=(\d+)"
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
    if buf.strip():
        lines.append(buf.strip())
        print(buf.strip())
    return lines


def send(ser: serial.Serial, cmd: str, wait_s: float = 1.0) -> list[str]:
    print(f"\n>> {cmd}")
    ser.write((cmd + "\r\n").encode("ascii"))
    ser.flush()
    return drain(ser, wait_s)


def wait_sweep(ser: serial.Serial, tag: str, max_s: float = 130.0) -> str | None:
    """Wait for final DONE/ERR on sweep (skips HINT retry lines)."""
    end = time.time() + max_s
    buf = ""
    done_prefix = f"DONE {tag.upper()}"
    err_prefix = f"ERR {tag.upper()}"
    while time.time() < end:
        n = ser.in_waiting
        if n:
            buf += ser.read(n).decode("utf-8", errors="replace")
            while "\n" in buf or "\r" in buf:
                for sep in ("\r\n", "\n", "\r"):
                    if sep in buf:
                        chunk, buf = buf.split(sep, 1)
                        s = chunk.strip()
                        if not s:
                            break
                        print(s)
                        up = s.upper()
                        if up.startswith("HINT "):
                            break
                        if up.startswith(done_prefix):
                            return s
                        if up.startswith(err_prefix):
                            return s
                        break
        else:
            time.sleep(0.02)
    return None


def parse_inputs(line: str) -> dict[str, int] | None:
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


def parse_inputs_lower(line: str) -> dict[str, int] | None:
    m = INPUTS_LOWER_RE.search(line)
    if not m:
        return None
    keys = [
        "lh_pin", "lh_raw", "lh_act",
        "lt_pin", "lt_raw", "lt_act",
        "pl", "home_us", "travel_us",
    ]
    return {k: int(v) for k, v in zip(keys, m.groups())}


def print_switch_table(data: dict[str, int], lower_only: bool = False) -> None:
    if lower_only:
        rows = [
            ("Lower HOME (LH)", data["lh_pin"], data["lh_raw"], data["lh_act"]),
            ("Lower TRAVEL (LT)", data["lt_pin"], data["lt_raw"], data["lt_act"]),
        ]
        title = "Lower module J2 — switch map (act=1 = pressed)"
    else:
        rows = [
            ("Upper HOME", data["uh_pin"], data["uh_raw"], data["uh_act"]),
            ("Upper TRAVEL", data["ut_pin"], data["ut_raw"], data["ut_act"]),
            ("Lower HOME", data["lh_pin"], data["lh_raw"], data["lh_act"]),
            ("Lower TRAVEL", data["lt_pin"], data["lt_raw"], data["lt_act"]),
        ]
        title = "Switch map (act=1 means pressed / closed to GND)"
    print(f"\n{title}:")
    print(f"{'Switch':<18} {'Pin':>4} {'Raw':>4} {'Act':>4}")
    print("-" * 34)
    for name, pin, raw, act in rows:
        print(f"{name:<18} {pin:>4} {raw:>4} {act:>4}")


def print_lower_pwm(data: dict[str, int]) -> None:
    print(
        f"\nLower servo D9: pl={data['pl']} us  "
        f"(factory HOME={data['home_us']} dec, TRAVEL={data['travel_us']} inc)"
    )


def monitor_prompt(ser: serial.Serial, lower_only: bool) -> None:
    if lower_only:
        print("\n=== Lower switch monitor (J2 only) ===")
        print("Press LH (pin 15) then LT (pin 14). Watch act flip to 1.")
        cmd = "MONITOR_LOWER"
    else:
        print("\n=== Live switch monitor ===")
        print("Press each switch one at a time. Watch act flip to 1.")
        print("Expected pins: UH=4, UT=3, LH=15, LT=14")
        cmd = "MONITOR"
    send(ser, cmd, 0.2)
    try:
        input("Press ENTER when done watching (sends STOP)... ")
    except KeyboardInterrupt:
        print()
        send(ser, "STOP", 2.0)


def sweep_checklist(ser: serial.Serial, lower_only: bool, auto: bool) -> None:
    if lower_only:
        sweeps = [
            ("SWEEP_LOWER HOME", "SWEEP_LOWER HOME", "dec", 15, "Lower → HOME: PWM decreases, expect pin 15"),
            ("SWEEP_LOWER TRAVEL", "SWEEP_LOWER TRAVEL", "inc", 14, "Lower → TRAVEL: PWM increases, expect pin 14"),
        ]
        print("\n=== Lower servo direction sweeps (upper stays idle) ===")
    else:
        sweeps = [
            ("SWEEP_UPPER HOME", "SWEEP_UPPER HOME", "inc", 4, "Upper → HOME: PWM increases toward pin 4"),
            ("SWEEP_UPPER TRAVEL", "SWEEP_UPPER TRAVEL", "dec", 3, "Upper → TRAVEL: PWM decreases toward pin 3"),
            ("SWEEP_LOWER HOME", "SWEEP_LOWER HOME", "dec", 15, "Lower should move toward HOME (PWM decreases)"),
            ("SWEEP_LOWER TRAVEL", "SWEEP_LOWER TRAVEL", "inc", 14, "Lower should move toward TRAVEL (PWM increases)"),
        ]
        print("\n=== Servo direction sweeps ===")

    if lower_only:
        send(ser, "FACTORY", 0.5)
    else:
        send(ser, "FACTORY", 0.5)

    for cmd, tag, expect_dir, expect_pin, note in sweeps:
        print(f"\n--- {cmd} ---")
        print(note)
        print(f"Expected dir={expect_dir}, hit pin={expect_pin}")
        if not auto:
            try:
                ans = input("Run this sweep? [Y/n/skip all] ").strip().lower()
            except KeyboardInterrupt:
                print()
                send(ser, "STOP", 0.3)
                return
            if ans == "n":
                continue
            if ans.startswith("s"):
                break
        send(ser, cmd, 0.3)
        result = wait_sweep(ser, tag)
        if not result:
            print("TIMEOUT waiting for sweep result")
            continue
        if f"dir={expect_dir}" not in result:
            print(f"WARNING: direction mismatch — got {result}")
        if f"pin={expect_pin}" not in result and result.startswith("DONE"):
            print(f"WARNING: wrong switch pin — expected {expect_pin} in {result}")
        if result.startswith("ERR"):
            reason = result.split(" ", 3)[2] if len(result.split(" ")) > 2 else "?"
            print(f"Sweep failed ({reason}) — firmware will retry opposite direction if applicable")
            if "pwm_min" in result or "pwm_max" in result:
                print("Likely wrong direction or HOME/TRAVEL PWM swapped for this servo")


def run_auto_test_lower(ser: serial.Serial) -> bool:
    print("\n=== Automated TEST_LOWER (HOME sweep then TRAVEL sweep) ===")
    send(ser, "TEST_LOWER", 0.3)
    end = time.time() + 130.0
    buf = ""
    last_err = None
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
                        if s.startswith("DONE TEST_LOWER"):
                            return True
                        if s.startswith("ERR TEST_LOWER"):
                            last_err = s
                            return False
                        break
        else:
            time.sleep(0.02)
    if last_err:
        print(f"FAILED: {last_err}")
    else:
        print("TIMEOUT waiting for TEST_LOWER")
    return False


def read_lower_inputs(ser: serial.Serial) -> dict[str, int] | None:
    lines = send(ser, "INPUTS_LOWER", 0.5)
    for line in lines:
        data = parse_inputs_lower(line)
        if data:
            print_switch_table(
                {
                    "lh_pin": data["lh_pin"],
                    "lh_raw": data["lh_raw"],
                    "lh_act": data["lh_act"],
                    "lt_pin": data["lt_pin"],
                    "lt_raw": data["lt_raw"],
                    "lt_act": data["lt_act"],
                },
                lower_only=True,
            )
            print_lower_pwm(data)
            return data
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Centring bench switch + direction test")
    parser.add_argument("--lower-only", action="store_true", help="J2 lower module only")
    parser.add_argument("--monitor-only", action="store_true")
    parser.add_argument("--sweep-only", action="store_true")
    parser.add_argument("--auto", action="store_true", help="Run sweeps without prompts")
    parser.add_argument("--auto-test-lower", action="store_true", help="One command TEST_LOWER on firmware")
    parser.add_argument("--port", default=PORT)
    args = parser.parse_args()

    try:
        ser = open_port(args.port)
    except serial.SerialException as exc:
        print(f"Cannot open {args.port}: {exc}", file=sys.stderr)
        return 1

    try:
        time.sleep(0.5)
        boot = drain(ser, 2.5)
        if not any("BENCH_TEST" in line for line in boot):
            print(
                "WARNING: BENCH_TEST banner not seen — flash centring_nano_bench first:\n"
                "  py -m platformio run -e centring_nano_bench -t upload",
                file=sys.stderr,
            )

        if args.lower_only:
            read_lower_inputs(ser)
        else:
            lines = send(ser, "INPUTS", 0.5)
            for line in lines:
                data = parse_inputs(line)
                if data:
                    print_switch_table(data)
                    break

        if args.auto_test_lower:
            ok = run_auto_test_lower(ser)
            read_lower_inputs(ser)
            return 0 if ok else 2

        if not args.sweep_only:
            monitor_prompt(ser, args.lower_only)

        if not args.monitor_only:
            sweep_checklist(ser, args.lower_only, args.auto)

        if args.lower_only:
            read_lower_inputs(ser)
        else:
            send(ser, "INPUTS", 0.5)
    finally:
        ser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
