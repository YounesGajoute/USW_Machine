#!/usr/bin/env python3
"""
PP RIGHT — minimal EtherCAT stepper test (XHS_ECT_MD1616_V2.0).

Wiring:
  DO0 PULL   DO1 DIR
  DI0 MIN limit   DI1 MAX limit   DI2 PICK_FB   DI3 PLACE_FB

Timing: busy-wait + measured EtherCAT RTT (no time.sleep in pulse loop).

  bash scripts/run_ethercat_python.sh scripts/test_motor_pp_right.py
  sudo venv_ethercat/bin/python3 scripts/test_motor_pp_right.py --limits-only
"""

import argparse
import math
import os
import struct
import sys
import threading
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

try:
    import pysoem
except ImportError:
    print("ERROR: pysoem not found.  Run: bash scripts/setup_ethercat_venv.sh")
    sys.exit(1)

# ── I/O ───────────────────────────────────────────────────────────────────────
DO_PULL = 0
DO_DIR = 1
DI_LIMIT_MIN = 0
DI_LIMIT_MAX = 1
DI_PICK_FB = 2
DI_PLACE_FB = 3

PULSES_PER_REV = 400
FREQ_HW_MAX_HZ = 10000
ETHERCAT_CYCLE_S = 0.0005
_HALF_CYCLE_OVERHEAD_S = 5e-6

GRN = "\033[92m"
YLW = "\033[93m"
RED = "\033[91m"
RST = "\033[0m"


def ok(m):
    print(f"{GRN}ok{RST} {m}")


def warn(m):
    print(f"{YLW}warn{RST} {m}")


def err(m):
    print(f"{RED}err{RST} {m}")


def hz_to_rpm(hz):
    return hz / PULSES_PER_REV * 60


def rpm_to_hz(rpm):
    return rpm * PULSES_PER_REV / 60


def _busy_sleep(seconds):
    if seconds <= 0:
        return
    deadline = time.perf_counter() + seconds
    while time.perf_counter() < deadline:
        pass


def _di_limit_hit(di_word: int, forward: bool) -> bool:
    """1 = at limit. FWD stops on DI1; REV stops on DI0."""
    if forward and ((di_word >> DI_LIMIT_MAX) & 1):
        return True
    if (not forward) and ((di_word >> DI_LIMIT_MIN) & 1):
        return True
    return False


def _sn(s):
    return {1: "INIT", 2: "PREOP", 4: "SAFEOP", 8: "OP"}.get(s, f"?({s})")


