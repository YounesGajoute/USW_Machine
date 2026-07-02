#!/usr/bin/env python3
"""
EtherCAT Bridge for Air Leakage Test System
Communicates with EtherCAT devices using pysoem library
Provides JSON-based command interface via stdin/stdout
"""

import sys
import json
import time
import threading
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
        
        # Device configuration (from XML)
        # XHS_ECT_MD1616_V2.0: 16 outputs, 16 inputs
        self.num_outputs = 16
        self.num_inputs = 16
        
        # PDO mapping (from XML)
        # Outputs: SM2 (StartAddress 0x0f00, 0x0f01) - 2 bytes
        # Inputs: SM4 (StartAddress 0x1002) - 2 bytes
        self.output_sm = 2
        self.input_sm = 4
        self.output_start_addr = 0x0f00
        self.input_start_addr = 0x1002
        
        # State tracking
        self.output_states = [0] * self.num_outputs
        self.input_states = [0] * self.num_inputs
    
    def _get_state_name(self, state: int) -> str:
        """Convert pysoem state constant to human-readable name"""
        state_names = {
            1: "INIT",
            2: "PREOP",
            4: "SAFEOP",
            8: "OP"
        }
        # Handle edge cases: state 17 (0x11) might be INIT (0x01) + error flag (0x10)
        # This can occur before read_state() is called
        if state in state_names:
            return state_names[state]
        # Check if it's a combination state (unlikely but possible)
        if state == 17:  # 0x11 = INIT (0x01) + 0x10 (possibly error flag)
            return "INIT? (may need read_state())"
        return f"UNKNOWN({state})"
    
    def _list_interfaces(self) -> str:
        """List available network interfaces"""
        try:
            net_dir = "/sys/class/net"
            if os.path.exists(net_dir):
                interfaces = [d for d in os.listdir(net_dir) if os.path.isdir(os.path.join(net_dir, d))]
                return ", ".join(interfaces)
        except:
            pass
        return "unknown"
        
    def init(self) -> Dict[str, Any]:
        """Initialize EtherCAT master and scan for devices"""
        try:
            # Verify interface exists before attempting to open
            interface_path = f"/sys/class/net/{self.interface}"
            if not os.path.exists(interface_path):
                raise Exception(f"Interface '{self.interface}' does not exist. Available interfaces: {self._list_interfaces()}")
            
            # Check interface carrier status before attempting to open
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
                    # If we can't read carrier file (permissions, etc.), continue anyway
                    # This might be a virtual interface or permission issue
                    print(f"⚠️  Could not check carrier status: {io_error}", file=sys.stderr)
                # Note: Our intentional Exception for NO-CARRIER will propagate to outer handler
            
            self.master = pysoem.Master()
            
            # Attempt to open interface with better error handling
            try:
                self.master.open(self.interface)
            except Exception as open_error:
                error_msg = str(open_error)
                # Provide helpful diagnostics for common errors
                if "could not open" in error_msg.lower() or "permission denied" in error_msg.lower():
                    # Check capabilities on the actual Python executable being used
                    # Get the actual Python executable path (resolved symlinks)
                    python_executable = sys.executable
                    if os.path.islink(python_executable):
                        python_executable = os.path.realpath(python_executable)
                    
                    # Also check common system Python paths as fallback
                    python_paths_to_check = [
                        python_executable,
                        '/usr/bin/python3.11',
                        '/usr/bin/python3',
                        '/usr/bin/python3.12',
                        '/usr/bin/python3.10',
                    ]
                    
                    has_caps = False
                    checked_path = None
                    for python_path in python_paths_to_check:
                        if os.path.exists(python_path):
                            try:
                                cap_check = subprocess.run(['getcap', python_path], 
                                                          capture_output=True, text=True, timeout=1)
                                if cap_check.returncode == 0 and 'cap_net_raw' in cap_check.stdout:
                                    has_caps = True
                                    checked_path = python_path
                                    break
                            except Exception:
                                continue
                    
                    diagnostic = (
                        f"Failed to open EtherCAT interface '{self.interface}'. "
                        f"This usually indicates missing permissions or no EtherCAT device connected.\n"
                    )
                    
                    if not has_caps:
                        diagnostic += (
                            f"Capabilities check: NOT SET on Python executable\n"
                            f"  Checked: {python_executable}\n"
                            f"  Solution: Run 'sudo bash scripts/setup_ethercat_permissions.sh' to set capabilities.\n"
                            f"  This sets cap_net_raw+ep on the Python executable to allow raw socket access.\n"
                        )
                    else:
                        diagnostic += (
                            f"Capabilities check: SET on {checked_path or python_executable}\n"
                            f"If capabilities are set but still failing, possible causes:\n"
                            f"  1. No EtherCAT device connected to {self.interface}\n"
                            f"  2. Interface not configured for EtherCAT\n"
                            f"  3. Device not powered on\n"
                            f"  4. Interface not fully ready (try waiting a few seconds)\n"
                            f"  5. Process spawned in a way that doesn't inherit capabilities\n"
                        )
                    
                    # Additional diagnostics
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
            
            # Scan for devices
            num_slaves = self.master.config_init()
            if num_slaves > 0:
                print(f"Found {num_slaves} EtherCAT slave(s)", file=sys.stderr)
                
                # CRITICAL: Read state immediately after config_init() to get actual slave states
                # Before this, slave.state may contain uninitialized values (e.g., state 17)
                self.master.read_state()
                
                # List all found devices for diagnostics (now with correct state info)
                found_devices = []
                for slave_pos in range(len(self.master.slaves)):
                    slave = self.master.slaves[slave_pos]
                    # Try to get additional device info for better matching
                    slave_info = f"{slave.name}"
                    if hasattr(slave, 'man') and hasattr(slave, 'id'):
                        try:
                            slave_info += f" (Vendor: 0x{slave.man:04X}, Product: 0x{slave.id:04X})"
                        except:
                            pass
                    found_devices.append(f"  - Position {slave_pos}: {slave_info} (state: {self._get_state_name(slave.state)})")
                    print(f"  Slave {slave_pos}: {slave_info} (state: {self._get_state_name(slave.state)})", file=sys.stderr)
                
                # Find target device
                # Note: pysoem slave.name may return GroupType (e.g., "DigitalIO") instead of Type name
                # (e.g., "XHS_ECT_MD1616_V2.0") depending on pysoem version and device configuration.
                # This is normal - device functionality is not affected.
                device_found = False
                target_slave_pos = 0
                
                # Try to match by configured device name (case-insensitive substring match)
                for slave_pos in range(len(self.master.slaves)):
                    slave = self.master.slaves[slave_pos]
                    if self.device_name.lower() in slave.name.lower():
                        device_found = True
                        target_slave_pos = slave_pos
                        print(f"✓ Found target device: {slave.name} at position {slave_pos}", file=sys.stderr)
                        break
                
                if not device_found:
                    # Device name not found - use first slave with informative message
                    # This is acceptable since pysoem may return GroupType instead of Type name
                    if len(self.master.slaves) > 0:
                        print(f"ℹ️  Device name '{self.device_name}' not found in slave name '{self.master.slaves[0].name}'", file=sys.stderr)
                        print(f"   This is normal if pysoem returns GroupType (e.g., 'DigitalIO') instead of Type name.", file=sys.stderr)
                        print(f"   Using first available slave: {self.master.slaves[0].name}", file=sys.stderr)
                        print(f"   Available devices:", file=sys.stderr)
                        for device_info in found_devices:
                            print(device_info, file=sys.stderr)
                        target_slave_pos = 0
                    else:
                        raise Exception(f"Device '{self.device_name}' not found on EtherCAT network. No slaves available.")
                
                # State machine transition: INIT -> PREOP -> SAFEOP -> OP
                # EtherCAT state constants: INIT=1, PREOP=2, SAFEOP=4, OP=8
                # Use numeric values for compatibility across pysoem versions
                PREOP_STATE = getattr(pysoem, 'PREOP_STATE', 2)
                SAFEOP_STATE = getattr(pysoem, 'SAFEOP_STATE', 4)
                OP_STATE = getattr(pysoem, 'OP_STATE', 8)
                
                # Get current state (state was already read above after config_init())
                target_slave = self.master.slaves[target_slave_pos]
                current_state = target_slave.state
                
                # Only transition states if not already in OP (matches test_ethercat_io.py:526-527)
                if current_state != OP_STATE:
                    print(f"Device not in OP state (current: {self._get_state_name(current_state)}) - transitioning...", file=sys.stderr)
                    
                    # Configure PDOs (needed before OP state)
                    print("Mapping PDOs...", file=sys.stderr)
                    io_map_size = self.master.config_map()
                    print(f"✓ PDO mapping complete (IO map size: {io_map_size} bytes)", file=sys.stderr)
                    
                    # Transition to PREOP state (only if needed)
                    if current_state < PREOP_STATE:
                        print("Transitioning to PREOP state...", file=sys.stderr)
                        self.master.state = PREOP_STATE
                        self.master.write_state()
                        time.sleep(0.1)  # Allow time for state transition
                        self.master.read_state()
                    
                    # Transition to SAFEOP state (only if needed)
                    target_slave = self.master.slaves[target_slave_pos]
                    if target_slave.state < SAFEOP_STATE:
                        print("Transitioning to SAFEOP state...", file=sys.stderr)
                        self.master.state = SAFEOP_STATE
                        self.master.write_state()
                        time.sleep(0.1)  # Allow time for state transition
                        self.master.read_state()
                    
                    # Transition to OP state
                    print("Transitioning to OP (Operational) state...", file=sys.stderr)
                    self.master.state = OP_STATE
                    self.master.write_state()
                    time.sleep(0.1)  # Allow time for state transition (matching test_ethercat_io.py:556)
                    self.master.read_state()
                    
                    # CRITICAL: Start OP state maintainer IMMEDIATELY after OP transition
                    # According to XML: BackToSafeopTimeout = 200ms
                    # Device will drop to SAFEOP if process data stops for >200ms
                    # Must start maintainer BEFORE verification to ensure continuous process data
                    print("Starting OP state maintainer (continuous process data exchange)...", file=sys.stderr)
                    self._start_op_state_maintainer()
                    time.sleep(0.05)  # Brief delay to let maintainer start
                    
                    # Wait for all slaves to reach OP state with retries (matching test_ethercat_io.py:560-583)
                    # CRITICAL: retry_delay must be < 200ms to prevent device from dropping to SAFEOP
                    # Maintainer is already running, so we can check more frequently
                    max_retries = 20  # Matching test_ethercat_io.py:560
                    retry_delay = 0.1  # 100ms between retries (less than 200ms timeout, maintainer sends data every 5ms)
                    all_slaves_ok = False
                    
                    for retry in range(max_retries):
                        # Read current state of all slaves
                        self.master.read_state()
                        
                        all_slaves_ok = True
                        slave_states = []
                        
                        for slave_pos in range(len(self.master.slaves)):
                            slave = self.master.slaves[slave_pos]
                            state_name = self._get_state_name(slave.state)
                            slave_states.append(f"Slave {slave_pos} ({slave.name}): {state_name} ({slave.state})")
                            
                            if slave.state != OP_STATE:
                                all_slaves_ok = False
                                # If slave is stuck in a state, try to transition again
                                if retry > 5 and retry % 5 == 0:  # Every 5 retries after initial 5
                                    print(f"   Retrying OP transition for slave {slave_pos} (current state: {state_name})...", file=sys.stderr)
                                    try:
                                        self.master.state = OP_STATE
                                        self.master.write_state()
                                        time.sleep(0.1)
                                        self.master.read_state()
                                        # Process data is already being sent by maintainer thread
                                    except Exception as e:
                                        print(f"   ⚠️  Retry transition error: {e}", file=sys.stderr)
                        
                        if all_slaves_ok:
                            # Verify it stays in OP by checking again (matching test_ethercat_io.py:568-574)
                            # Process data is continuously sent by maintainer thread, so just verify
                            time.sleep(0.1)  # Matching test_ethercat_io.py:569
                            self.master.read_state()
                            if all(s.state == OP_STATE for s in self.master.slaves):
                                print(f"✅ All {len(self.master.slaves)} slave(s) confirmed in OP state (verified after {retry+1} attempts)", file=sys.stderr)
                                break
                            else:
                                all_slaves_ok = False
                        else:
                            if retry < max_retries - 1:
                                # Process data is continuously sent by maintainer thread
                                # Just wait and check again
                                if retry % 5 == 0 or retry < 3:  # Log every 5 retries or first 3
                                    current_state = self.master.slaves[0].state if len(self.master.slaves) > 0 else 0
                                    state_name = {1: "INIT", 2: "PREOP", 4: "SAFEOP", 8: "OP"}.get(current_state, f"UNKNOWN({current_state})")
                                    print(f"   Waiting for OP state... (current: {state_name}, attempt {retry+1}/{max_retries})", file=sys.stderr)
                                time.sleep(retry_delay)
                            else:
                                # Last attempt failed - report detailed state
                                print("❌ Not all slaves reached OP state after retries:", file=sys.stderr)
                                for state_info in slave_states:
                                    print(f"   {state_info}", file=sys.stderr)
                                # Try one more transition attempt
                                print("   Making final OP transition attempt...", file=sys.stderr)
                                try:
                                    self.master.state = OP_STATE
                                    self.master.write_state()
                                    time.sleep(0.2)
                                    self.master.read_state()
                                    # Process data is continuously sent by maintainer thread
                                    # Check one more time
                                    all_slaves_ok = all(s.state == OP_STATE for s in self.master.slaves)
                                    if all_slaves_ok:
                                        print("✅ Final transition attempt succeeded!", file=sys.stderr)
                                        break
                                except Exception as e:
                                    print(f"   Final attempt error: {e}", file=sys.stderr)
                    
                    if not all_slaves_ok:
                        # Get final states for error message
                        final_states = []
                        self.master.read_state()
                        for slave_pos in range(len(self.master.slaves)):
                            slave = self.master.slaves[slave_pos]
                            final_states.append(f"Slave {slave_pos} ({slave.name}): {self._get_state_name(slave.state)} ({slave.state})")
                        raise Exception(f"Not all slaves reached OP state after {max_retries} retries. Final states: {'; '.join(final_states)}. Check device connections, power, and PDO configuration.")
                else:
                    # Already in OP state - check if PDOs are mapped
                    print("Device already in OP state - checking PDO mapping...", file=sys.stderr)
                    if hasattr(target_slave, 'output') and len(target_slave.output) > 0:
                        print("✓ PDOs already mapped (output buffer available)", file=sys.stderr)
                    else:
                        print("Mapping PDOs...", file=sys.stderr)
                        try:
                            io_map_size = self.master.config_map()
                            print(f"✓ PDO mapping complete (IO map size: {io_map_size} bytes)", file=sys.stderr)
                        except Exception as e:
                            print(f"⚠️  PDO mapping warning: {e}", file=sys.stderr)
                            print("   (PDOs may already be mapped)", file=sys.stderr)
                        
                        # Verify device is still in OP state after mapping
                        self.master.read_state()
                        target_slave = self.master.slaves[target_slave_pos]
                        if target_slave.state != OP_STATE:
                            print(f"⚠️  Device state changed to {target_slave.state}, transitioning back to OP...", file=sys.stderr)
                            self.master.state = OP_STATE
                            self.master.write_state()
                            time.sleep(0.2)
                            self.master.read_state()
                            if target_slave.state == OP_STATE:
                                print("✓ Device back in OP state", file=sys.stderr)
                            else:
                                raise Exception(f"Failed to maintain OP state (current: {target_slave.state})")
                
                # OP state maintainer should already be running (started immediately after OP transition)
                # If we're here and maintainer isn't running, start it now (for "already in OP" case)
                if not self.op_maintainer_running:
                    print("Starting OP state maintainer (device already in OP)...", file=sys.stderr)
                    self._start_op_state_maintainer()
                    time.sleep(0.1)  # Give maintainer time to start (matching test_ethercat_io.py:658)
                
                # Clear all outputs initially (like test_ethercat_io.py:635-643)
                target_slave = self.master.slaves[target_slave_pos]
                if len(target_slave.output) >= 2:
                    target_slave.output = struct.pack('<H', 0x0000)
                    # Send process data multiple times to ensure it's received
                    for _ in range(5):
                        self.master.send_processdata()
                        self.master.receive_processdata(2000)
                        time.sleep(0.01)
                    # Reset tracked states
                    self.output_states = [0] * self.num_outputs
                    print("✓ All outputs cleared", file=sys.stderr)
                
                self.is_initialized = True
                return {"status": "ok", "slave_count": len(self.master.slaves)}
            else:
                # Check interface carrier status for better diagnostics
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
                    except:
                        pass
                
                # Check interface operational state
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
                    except:
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
        """Health check - verify connection and slave states"""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}
        
        try:
            OP_STATE = getattr(pysoem, 'OP_STATE', 8)
            
            # CRITICAL: Check actual slave states, not master.state
            # master.state is the REQUESTED state, but we need to verify
            # that slaves are actually in OP state (like OP state maintainer does)
            # Note: read_state() is called concurrently by OP state maintainer thread,
            # but pysoem operations are generally thread-safe at the C library level
            self.master.read_state()
            
            # Verify all slaves are in OP state
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}
            
            all_slaves_in_op = True
            for slave_pos in range(len(self.master.slaves)):
                slave = self.master.slaves[slave_pos]
                if slave.state != OP_STATE:
                    all_slaves_in_op = False
                    break
            
            if all_slaves_in_op:
                return {"status": "ok"}
            else:
                # Get detailed state info for diagnostics
                slave_states = []
                for slave_pos in range(len(self.master.slaves)):
                    slave = self.master.slaves[slave_pos]
                    state_name = self._get_state_name(slave.state)
                    slave_states.append(f"Slave {slave_pos} ({slave.name}): {state_name}")
                
                error_msg = f"Slave(s) not in OP state. States: {'; '.join(slave_states)}"
                return {"status": "error", "error": error_msg}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def set_output(self, pin: int, value: int) -> Dict[str, Any]:
        """Set digital output pin using process data (like test_ethercat_io.py)"""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}
        
        if pin < 0 or pin >= self.num_outputs:
            return {"status": "error", "error": f"Invalid pin: {pin}"}
        
        try:
            # Use process data approach (like test_ethercat_io.py)
            # This is more reliable than read_output/write_output
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}
            
            slave = self.master.slaves[0]
            
            # Check if output buffer is available
            if len(slave.output) < 2:
                return {"status": "error", "error": "Output buffer not available (PDO mapping issue)"}
            
            # Read current output value
            current = struct.unpack('<H', slave.output[:2])[0] if len(slave.output) >= 2 else 0
            
            # Update bit
            if value:
                new_output = current | (1 << pin)
            else:
                new_output = current & ~(1 << pin)
            
            # Set output using process data
            # CRITICAL: Update the output buffer directly - OP state maintainer sends this buffer
            # without modifying it (matches test_ethercat_io.py design)
            slave.output = struct.pack('<H', new_output)
            
            # Send multiple times to ensure it's received and persisted
            for _ in range(5):  # Send multiple times like test script
                self.master.send_processdata()
                self.master.receive_processdata(2000)
                time.sleep(0.01)
            
            # Verify the output was set correctly
            # The OP state maintainer will continue to send this value
            
            # Update local state
            self.output_states[pin] = value
            
            return {"status": "ok", "pin": pin, "value": value}
            
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def get_input(self, pin: int) -> Dict[str, Any]:
        """Get digital input pin state using process data (like test_ethercat_io.py)"""
        if not self.is_initialized or not self.master:
            return {"status": "error", "error": "Not initialized"}
        
        if pin < 0 or pin >= self.num_inputs:
            return {"status": "error", "error": f"Invalid pin: {pin}"}
        
        try:
            # Use process data approach (like test_ethercat_io.py)
            if len(self.master.slaves) == 0:
                return {"status": "error", "error": "No slaves available"}
            
            slave = self.master.slaves[0]
            
            # Ensure we have fresh process data
            self.master.send_processdata()
            self.master.receive_processdata(2000)
            
            # Read input from process data
            if len(slave.input) < 2:
                return {"status": "error", "error": "Input buffer not available (PDO mapping issue)"}
            
            input_value = struct.unpack('<H', slave.input[:2])[0]
            
            # Extract bit (buttons are active LOW, so invert for normal logic)
            value = (input_value >> pin) & 1
            
            # For buttons (DI0, DI1), they're active LOW, so invert
            if pin == 0 or pin == 1:  # Start/Stop buttons
                value = 1 - value  # Invert: pressed = 1, released = 0
            
            self.input_states[pin] = value
            
            return {"status": "ok", "pin": pin, "value": value}
            
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
                    # Read button states
                    start_result = self.get_input(start_pin)
                    stop_result = self.get_input(stop_pin)
                    
                    start_state = start_result.get("value", 0) if start_result.get("status") == "ok" else 0
                    stop_state = stop_result.get("value", 0) if stop_result.get("status") == "ok" else 0
                    
                    # Detect state changes - only send events on transitions
                    # Send event when button is PRESSED (state = 1) or RELEASED (state = 0)
                    # The TypeScript code will filter to only trigger callbacks on press
                    if last_start_state is not None and start_state != last_start_state:
                        event = {
                            "event": "button_press",
                            "data": {
                                "button": start_pin,
                                "state": start_state
                            }
                        }
                        print(json.dumps(event), flush=True)
                    
                    if last_stop_state is not None and stop_state != last_stop_state:
                        event = {
                            "event": "button_press",
                            "data": {
                                "button": stop_pin,
                                "state": stop_state
                            }
                        }
                        print(json.dumps(event), flush=True)
                    
                    last_start_state = start_state
                    last_stop_state = stop_state
                    
                    time.sleep(0.05)  # 50ms polling interval
                    
                except Exception as e:
                    print(f"ERROR in button monitor: {e}", file=sys.stderr)
                    time.sleep(0.1)
        
        self.button_monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        self.button_monitor_thread.start()
        
        return {"status": "ok"}
    
    def _start_op_state_maintainer(self):
        """Start background thread to maintain OP state by continuously sending process data"""
        # CRITICAL: Device requires process data every <200ms to stay in OP state
        # XML: BackToSafeopTimeout = 200ms
        # Cycle time: 5ms = 200Hz to ensure OP state maintenance
        # NOTE: Do NOT rebuild output buffer here - the output buffer is maintained
        # by set_output() calls. This thread only sends/receives process data to keep
        # the device in OP state (matches test_ethercat_io.py OPStateMaintainer design)
        if self.op_maintainer_running:
            return
        
        self.op_maintainer_running = True
        
        def maintain_loop():
            OP_STATE = getattr(pysoem, 'OP_STATE', 8)
            cycle_time = 0.005  # 5ms = 200Hz
            error_count = 0
            max_errors = 10
            
            while self.op_maintainer_running and self.is_initialized and self.master:
                try:
                    if len(self.master.slaves) == 0:
                        break
                    
                    slave = self.master.slaves[0]
                    
                    # Initialize output buffer if not already set (may happen if maintainer starts before outputs cleared)
                    if not hasattr(slave, 'output') or len(slave.output) == 0:
                        # Output buffer not initialized yet - wait a bit for init to complete
                        time.sleep(0.01)
                        continue
                    
                    # Send and receive process data continuously
                    # Do NOT modify output buffer - it's maintained by set_output() calls
                    self.master.send_processdata()
                    self.master.receive_processdata(2000)
                    
                    # Check state periodically (every 100 cycles = ~500ms)
                    if not hasattr(self, '_maintainer_cycle_count'):
                        self._maintainer_cycle_count = 0
                    
                    self._maintainer_cycle_count += 1
                    
                    if self._maintainer_cycle_count % 100 == 0:
                        self.master.read_state()
                        if slave.state != OP_STATE:
                            print(f"⚠️  WARNING: Device dropped to state {slave.state} (expected OP=8)", file=sys.stderr)
                            print("   Attempting to recover...", file=sys.stderr)
                            try:
                                self.master.state = OP_STATE
                                self.master.write_state()
                                time.sleep(0.1)
                                self.master.read_state()
                                if slave.state == OP_STATE:
                                    print("   ✓ Recovered to OP state", file=sys.stderr)
                                else:
                                    print(f"   ✗ Recovery failed (current state: {slave.state})", file=sys.stderr)
                            except Exception as e:
                                print(f"   ✗ Recovery error: {e}", file=sys.stderr)
                    
                    error_count = 0  # Reset error count on success
                    time.sleep(cycle_time)
                    
                except Exception as e:
                    error_count += 1
                    if error_count >= max_errors:
                        print(f"❌ OP maintainer error (count: {error_count}): {e}", file=sys.stderr)
                        print("   Stopping maintainer due to repeated errors", file=sys.stderr)
                        self.op_maintainer_running = False
                        break
                    time.sleep(cycle_time)
        
        self.op_maintainer_thread = threading.Thread(target=maintain_loop, daemon=True)
        self.op_maintainer_thread.start()
        print("✓ OP state maintainer started (continuous process data exchange at 200Hz)", file=sys.stderr)
    
    def _stop_op_state_maintainer(self):
        """Stop OP state maintainer thread"""
        self.op_maintainer_running = False
        if self.op_maintainer_thread:
            self.op_maintainer_thread.join(timeout=1.0)
        self.op_maintainer_thread = None
    
    def cleanup(self):
        """Cleanup resources"""
        self.button_monitoring = False
        self._stop_op_state_maintainer()
        
        if self.master:
            try:
                # Clear outputs before closing
                if self.is_initialized and len(self.master.slaves) > 0:
                    slave = self.master.slaves[0]
                    if len(slave.output) >= 2:
                        slave.output = struct.pack('<H', 0x0000)
                        self.master.send_processdata()
                        self.master.receive_processdata(2000)
                
                self.master.state = pysoem.INIT_STATE
                self.master.write_state()
                self.master.close()
            except:
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
    
    # Command processing loop
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            
            try:
                command_obj = json.loads(line)
                command_id = command_obj.get("id")
                command = command_obj.get("command")
                params = command_obj.get("params", {})
                
                # Execute command
                if command == "init":
                    result = bridge.init()
                elif command == "ping":
                    result = bridge.ping()
                elif command == "set_output":
                    result = bridge.set_output(params.get("pin"), params.get("value"))
                elif command == "get_input":
                    result = bridge.get_input(params.get("pin"))
                elif command == "enable_button_monitor":
                    result = bridge.enable_button_monitor(
                        params.get("start_pin"),
                        params.get("stop_pin")
                    )
                elif command == "cleanup":
                    # Cleanup command: transition EtherCAT device from OP to INIT state
                    # Based on test_ethercat_io_sudo.sh pattern - proper state transition on exit
                    bridge.cleanup()
                    result = {"status": "ok", "message": "EtherCAT cleanup complete - device transitioned to INIT state"}
                else:
                    result = {"status": "error", "error": f"Unknown command: {command}"}
                
                # Send response
                response = {
                    "id": command_id,
                    "result": result
                }
                print(json.dumps(response), flush=True)
                
            except json.JSONDecodeError as e:
                error_response = {
                    "id": None,
                    "error": f"Invalid JSON: {str(e)}"
                }
                print(json.dumps(error_response), flush=True)
            except Exception as e:
                error_response = {
                    "id": command_obj.get("id") if 'command_obj' in locals() else None,
                    "error": str(e)
                }
                print(json.dumps(error_response), flush=True)
    
    except KeyboardInterrupt:
        pass
    finally:
        bridge.cleanup()


if __name__ == "__main__":
    main()

