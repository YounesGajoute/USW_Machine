#!/usr/bin/env python3
"""
EtherCAT Bridge for US Machine
Communicates with EtherCAT devices using pysoem library
Provides JSON-based command interface via stdin/stdout
"""

import sys
import json
import time
import threading
import signal
import struct
import os
import subprocess
from typing import Dict, Any, Optional

try:
    import pysoem
except ImportError:
    print("ERROR: pysoem library not installed. Install with: pip install pysoem", file=sys.stderr)
    sys.exit(1)


class EtherCATBridge:
    def __init__(self, interface: str, device_name: str, xml_path: str):
        self.interface = interface
        self.device_name = device_name
        self.xml_path = xml_path
        self.master: Optional[pysoem.Master] = None
        self.is_initialized = False
        self.button_monitoring = False
        self.button_monitor_thread: Optional[threading.Thread] = None
        self.op_maintainer_thread: Optional[threading.Thread] = None
        self.op_maintainer_running = False
        # Serializes every SOEM wire operation (send/receive_processdata, read/write_state).
        # The OP maintainer owns cyclic PDO; command handlers read/write IOmap buffers under
        # the same lock — same pattern as scripts/test_motor_pp_right.py EtherCATDevice._lock.
        self._pd_lock = threading.Lock()
        # After config_map(), SOEM sets expected WKC; cyclic exchange should match for RUN/OP LED.
        self.expected_wkc: int = 0
        self._last_wkc: int = 0

        # Device configuration — XHS_ECT_MD1616_V2.0: 16 outputs, 16 inputs
        self.num_outputs = 16
        self.num_inputs = 16

        # PDO mapping (from XML)
        # Outputs: SM2 (StartAddress 0x0f00, 0x0f01) — 2 bytes
        # Inputs:  SM4 (StartAddress 0x1002)          — 2 bytes
        self.output_sm = 2
        self.input_sm = 4
        self.output_start_addr = 0x0f00
        self.input_start_addr = 0x1002

        # State tracking
        self.output_states = [0] * self.num_outputs
        self.input_states = [0] * self.num_inputs

    # EtherCAT AL status: effective state is lower 4 bits (SOEM EC_STATE_MASK).
    # Raw values like 0x18 (24) are OP (8) with flags in upper bits — comparing raw == 8 was wrong.
    @staticmethod
    def _al_state(state: int) -> int:
        return int(state) & 0x0F

    def _get_state_name(self, state: int) -> str:
        al = self._al_state(state)
        state_names = {1: "INIT", 2: "PREOP", 4: "SAFEOP", 8: "OP"}
        if al in state_names:
            name = state_names[al]
            if int(state) != al:
                return f"{name} (raw=0x{int(state):X})"
            return name
        if state == 17:
            return "INIT? (may need read_state())"
        return f"UNKNOWN(raw=0x{int(state):X}, al={al})"

    # ── Locked EtherCAT wire helpers ─────────────────────────────────────────
    # All access to the SOEM socket/context must hold _pd_lock so the OP
    # maintainer thread and command handlers never touch the wire concurrently.

    def _exchange_once(self, timeout_us: int = 2000) -> int:
        """One process-data cycle (send + receive) under the lock. Returns WKC."""
        with self._pd_lock:
            self.master.send_processdata()
            return int(self.master.receive_processdata(timeout_us))

    def _read_state_locked(self) -> None:
        with self._pd_lock:
            self.master.read_state()

    def _write_state_locked(self, state: int) -> None:
        with self._pd_lock:
            self.master.state = state
            self.master.write_state()

    def _refresh_expected_wkc(self) -> None:
        try:
            self.expected_wkc = int(self.master.expected_wkc)
        except Exception:
            self.expected_wkc = 0

    def _list_interfaces(self) -> str:
        try:
            net_dir = "/sys/class/net"
            if os.path.exists(net_dir):
                interfaces = [d for d in os.listdir(net_dir) if os.path.isdir(os.path.join(net_dir, d))]
                return ", ".join(interfaces)
        except Exception:
            pass
        return "unknown"

    def init(self) -> Dict[str, Any]:
        """Initialize EtherCAT master and scan for devices"""
        try:
            interface_path = f"/sys/class/net/{self.interface}"
            if not os.path.exists(interface_path):
                raise Exception(f"Interface '{self.interface}' does not exist. Available interfaces: {self._list_interfaces()}")

            carrier_path = f"/sys/class/net/{self.interface}/carrier"
            if os.path.exists(carrier_path):
                try:
                    with open(carrier_path, 'r') as f:
                        carrier_status = f.read().strip()
                    if carrier_status == "0":
                        raise Exception(
                            f"Interface '{self.interface}' has no carrier signal (NO-CARRIER). "
                            f"This indicates no physical connection to EtherCAT device.\n"
                            f"Troubleshooting:\n"
                            f"  1. Check EtherCAT cable connection to {self.interface}\n"
                            f"  2. Verify EtherCAT device is powered on\n"
                            f"  3. Check cable integrity\n"
                            f"  4. Verify interface status: ip link show {self.interface}\n"
                            f"  5. Try: sudo ip link set {self.interface} up (if interface is down)"
                        )
                except IOError as io_error:
                    print(f"⚠️  Could not check carrier status: {io_error}", file=sys.stderr)

            self.master = pysoem.Master()

            try:
                self.master.open(self.interface)
            except Exception as open_error:
                error_msg = str(open_error)
                if "could not open" in error_msg.lower() or "permission denied" in error_msg.lower():
                    python_executable = sys.executable
                    if os.path.islink(python_executable):
                        python_executable = os.path.realpath(python_executable)

                    python_paths_to_check = [
                        python_executable,
                        '/usr/bin/python3.11',
                        '/usr/bin/python3',
                        '/usr/bin/python3.12',
                        '/usr/bin/python3.10',
                    ]

                    has_full_caps = False
                    has_raw_only = False
                    checked_path = None
                    for python_path in python_paths_to_check:
                        if os.path.exists(python_path):
                            try:
                                cap_check = subprocess.run(['getcap', python_path],
                                                          capture_output=True, text=True, timeout=1)
                                if cap_check.returncode == 0:
                                    out = cap_check.stdout
                                    if 'cap_net_raw' in out and 'cap_net_admin' in out:
                                        has_full_caps = True
                                        checked_path = python_path
                                        break
                                    if 'cap_net_raw' in out and 'cap_net_admin' not in out:
                                        has_raw_only = True
                                        checked_path = python_path
                            except Exception:
                                continue

                    diagnostic = (
                        f"Failed to open EtherCAT interface '{self.interface}'. "
                        f"This usually indicates missing permissions or no EtherCAT device connected.\n"
                    )

                    if not has_full_caps:
                        diagnostic += (
                            f"Capabilities check: need cap_net_raw AND cap_net_admin on the real Python binary\n"
                            f"  Checked: {python_executable}\n"
                            f"  Solution: sudo bash scripts/setup_ethercat_permissions.sh\n"
                            f"  (SOEM/pysoem uses CAP_NET_RAW for raw frames and CAP_NET_ADMIN for interface setup.)\n"
                        )
                        if has_raw_only:
                            diagnostic += (
                                f"  Detected cap_net_raw without cap_net_admin — re-run the setup script (older script versions only set raw).\n"
                            )
                    else:
                        diagnostic += (
                            f"Capabilities check: cap_net_raw+cap_net_admin SET on {checked_path or python_executable}\n"
                            f"If capabilities are set but still failing, possible causes:\n"
                            f"  1. No EtherCAT device connected to {self.interface}\n"
                            f"  2. Interface not configured for EtherCAT\n"
                            f"  3. Device not powered on\n"
                            f"  4. Interface not fully ready (try waiting a few seconds)\n"
                            f"  5. Process spawned in a way that doesn't inherit capabilities\n"
                        )

                    try:
                        interface_status = subprocess.run(['ip', 'link', 'show', self.interface],
                                                          capture_output=True, text=True, timeout=2)
                        if interface_status.returncode == 0:
                            diagnostic += f"\nInterface status:\n{interface_status.stdout}"
                    except Exception:
                        pass

                    diagnostic += f"\nTroubleshooting:\n"
                    diagnostic += f"  1. Run: sudo bash scripts/setup_ethercat_permissions.sh\n"
                    diagnostic += f"  2. Verify interface exists: ip link show {self.interface}\n"
                    diagnostic += f"  3. Check capabilities: getcap {python_executable}\n"
                    diagnostic += f"  4. Verify interface is UP: ip link set {self.interface} up"

                    raise Exception(diagnostic)
                else:
                    raise

            num_slaves = self.master.config_init()
            if num_slaves > 0:
                print(f"Found {num_slaves} EtherCAT slave(s)", file=sys.stderr)
                # Same as legacy test_ethercat_io / setup/dist bridge: refresh AL status before trusting slave.state
                self._read_state_locked()

                found_devices = []
                for slave_pos in range(len(self.master.slaves)):
                    slave = self.master.slaves[slave_pos]
                    slave_info = f"{slave.name}"
                    if hasattr(slave, 'man') and hasattr(slave, 'id'):
                        try:
                            slave_info += f" (Vendor: 0x{slave.man:04X}, Product: 0x{slave.id:04X})"
                        except Exception:
                            pass
                    found_devices.append(f"  - Position {slave_pos}: {slave_info} (state: {self._get_state_name(slave.state)})")
                    print(f"  Slave {slave_pos}: {slave_info} (state: {self._get_state_name(slave.state)})", file=sys.stderr)

                device_found = False
                target_slave_pos = 0

                for slave_pos in range(len(self.master.slaves)):
                    slave = self.master.slaves[slave_pos]
                    if self.device_name.lower() in slave.name.lower():
                        device_found = True
                        target_slave_pos = slave_pos
                        print(f"✓ Found target device: {slave.name} at position {slave_pos}", file=sys.stderr)
                        break

                if not device_found:
                    if len(self.master.slaves) > 0:
                        print(f"ℹ️  Device name '{self.device_name}' not found in slave name '{self.master.slaves[0].name}'", file=sys.stderr)
                        print(f"   This is normal if pysoem returns GroupType (e.g., 'DigitalIO') instead of Type name.", file=sys.stderr)
                        print(f"   Using first available slave: {self.master.slaves[0].name}", file=sys.stderr)
                        print("   Available devices:", file=sys.stderr)
                        for device_info in found_devices:
                            print(device_info, file=sys.stderr)
                        target_slave_pos = 0
                    else:
                        raise Exception(f"Device '{self.device_name}' not found on EtherCAT network. No slaves available.")

                PREOP_STATE = getattr(pysoem, 'PREOP_STATE', 2)
                SAFEOP_STATE = getattr(pysoem, 'SAFEOP_STATE', 4)
                OP_STATE = getattr(pysoem, 'OP_STATE', 8)

                target_slave = self.master.slaves[target_slave_pos]
                current_state = int(target_slave.state)

                # Reference base (ethercat comunication base): only step through states that
                # are still below the target. Re-writing PREOP when the slave is already
                # in PREOP (e.g. raw 0x12) can wedge the device in an invalid AL state.
                if current_state != OP_STATE:
                    print(f"Device not in OP state (current: {self._get_state_name(current_state)}) - transitioning...", file=sys.stderr)

                    print("Mapping PDOs...", file=sys.stderr)
                    io_map_size = self.master.config_map()
                    print(f"✓ PDO mapping complete (IO map size: {io_map_size} bytes)", file=sys.stderr)
                    self._refresh_expected_wkc()
                    print(f"SOEM expected WKC (cyclic I/O): {self.expected_wkc}", file=sys.stderr)

                    if current_state < PREOP_STATE:
                        print("Transitioning to PREOP state...", file=sys.stderr)
                        self._write_state_locked(PREOP_STATE)
                        time.sleep(0.1)
                        self._read_state_locked()

                    target_slave = self.master.slaves[target_slave_pos]
                    if int(target_slave.state) < SAFEOP_STATE:
                        print("Transitioning to SAFEOP state...", file=sys.stderr)
                        self._write_state_locked(SAFEOP_STATE)
                        time.sleep(0.1)
                        self._read_state_locked()

                    print("Transitioning to OP (Operational) state...", file=sys.stderr)
                    self._write_state_locked(OP_STATE)
                    time.sleep(0.1)
                    self._read_state_locked()

                    # CRITICAL: Start OP maintainer IMMEDIATELY — device drops to SAFEOP if
                    # process data stops for >200ms (BackToSafeopTimeout from XML)
                    print("Starting OP state maintainer (continuous process data exchange)...", file=sys.stderr)
                    self._start_op_state_maintainer()
                    time.sleep(0.05)

                    max_retries = 20
                    retry_delay = 0.1
                    all_slaves_ok = False

                    for retry in range(max_retries):
                        self._read_state_locked()
                        all_slaves_ok = True
                        slave_states = []

                        for slave_pos in range(len(self.master.slaves)):
                            slave = self.master.slaves[slave_pos]
                            state_name = self._get_state_name(slave.state)
                            slave_states.append(f"Slave {slave_pos} ({slave.name}): {state_name} ({slave.state})")
                            if slave.state != OP_STATE:
                                all_slaves_ok = False
                                if retry > 5 and retry % 5 == 0:
                                    print(f"   Retrying OP transition for slave {slave_pos} (current state: {state_name})...", file=sys.stderr)
                                    try:
                                        self._write_state_locked(OP_STATE)
                                        time.sleep(0.1)
                                        self._read_state_locked()
                                    except Exception as e:
                                        print(f"   ⚠️  Retry transition error: {e}", file=sys.stderr)

                        if all_slaves_ok:
                            time.sleep(0.1)
                            self._read_state_locked()
                            if all(s.state == OP_STATE for s in self.master.slaves):
                                print(
                                    f"✅ All {len(self.master.slaves)} slave(s) confirmed in OP state (verified after {retry+1} attempts)",
                                    file=sys.stderr,
                                )
                                break
                            else:
                                all_slaves_ok = False
                        else:
                            if retry < max_retries - 1:
                                if retry % 5 == 0 or retry < 3:
                                    cur = self.master.slaves[0].state if len(self.master.slaves) > 0 else 0
                                    state_name = self._get_state_name(cur)
                                    print(f"   Waiting for OP state... (current: {state_name}, attempt {retry+1}/{max_retries})", file=sys.stderr)
                                time.sleep(retry_delay)
                            else:
                                print("❌ Not all slaves reached OP state after retries:", file=sys.stderr)
                                for state_info in slave_states:
                                    print(f"   {state_info}", file=sys.stderr)
                                print("   Making final OP transition attempt...", file=sys.stderr)
                                try:
                                    self._write_state_locked(OP_STATE)
                                    time.sleep(0.2)
                                    self._read_state_locked()
                                    all_slaves_ok = all(s.state == OP_STATE for s in self.master.slaves)
                                    if all_slaves_ok:
                                        print("✅ Final transition attempt succeeded!", file=sys.stderr)
                                        break
                                except Exception as e:
                                    print(f"   Final attempt error: {e}", file=sys.stderr)

                    if not all_slaves_ok:
                        final_states = []
                        self._read_state_locked()
                        for slave_pos in range(len(self.master.slaves)):
                            slave = self.master.slaves[slave_pos]
                            final_states.append(f"Slave {slave_pos} ({slave.name}): {self._get_state_name(slave.state)} ({slave.state})")
                        raise Exception(
                            f"Not all slaves reached OP state after {max_retries} retries. "
                            f"Final states: {'; '.join(final_states)}. "
                            f"Check device connections, power, and PDO configuration."
                        )
                else:
                    print("Device already in OP state - checking PDO mapping...", file=sys.stderr)
                    if hasattr(target_slave, 'output') and len(target_slave.output) > 0:
                        print("✓ PDOs already mapped (output buffer available)", file=sys.stderr)
                        self._refresh_expected_wkc()
                        if self.expected_wkc <= 0:
                            io_map_size = self.master.config_map()
                            print(f"✓ PDO remap for WKC (IO map size: {io_map_size} bytes)", file=sys.stderr)
                            self._refresh_expected_wkc()
                            print(f"SOEM expected WKC (cyclic I/O): {self.expected_wkc}", file=sys.stderr)
                    else:
                        print("Mapping PDOs...", file=sys.stderr)
                        try:
                            io_map_size = self.master.config_map()
                            print(f"✓ PDO mapping complete (IO map size: {io_map_size} bytes)", file=sys.stderr)
                            self._refresh_expected_wkc()
                            print(f"SOEM expected WKC (cyclic I/O): {self.expected_wkc}", file=sys.stderr)
                        except Exception as e:
                            print(f"⚠️  PDO mapping warning: {e}", file=sys.stderr)

                        self._read_state_locked()
                        target_slave = self.master.slaves[target_slave_pos]
                        if target_slave.state != OP_STATE:
                            self._write_state_locked(OP_STATE)
                            time.sleep(0.2)
                            self._read_state_locked()
                            if target_slave.state != OP_STATE:
                                raise Exception(f"Failed to maintain OP state (current: {target_slave.state})")

                if not self.op_maintainer_running:
                    print("Starting OP state maintainer (device already in OP)...", file=sys.stderr)
                    self._start_op_state_maintainer()
                    time.sleep(0.1)

                # Clear all outputs (reference: exchange 5× so the zero latch sticks)
                target_slave = self.master.slaves[target_slave_pos]
                if len(target_slave.output) >= 2:
                    with self._pd_lock:
                        target_slave.output = struct.pack('<H', 0x0000)
                        for _ in range(5):
                            self.master.send_processdata()
                            self._last_wkc = int(self.master.receive_processdata(2000))
                            time.sleep(0.01)
                    self.output_states = [0] * self.num_outputs
                    print("✓ All outputs cleared", file=sys.stderr)

                self.is_initialized = True
                return {"status": "ok", "slave_count": len(self.master.slaves)}
            else:
                carrier_path = f"/sys/class/net/{self.interface}/carrier"
                carrier_info = ""
                if os.path.exists(carrier_path):
                    try:
                        with open(carrier_path, 'r') as f:
                            carrier_status = f.read().strip()
                        if carrier_status == "0":
                            carrier_info = (
                                f"\nInterface '{self.interface}' shows NO-CARRIER (no physical connection).\n"
                                f"This is likely why no EtherCAT slaves were found."
                            )
                    except Exception:
                        pass

                operstate_path = f"/sys/class/net/{self.interface}/operstate"
                operstate_info = ""
                if os.path.exists(operstate_path):
                    try:
                        with open(operstate_path, 'r') as f:
                            operstate = f.read().strip()
                        if operstate == "down":
                            operstate_info = (
                                f"\nInterface '{self.interface}' is DOWN.\n"
                                f"Try: sudo ip link set {self.interface} up"
                            )
                    except Exception:
                        pass

                error_msg = (
                    f"No EtherCAT slaves found on interface '{self.interface}'.{carrier_info}{operstate_info}\n"
                    f"Troubleshooting:\n"
                    f"  1. Verify EtherCAT device is physically connected to {self.interface}\n"
                    f"  2. Check that EtherCAT device is powered on\n"
                    f"  3. Verify cable integrity\n"
                    f"  4. Check interface status: ip link show {self.interface}\n"
                    f"  5. Ensure interface is up: sudo ip link set {self.interface} up\n"
                    f"  6. Verify EtherCAT network topology (no breaks in chain)\n"
                    f"  7. Try: sudo ethercat slaves (if ethercat tools installed)"
                )
                raise Exception(error_msg)

        except Exception as e:
            return {"status": "error", "error": str(e)}

    def ping(self) -> Dict[str, Any]:
        """Health check — verify connection and slave states"""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}

        try:
            OP_STATE = getattr(pysoem, 'OP_STATE', 8)

            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}

            self._read_state_locked()

            all_slaves_in_op = True
            for slave in self.master.slaves:
                if slave.state != OP_STATE:
                    all_slaves_in_op = False
                    break

            if all_slaves_in_op:
                # Reference bridge (ethercat comunication base) reports healthy whenever the
                # slave is in OP. A cyclic WKC mismatch is advisory only — the maintainer keeps
                # frames flowing and I/O still works — so surface it as a non-fatal warning
                # instead of an error. Returning "error" here made ethercatHealth.mjs escalate
                # to a full bridge teardown/reconnect every COMM_FAILURE_THRESHOLD pings, which
                # bounced EtherCAT in a ~40s loop while the slave was actually at AL=OP.
                if self.expected_wkc > 0 and self._last_wkc != self.expected_wkc:
                    return {
                        "status": "ok",
                        "warning": (
                            f"Process data WKC {self._last_wkc} != expected {self.expected_wkc} "
                            f"(slave RUN/OP LED may be wrong until frames are healthy)"
                        ),
                    }
                return {"status": "ok"}

            slave_states = [
                f"Slave {i} ({s.name}): {self._get_state_name(s.state)}"
                for i, s in enumerate(self.master.slaves)
            ]
            return {"status": "error", "error": f"Slave(s) not in OP state. States: {'; '.join(slave_states)}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def set_output(self, pin: int, value: int) -> Dict[str, Any]:
        """Set digital output pin using process data (ethercat comunication base pattern).

        Always force several send/receive cycles after updating the IOmap so the
        slave latches the write — do not rely on the OP maintainer alone.
        """
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}
        if pin < 0 or pin >= self.num_outputs:
            return {"status": "error", "error": f"Invalid pin: {pin}"}

        try:
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}

            slave = self.master.slaves[0]
            if len(slave.output) < 2:
                return {"status": "error", "error": "Output buffer not available (PDO mapping issue)"}

            # Reference bridge: update buffer, then exchange 5× so the write is
            # persisted on the wire (OP maintainer continues sending afterward).
            with self._pd_lock:
                current = struct.unpack('<H', slave.output[:2])[0]
                new_output = current | (1 << pin) if value else current & ~(1 << pin)
                slave.output = struct.pack('<H', new_output)
                for _ in range(5):
                    self.master.send_processdata()
                    self._last_wkc = int(self.master.receive_processdata(2000))
                    time.sleep(0.01)

            self.output_states[pin] = value
            return {"status": "ok", "pin": pin, "value": value}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def get_input(self, pin: int) -> Dict[str, Any]:
        """Get digital input pin state (reference: always refresh process data)."""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}
        if pin < 0 or pin >= self.num_inputs:
            return {"status": "error", "error": f"Invalid pin: {pin}"}

        try:
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}

            slave = self.master.slaves[0]
            # Reference bridge always does a fresh exchange before reading.
            self._last_wkc = self._exchange_once(2000)

            if len(slave.input) < 2:
                return {"status": "error", "error": "Input buffer not available (PDO mapping issue)"}

            with self._pd_lock:
                input_value = struct.unpack('<H', slave.input[:2])[0]
            # US Machine: DI0/DI1 are active HIGH (24V when pressed) — no inversion.
            value = (input_value >> pin) & 1

            self.input_states[pin] = value
            return {"status": "ok", "pin": pin, "value": value}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def get_all_inputs(self) -> Dict[str, Any]:
        """Read all 16 digital inputs at once (reference: refresh process data first)."""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}

        try:
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}

            slave = self.master.slaves[0]
            self._last_wkc = self._exchange_once(2000)

            if len(slave.input) < 2:
                return {"status": "error", "error": "Input buffer not available"}

            with self._pd_lock:
                input_value = struct.unpack('<H', slave.input[:2])[0]
            inputs = []
            for pin in range(self.num_inputs):
                bit = (input_value >> pin) & 1
                inputs.append(bit)
                self.input_states[pin] = bit

            return {"status": "ok", "inputs": inputs, "raw": input_value}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def get_all_outputs(self) -> Dict[str, Any]:
        """Read current output state"""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}

        try:
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}

            slave = self.master.slaves[0]
            if len(slave.output) < 2:
                return {"status": "error", "error": "Output buffer not available"}

            with self._pd_lock:
                output_value = struct.unpack('<H', slave.output[:2])[0]
            outputs = [(output_value >> pin) & 1 for pin in range(self.num_outputs)]
            return {"status": "ok", "outputs": outputs, "raw": output_value}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def enable_button_monitor(self, start_pin: int, stop_pin: int) -> Dict[str, Any]:
        """Enable button monitoring thread"""
        if not self.is_initialized:
            return {"status": "error", "error": "Not initialized"}

        self.button_monitoring = True

        def monitor_loop():
            last_start_state = None
            last_stop_state = None

            while self.button_monitoring:
                try:
                    start_result = self.get_input(start_pin)
                    stop_result = self.get_input(stop_pin)

                    start_state = start_result.get("value", 0) if start_result.get("status") == "ok" else 0
                    stop_state = stop_result.get("value", 0) if stop_result.get("status") == "ok" else 0

                    if last_start_state is not None and start_state != last_start_state:
                        print(json.dumps({"event": "button_press", "data": {"button": start_pin, "state": start_state}}), flush=True)

                    if last_stop_state is not None and stop_state != last_stop_state:
                        print(json.dumps({"event": "button_press", "data": {"button": stop_pin, "state": stop_state}}), flush=True)

                    last_start_state = start_state
                    last_stop_state = stop_state
                    time.sleep(0.05)
                except Exception as e:
                    print(f"ERROR in button monitor: {e}", file=sys.stderr)
                    time.sleep(0.1)

        self.button_monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        self.button_monitor_thread.start()
        return {"status": "ok"}

    def _start_op_state_maintainer(self):
        """Start background thread to maintain OP state by continuously sending process data.
        Device requires process data every <200ms (BackToSafeopTimeout from XML)."""
        if self.op_maintainer_running:
            return

        self.op_maintainer_running = True

        def maintain_loop():
            cycle_time = 0.005  # 5ms = 200Hz — reference OPStateMaintainer pattern
            error_count = 0
            max_errors = 10

            # Reference base: maintainer only runs after init completes (is_initialized).
            while self.op_maintainer_running and self.is_initialized and self.master:
                try:
                    if len(self.master.slaves) == 0:
                        break

                    slave = self.master.slaves[0]

                    if not hasattr(slave, 'output') or len(slave.output) == 0:
                        time.sleep(0.01)
                        continue

                    # Do NOT modify output buffer here — set_output() owns buffer updates.
                    self._last_wkc = self._exchange_once(2000)

                    if not hasattr(self, '_maintainer_cycle_count'):
                        self._maintainer_cycle_count = 0
                    self._maintainer_cycle_count += 1

                    if self._maintainer_cycle_count % 100 == 0:
                        self._read_state_locked()
                        OP_STATE = getattr(pysoem, "OP_STATE", 8)
                        if slave.state != OP_STATE:
                            print(f"⚠️  WARNING: Device dropped to state {slave.state} (expected OP=8)", file=sys.stderr)
                            print("   Attempting to recover...", file=sys.stderr)
                            try:
                                self._write_state_locked(OP_STATE)
                                time.sleep(0.1)
                                self._read_state_locked()
                                if slave.state == OP_STATE:
                                    print("   ✓ Recovered to OP state", file=sys.stderr)
                                else:
                                    print(f"   ✗ Recovery failed (current state: {slave.state})", file=sys.stderr)
                            except Exception as e:
                                print(f"   ✗ Recovery error: {e}", file=sys.stderr)

                    error_count = 0
                    time.sleep(cycle_time)

                except Exception as e:
                    error_count += 1
                    if error_count >= max_errors:
                        print(f"❌ OP maintainer error (count: {error_count}): {e}", file=sys.stderr)
                        self.op_maintainer_running = False
                        break
                    time.sleep(cycle_time)

        self.op_maintainer_thread = threading.Thread(target=maintain_loop, daemon=True)
        self.op_maintainer_thread.start()
        print("✓ OP state maintainer started (continuous process data exchange at 200Hz)", file=sys.stderr)

    def _stop_op_state_maintainer(self):
        self.op_maintainer_running = False
        if self.op_maintainer_thread:
            self.op_maintainer_thread.join(timeout=1.0)
        self.op_maintainer_thread = None

    def cleanup(self):
        self.button_monitoring = False
        self._stop_op_state_maintainer()

        if self.master:
            try:
                if self.is_initialized and len(self.master.slaves) > 0:
                    slave = self.master.slaves[0]
                    if len(slave.output) >= 2:
                        with self._pd_lock:
                            slave.output = struct.pack('<H', 0x0000)
                        self._exchange_once(2000)

                self._write_state_locked(pysoem.INIT_STATE)
                with self._pd_lock:
                    self.master.close()
            except Exception:
                pass

        self.is_initialized = False