# ── EtherCAT ─────────────────────────────────────────────────────────────────
class EtherCATDevice:
    def __init__(self, interface, xml_path):
        self.interface = interface
        self.xml_path = xml_path
        self.master = None
        self._lock = threading.Lock()
        self._maint_run = False
        self._maint_th = None
        self._maint_cycle_s = ETHERCAT_CYCLE_S

    def connect(self):
        if not os.path.exists(f"/sys/class/net/{self.interface}"):
            raise RuntimeError(f"Interface '{self.interface}' not found")
        self.master = pysoem.Master()
        self.master.open(self.interface)
        n = self.master.config_init()
        if n == 0:
            self.master.close()
            raise RuntimeError(f"No slaves on {self.interface}")
        self.master.read_state()
        print(f"  Found {n} slave(s)")
        for i, s in enumerate(self.master.slaves):
            print(f"    [{i}] {s.name}  {_sn(s.state)}")
        self.master.config_map()
        OP = getattr(pysoem, "OP_STATE", 8)
        for t in (getattr(pysoem, "PREOP_STATE", 2), getattr(pysoem, "SAFEOP_STATE", 4), OP):
            self.master.state = t
            self.master.write_state()
            time.sleep(0.1)
            self.master.read_state()
        self._start_maint()
        time.sleep(0.05)
        for retry in range(20):
            self.master.read_state()
            if all(s.state == OP for s in self.master.slaves):
                ok(f"OP state ({retry + 1} tries)")
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Slaves did not reach OP")
        self._raw_out(0)
        ok("outputs cleared")

    def disconnect(self):
        self._stop_maint()
        if self.master:
            try:
                self._raw_out(0)
                self.master.state = pysoem.INIT_STATE
                self.master.write_state()
                self.master.close()
            except Exception:
                pass
        ok("disconnected")

    def calibrate_overhead(self, n=200):
        global _HALF_CYCLE_OVERHEAD_S
        s = self.master.slaves[0]
        samples = []
        for _ in range(n):
            t0 = time.perf_counter()
            s.output = struct.pack("<H", 1)
            self.master.send_processdata()
            self.master.receive_processdata(2000)
            samples.append(time.perf_counter() - t0)
            time.sleep(0.001)
        samples.sort()
        _HALF_CYCLE_OVERHEAD_S = samples[n // 2]
        s.output = struct.pack("<H", 0)
        self.master.send_processdata()
        self.master.receive_processdata(2000)
        ok(f"RTT {_HALF_CYCLE_OVERHEAD_S * 1e6:.1f} µs  "
            f"(~{1.0 / (2 * _HALF_CYCLE_OVERHEAD_S):.0f} Hz max jog)")

    def set_do(self, pin, value):
        with self._lock:
            s = self.master.slaves[0]
            cur = struct.unpack("<H", s.output[:2])[0]
            s.output = struct.pack(
                "<H", cur | (1 << pin) if value else cur & ~(1 << pin)
            )
            self.master.send_processdata()
            self.master.receive_processdata(2000)

    def get_all_di(self):
        self.master.send_processdata()
        self.master.receive_processdata(2000)
        return struct.unpack("<H", self.master.slaves[0].input[:2])[0]

    def get_di(self, pin):
        return (self.get_all_di() >> pin) & 1

    def _raw_out(self, word):
        with self._lock:
            s = self.master.slaves[0]
            s.output = struct.pack("<H", word)
            for _ in range(3):
                self.master.send_processdata()
                self.master.receive_processdata(2000)
                time.sleep(0.005)

    def _start_maint(self):
        self._maint_cycle_s = ETHERCAT_CYCLE_S
        self._maint_run = True

        def loop():
            OP = getattr(pysoem, "OP_STATE", 8)
            cyc = 0
            while self._maint_run and self.master:
                try:
                    with self._lock:
                        self.master.send_processdata()
                        self.master.receive_processdata(2000)
                    cyc += 1
                    if cyc % 500 == 0:
                        self.master.read_state()
                        if self.master.slaves[0].state != OP:
                            self.master.state = OP
                            self.master.write_state()
                except Exception:
                    pass
                _busy_sleep(self._maint_cycle_s)

        self._maint_th = threading.Thread(target=loop, daemon=True)
        self._maint_th.start()

    def _stop_maint(self):
        self._maint_run = False
        if self._maint_th:
            self._maint_th.join(timeout=1.0)


# ── Ramp math ─────────────────────────────────────────────────────────────────
def _append_ramp_phase(segments, f_min, f_peak, n_steps, accel, rising):
    if n_steps <= 0:
        return
    n_seg = max(1, n_steps // 10)
    per_seg = n_steps // n_seg
    rem = n_steps - per_seg * n_seg
    for i in range(n_seg):
        frac = (i + 0.5) / n_seg
        if not rising:
            frac = 1.0 - frac
        f = max(f_min, min(f_peak, f_min + frac * (f_peak - f_min)))
        count = per_seg + (1 if i < rem else 0)
        segments.append((1.0 / (2.0 * f), count))


def _build_ramp(total_steps: int, f_min: float, f_max: float, accel: float):
    ramp_steps = max(1, int((f_max**2 - f_min**2) / (2.0 * accel)))
    if total_steps < 2 * ramp_steps:
        f_peak = min(f_max, math.sqrt(f_min**2 + accel * total_steps))
        ramp_steps = total_steps // 2
    else:
        f_peak = f_max
    hold_steps = total_steps - 2 * ramp_steps
    segments = []
    _append_ramp_phase(segments, f_min, f_peak, ramp_steps, accel, True)
    if hold_steps > 0:
        segments.append((1.0 / (2.0 * f_peak), hold_steps))
    _append_ramp_phase(segments, f_min, f_peak, ramp_steps, accel, False)
    return segments


# ── Stepper ───────────────────────────────────────────────────────────────────
class StepperController:
    def __init__(self, dev: EtherCATDevice):
        self.dev = dev
        self.pull_pin = DO_PULL
        self.dir_pin = DO_DIR
        self._running = False
        self._thread = None

    def _reject_if_at_limit(self, forward: bool) -> bool:
        if _di_limit_hit(self.dev.get_all_di(), forward):
            pin = DI_LIMIT_MAX if forward else DI_LIMIT_MIN
            warn(f"at {'MAX' if forward else 'MIN'} limit DI{pin}")
            return True
        return False

    def set_dir(self, forward: bool):
        self.dev.set_do(self.dir_pin, 0 if forward else 1)
        time.sleep(0.002)

    def ramp_move(
        self,
        steps: int,
        freq_min: float,
        freq_max: float,
        accel_hz_s: float,
        forward: bool = True,
        feedback_pin=None,
        feedback_timeout_s=30.0,
    ):
        if freq_min <= 0 or freq_max <= 0 or accel_hz_s <= 0:
            raise ValueError("freq_min, freq_max, accel must be > 0")
        if freq_min > freq_max:
            freq_min, freq_max = freq_max, freq_min
        if self._reject_if_at_limit(forward):
            return
        segments = _build_ramp(steps, freq_min, freq_max, accel_hz_s)
        total_steps = sum(c for _, c in segments)
        self.set_dir(forward)
        print(
            f"  ramp {'FWD' if forward else 'REV'}  "
            f"{freq_min:.0f}-{freq_max:.0f} Hz  {total_steps} pulses"
        )

        master = self.dev.master
        slave = master.slaves[0]
        lock = self.dev._lock
        oh = _HALF_CYCLE_OVERHEAD_S
        pull_mask = 1 << self.pull_pin
        npull_mask = (~pull_mask) & 0xFFFF
        done = 0
        t0 = time.time()
        stopped_limit = False

        for half_period, count in segments:
            wait = max(0.0, half_period - oh)
            for _ in range(count):
                with lock:
                    cur = struct.unpack("<H", slave.output[:2])[0]
                    slave.output = struct.pack("<H", cur | pull_mask)
                    master.send_processdata()
                    master.receive_processdata(2000)
                _busy_sleep(wait)
                with lock:
                    cur = struct.unpack("<H", slave.output[:2])[0]
                    slave.output = struct.pack("<H", cur & npull_mask)
                    master.send_processdata()
                    master.receive_processdata(2000)
                _busy_sleep(wait)
                done += 1
                di = struct.unpack("<H", slave.input[:2])[0]
                if _di_limit_hit(di, forward):
                    warn("limit — ramp stopped")
                    stopped_limit = True
                    break
            if stopped_limit:
                break

        self.dev.set_do(self.pull_pin, 0)
        elapsed = time.time() - t0
        if stopped_limit:
            warn(f"stopped at limit — {done} pulses, {elapsed:.2f}s")
        else:
            ok(f"done {done} pulses in {elapsed:.2f}s")

        if feedback_pin is not None and not stopped_limit:
            self._wait_fb(feedback_pin, feedback_timeout_s)

    def jog_start(self, freq_hz: float, forward: bool = True):
        if self._running:
            warn("already running")
            return
        if self._reject_if_at_limit(forward):
            return
        self.set_dir(forward)
        wait = max(0.0, 1.0 / (2.0 * freq_hz) - _HALF_CYCLE_OVERHEAD_S)
        master = self.dev.master
        slave = master.slaves[0]
        lock = self.dev._lock
        pull_mask = 1 << self.pull_pin
        npull_mask = (~pull_mask) & 0xFFFF
        self._running = True

        def loop():
            while self._running:
                with lock:
                    cur = struct.unpack("<H", slave.output[:2])[0]
                    slave.output = struct.pack("<H", cur | pull_mask)
                    master.send_processdata()
                    master.receive_processdata(2000)
                _busy_sleep(wait)
                with lock:
                    cur = struct.unpack("<H", slave.output[:2])[0]
                    slave.output = struct.pack("<H", cur & npull_mask)
                    master.send_processdata()
                    master.receive_processdata(2000)
                _busy_sleep(wait)
                di = struct.unpack("<H", slave.input[:2])[0]
                if _di_limit_hit(di, forward):
                    warn("limit — jog stopped")
                    self._running = False
                    break
            self.dev.set_do(self.pull_pin, 0)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()
        ok(f"jog {'FWD' if forward else 'REV'} @ {freq_hz:.0f} Hz")

    def jog_stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        self.dev.set_do(self.pull_pin, 0)
        ok("jog stopped")

    def _wait_fb(self, pin, timeout_s):
        names = {DI_PICK_FB: "PICK_FB", DI_PLACE_FB: "PLACE_FB"}
        name = names.get(pin, f"DI{pin}")
        print(f"  wait {name} …", end="", flush=True)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.dev.get_di(pin):
                print(f" {GRN}ok{RST}")
                return
            time.sleep(0.02)
        print(f" {RED}timeout{RST}")


# ── UI helpers ────────────────────────────────────────────────────────────────
def run_limit_switch_monitor(dev: EtherCATDevice, poll_s=0.05):
    stop = threading.Event()

    def _wait_enter():
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            pass
        stop.set()

    threading.Thread(target=_wait_enter, daemon=True).start()
    print("\n  DI0=MIN  DI1=MAX  (1=at limit).  Enter to stop.\n")
    try:
        while not stop.is_set():
            di = dev.get_all_di()
            l0 = (di >> DI_LIMIT_MIN) & 1
            l1 = (di >> DI_LIMIT_MAX) & 1
            print(f"\r  I0={l0}  I1={l1}  word=0x{di & 0xFFFF:04X}   ", end="", flush=True)
            time.sleep(poll_s)
    except KeyboardInterrupt:
        stop.set()
    print()
    ok("limit monitor done")


def menu_text(f_min, f_max, accel, steps):
    return f"""
  PP RIGHT stepper  |  {PULSES_PER_REV} pulses/rev  |  max {FREQ_HW_MAX_HZ} Hz
  f_min={f_min:.0f}  f_max={f_max:.0f} Hz  accel={accel:.0f}  steps={steps}
  1 ramp FWD + wait PICK_FB   2 ramp REV + wait PLACE_FB
  3 jog FWD   4 jog REV   (max speed, Enter stops)
  5 read DIs   l limit monitor   s settings   q quit
"""


def main():
    p = argparse.ArgumentParser(description="PP right EtherCAT stepper (minimal)")
    p.add_argument("--interface", default="eth0")
    p.add_argument("--xml", default="XHS_ECT_050_v2.0 2.xml")
    p.add_argument("--freq-min", type=float, default=10.0)
    p.add_argument("--freq-max", type=float, default=float(FREQ_HW_MAX_HZ))
    p.add_argument("--accel", type=float, default=2000.0)
    p.add_argument("--steps", type=int, default=400)
    p.add_argument("--limits-only", action="store_true")
    args = p.parse_args()

    xml_path = args.xml if os.path.isabs(args.xml) else os.path.join(PROJECT_ROOT, args.xml)
    if not os.path.exists(xml_path):
        err(f"XML not found: {xml_path}")
        sys.exit(1)

    f_min = args.freq_min
    f_max = min(args.freq_max, FREQ_HW_MAX_HZ)
    accel = args.accel
    steps = args.steps

    dev = EtherCATDevice(args.interface, xml_path)
    motor = None
    try:
        print("Connecting…")
        dev.connect()
    except Exception as e:
        err(str(e))
        sys.exit(1)

    if args.limits_only:
        ok("limit-only (no calibration)")
        try:
            run_limit_switch_monitor(dev)
        finally:
            dev.disconnect()
        return

    print("Calibrating…")
    dev.calibrate_overhead()
    motor = StepperController(dev)

    def parse_speed(s, cur):
        s = s.strip()
        if not s:
            return cur
        if s.lower().endswith("rpm"):
            return rpm_to_hz(float(s[:-3].strip()))
        hz = float(s)
        return min(hz, FREQ_HW_MAX_HZ)

    def parse_steps(s, cur):
        s = s.strip()
        if not s:
            return cur
        if s.lower().endswith("rev"):
            return int(float(s[:-3].strip()) * PULSES_PER_REV)
        return int(s)

    try:
        while True:
            print(menu_text(f_min, f_max, accel, steps))
            c = input("> ").strip().lower()
            if c == "1":
                motor.ramp_move(steps, f_min, f_max, accel, True, DI_PICK_FB)
            elif c == "2":
                motor.ramp_move(steps, f_min, f_max, accel, False, DI_PLACE_FB)
            elif c == "3":
                motor.jog_start(f_max, True)
                input("Enter to stop ")
                motor.jog_stop()
            elif c == "4":
                motor.jog_start(f_max, False)
                input("Enter to stop ")
                motor.jog_stop()
            elif c == "5":
                di = dev.get_all_di()
                print(
                    f"  I0 {DI_LIMIT_MIN}={((di >> DI_LIMIT_MIN) & 1)}  "
                    f"I1 {DI_LIMIT_MAX}={((di >> DI_LIMIT_MAX) & 1)}  "
                    f"PICK={((di >> DI_PICK_FB) & 1)}  "
                    f"PLACE={((di >> DI_PLACE_FB) & 1)}"
                )
            elif c == "l":
                run_limit_switch_monitor(dev)
            elif c == "s":
                try:
                    t = input(f"  f_min Hz [{f_min}]: ").strip()
                    if t:
                        f_min = parse_speed(t, f_min)
                    t = input(f"  f_max Hz [{f_max}]: ").strip()
                    if t:
                        f_max = parse_speed(t, f_max)
                    t = input(f"  accel [{accel}]: ").strip()
                    if t:
                        accel = float(t)
                    t = input(f"  steps [{steps}]: ").strip()
                    if t:
                        steps = parse_steps(t, steps)
                    if f_min > f_max:
                        f_min, f_max = f_max, f_min
                except ValueError:
                    warn("bad input")
            elif c == "q":
                break
            elif c:
                warn("unknown")
    except KeyboardInterrupt:
        print()
    finally:
        if motor:
            motor.jog_stop()
        dev.disconnect()


if __name__ == "__main__":
    main()
