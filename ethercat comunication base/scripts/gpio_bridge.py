#!/usr/bin/env python3
"""
GPIO Bridge for Air Leakage Test System
Communicates with Raspberry Pi GPIO using gpio_manager.py
Provides JSON-based command interface via stdin/stdout
"""

import sys
import json
import os
from typing import Dict, Any, Optional

# Add scripts directory to path to import gpio_manager
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

try:
    from gpio_manager import GPIOManager
except ImportError:
    print("ERROR: gpio_manager module not found", file=sys.stderr)
    sys.exit(1)


class GPIOBridge:
    def __init__(self, gpio_config_path: str):
        self.gpio_config_path = gpio_config_path
        self.gpio_manager: Optional[GPIOManager] = None
        self.is_initialized = False
        
        # Load GPIO configuration
        self.gpio_config = self._load_gpio_config()
        
        # Set up GPIO_PINS dictionary for gpio_manager
        self._setup_gpio_pins()
    
    def _load_gpio_config(self) -> Dict[str, Any]:
        """Load GPIO configuration from JSON file"""
        try:
            with open(self.gpio_config_path, 'r') as f:
                config = json.load(f)
            return config.get('gpio', {})
        except Exception as e:
            print(f"ERROR: Failed to load GPIO config from {self.gpio_config_path}: {e}", file=sys.stderr)
            sys.exit(1)
    
    def _load_system_config(self) -> Dict[str, Any]:
        """Load system configuration to get chamber_count"""
        try:
            # Try to find system.config.json in the same directory as gpio.config.json
            import os
            config_dir = os.path.dirname(self.gpio_config_path)
            system_config_path = os.path.join(config_dir, 'system.config.json')
            
            if os.path.exists(system_config_path):
                with open(system_config_path, 'r') as f:
                    system_config = json.load(f)
                return system_config.get('system', {})
            else:
                # Default to 1 chamber if system.config.json not found
                return {'chamber_count': 1}
        except Exception as e:
            print(f"WARNING: Failed to load system.config.json: {e}. Using default chamber_count=1", file=sys.stderr)
            return {'chamber_count': 1}
    
    def _setup_gpio_pins(self):
        """Set up GPIO_PINS dictionary for gpio_manager module"""
        pins_config = self.gpio_config.get('pins', {})
        
        # Load system config to get chamber_count
        system_config = self._load_system_config()
        chamber_count = system_config.get('chamber_count', 1)
        
        # Ensure chamber_count is between 1 and 3
        chamber_count = max(1, min(3, chamber_count))
        
        # Build GPIO_PINS dictionary
        GPIO_PINS = {}
        
        # Valve pins - only use first N pins based on chamber_count
        valves = pins_config.get('valves', {})
        if 'inlet' in valves:
            all_inlet_pins = valves['inlet'].get('chambers', [])
            GPIO_PINS['INLET_PINS'] = all_inlet_pins[:chamber_count]
        if 'outlet' in valves:
            all_outlet_pins = valves['outlet'].get('chambers', [])
            GPIO_PINS['OUTLET_PINS'] = all_outlet_pins[:chamber_count]
        if 'emptyTank' in valves:
            all_empty_pins = valves['emptyTank'].get('chambers', [])
            GPIO_PINS['EMPTY_TANK_PINS'] = all_empty_pins[:chamber_count]
        
        # Button pins
        buttons = pins_config.get('buttons', {})
        if 'start' in buttons:
            GPIO_PINS['START_BTN'] = buttons['start'].get('pin', -1)
        if 'stop' in buttons:
            GPIO_PINS['STOP_BTN'] = buttons['stop'].get('pin', -1)
        
        # LED pins
        leds = pins_config.get('leds', {})
        if 'statusGreen' in leds:
            GPIO_PINS['STATUS_LED_GREEN'] = leds['statusGreen'].get('pin', -1)
        if 'statusRed' in leds:
            GPIO_PINS['STATUS_LED_RED'] = leds['statusRed'].get('pin', -1)
        if 'statusYellow' in leds:
            GPIO_PINS['STATUS_LED_YELLOW'] = leds['statusYellow'].get('pin', -1)
        else:
            # STATUS_LED_YELLOW is optional - set to -1 if not configured
            GPIO_PINS['STATUS_LED_YELLOW'] = -1
        
        # Inject GPIO_PINS into gpio_manager module namespace
        import gpio_manager
        gpio_manager.GPIO_PINS = GPIO_PINS
    
    def init(self) -> Dict[str, Any]:
        """Initialize GPIO manager"""
        try:
            self.gpio_manager = GPIOManager()
            if self.gpio_manager.initialize():
                self.is_initialized = True
                
                # Initialize components
                self.gpio_manager._lazy_initialize_component('inlets')
                self.gpio_manager._lazy_initialize_component('outlets')
                self.gpio_manager._lazy_initialize_component('empty_tanks')
                self.gpio_manager._lazy_initialize_component('controls')
                self.gpio_manager._lazy_initialize_component('leds')
                
                return {"status": "ok", "initialized": True}
            else:
                return {"status": "error", "error": "GPIO initialization failed"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def ping(self) -> Dict[str, Any]:
        """Health check"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        return {"status": "ok", "initialized": self.gpio_manager.initialized}
    
    def set_pin(self, pin: int, value: bool) -> Dict[str, Any]:
        """Set GPIO output pin value"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        
        try:
            state = self.gpio_manager.HIGH if value else self.gpio_manager.LOW
            success = self.gpio_manager.set_output(pin, state)
            if success:
                return {"status": "ok", "pin": pin, "value": value}
            else:
                return {"status": "error", "error": f"Failed to set pin {pin}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def read_pin(self, pin: int) -> Dict[str, Any]:
        """Read GPIO input pin value"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        
        try:
            state = self.gpio_manager.read_input(pin)
            if state is not None:
                value = bool(state == self.gpio_manager.HIGH)
                return {"status": "ok", "pin": pin, "value": value}
            else:
                return {"status": "error", "error": f"Failed to read pin {pin}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def set_inlet_valve(self, chamber: int, open: bool) -> Dict[str, Any]:
        """Set inlet valve for a chamber"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        
        try:
            import gpio_manager
            inlet_pin = gpio_manager.GPIO_PINS["INLET_PINS"][chamber]
            state = self.gpio_manager.HIGH if open else self.gpio_manager.LOW
            success = self.gpio_manager.set_output(inlet_pin, state)
            if success:
                return {"status": "ok", "chamber": chamber, "open": open}
            else:
                return {"status": "error", "error": f"Failed to set inlet valve for chamber {chamber}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def set_outlet_valve(self, chamber: int, open: bool) -> Dict[str, Any]:
        """Set outlet valve for a chamber"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        
        try:
            import gpio_manager
            outlet_pin = gpio_manager.GPIO_PINS["OUTLET_PINS"][chamber]
            state = self.gpio_manager.HIGH if open else self.gpio_manager.LOW
            success = self.gpio_manager.set_output(outlet_pin, state)
            if success:
                return {"status": "ok", "chamber": chamber, "open": open}
            else:
                return {"status": "error", "error": f"Failed to set outlet valve for chamber {chamber}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def set_empty_tank_valve(self, chamber: int, open: bool) -> Dict[str, Any]:
        """Set empty tank valve for a chamber"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        
        try:
            success = self.gpio_manager.empty_chamber(chamber, open)
            if success:
                return {"status": "ok", "chamber": chamber, "open": open}
            else:
                return {"status": "error", "error": f"Failed to set empty tank valve for chamber {chamber}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def set_status_led(self, led_type: str, state: bool) -> Dict[str, Any]:
        """Set status LED state"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized"}
        
        try:
            success = self.gpio_manager.set_status_led(led_type, state)
            if success:
                return {"status": "ok", "led_type": led_type, "state": state}
            else:
                return {"status": "error", "error": f"Failed to set {led_type} LED"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def get_status(self) -> Dict[str, Any]:
        """Get GPIO manager status"""
        if not self.is_initialized or not self.gpio_manager:
            return {"status": "error", "error": "GPIO not initialized", "available": False, "initialized": False}
        
        try:
            return {
                "status": "ok",
                "available": True,
                "initialized": self.gpio_manager.initialized
            }
        except Exception as e:
            return {"status": "error", "error": str(e), "available": False, "initialized": False}
    
    def cleanup(self):
        """Clean up GPIO resources"""
        if self.gpio_manager:
            try:
                self.gpio_manager.cleanup()
            except:
                pass
        self.is_initialized = False


def main():
    if len(sys.argv) < 2:
        print("Usage: gpio_bridge.py <gpio_config_path>", file=sys.stderr)
        sys.exit(1)
    
    gpio_config_path = sys.argv[1]
    
    # Resolve path relative to script directory or absolute path
    if not os.path.isabs(gpio_config_path):
        # Try relative to script directory first
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        possible_paths = [
            os.path.join(script_dir, gpio_config_path),
            os.path.join(project_root, gpio_config_path),
            os.path.join(project_root, 'dist', gpio_config_path),
        ]
        for path in possible_paths:
            if os.path.exists(path):
                gpio_config_path = path
                break
        else:
            print(f"ERROR: GPIO config file not found: {gpio_config_path}", file=sys.stderr)
            sys.exit(1)
    
    bridge = GPIOBridge(gpio_config_path)
    
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
                elif command == "set_pin":
                    result = bridge.set_pin(params.get("pin"), params.get("value"))
                elif command == "read_pin":
                    result = bridge.read_pin(params.get("pin"))
                elif command == "set_inlet_valve":
                    result = bridge.set_inlet_valve(params.get("chamber"), params.get("open"))
                elif command == "set_outlet_valve":
                    result = bridge.set_outlet_valve(params.get("chamber"), params.get("open"))
                elif command == "set_empty_tank_valve":
                    result = bridge.set_empty_tank_valve(params.get("chamber"), params.get("open"))
                elif command == "set_status_led":
                    result = bridge.set_status_led(params.get("led_type"), params.get("state"))
                elif command == "get_status":
                    result = bridge.get_status()
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