def main():
    if len(sys.argv) < 4:
        print("Usage: ethercat_bridge.py <interface> <device_name> <xml_path>", file=sys.stderr)
        sys.exit(1)

    interface = sys.argv[1]
    device_name = sys.argv[2]
    xml_path = sys.argv[3]

    bridge = EtherCATBridge(interface, device_name, xml_path)

    def _on_shutdown(signum, _frame):
        print(f"Signal {signum} — releasing EtherCAT master", file=sys.stderr)
        bridge.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _on_shutdown)
    signal.signal(signal.SIGINT, _on_shutdown)

    try:
        for line in sys.stdin:
            if not line.strip():
                continue

            try:
                command_obj = json.loads(line)
                command_id = command_obj.get("id")
                command = command_obj.get("command")
                params = command_obj.get("params", {})

                if command == "init":
                    result = bridge.init()
                elif command == "ping":
                    result = bridge.ping()
                elif command == "set_output":
                    result = bridge.set_output(params.get("pin"), params.get("value"))
                elif command == "get_input":
                    result = bridge.get_input(params.get("pin"))
                elif command == "get_all_inputs":
                    result = bridge.get_all_inputs()
                elif command == "get_all_outputs":
                    result = bridge.get_all_outputs()
                elif command == "enable_button_monitor":
                    result = bridge.enable_button_monitor(
                        params.get("start_pin"),
                        params.get("stop_pin")
                    )
                elif command == "cleanup":
                    bridge.cleanup()
                    result = {"status": "ok", "message": "EtherCAT cleanup complete"}
                else:
                    result = {"status": "error", "error": f"Unknown command: {command}"}

                print(json.dumps({"id": command_id, "result": result}), flush=True)

            except json.JSONDecodeError as e:
                print(json.dumps({"id": None, "error": f"Invalid JSON: {str(e)}"}), flush=True)
            except Exception as e:
                print(json.dumps({"id": command_obj.get("id") if 'command_obj' in locals() else None, "error": str(e)}), flush=True)

    except KeyboardInterrupt:
        pass
    finally:
        bridge.cleanup()


if __name__ == "__main__":
    main()
