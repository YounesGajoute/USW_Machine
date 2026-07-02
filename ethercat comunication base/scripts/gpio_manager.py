#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Enhanced GPIO Manager for Raspberry Pi Compute Module 5 (CM5104032).

This module provides a robust GPIOManager class for setting up and controlling
GPIO pins on the Raspberry Pi CM5, with advanced features including:
- Thread-safe background monitoring
- Efficient UI update scheduling
- Smart refresh logic
- Memory-safe architecture using weak references
- Well-defined lifecycle methods
- Lazy loading of components
"""

import logging
import threading
import time
import queue
import weakref
from typing import Dict, List, Set, Optional, Union, Callable, Any, Tuple
from functools import wraps

# Try to import GPIO libraries with graceful fallback
try:
    import RPi.GPIO as GPIO
    gpio_library = "RPi.GPIO"
    GPIO_AVAILABLE = True
except ImportError:
    try:
        import lgpio
        gpio_library = "lgpio"
        GPIO_AVAILABLE = True
    except ImportError:
        gpio_library = "none"
        GPIO_AVAILABLE = False

# Import pin definitions from constants
try:
    from multi_chamber_test.config.constants import GPIO_PINS
except ImportError:
    # Default pin mappings if constants cannot be imported
    # These defaults match config/gpio.config.json (single chamber configuration)
    # The gpio_bridge.py will override these by injecting GPIO_PINS from the config file
    # Full 3-chamber pin arrays: [24, 6, 13] for inlets, [27, 22, 17] for outlets, [27, 17, 22] for empty tanks
    # Default uses first pin for single chamber (chamber_count=1)
    GPIO_PINS = {
        "INLET_PINS": [24],  # Single chamber default: GPIO 24 (from [24, 6, 13])
        "OUTLET_PINS": [27],  # Single chamber default: GPIO 27 (from [27, 22, 17])
        "EMPTY_TANK_PINS": [27],  # Single chamber default: GPIO 27 (from [27, 17, 22])
        "START_BTN": 16,  # GPIO 16 - Start test button
        "STOP_BTN": 25,  # GPIO 25 - Stop test button
        "STATUS_LED_GREEN": 4,  # GPIO 4 - Green status LED
        "STATUS_LED_RED": 23,  # GPIO 23 - Red status LED
        "STATUS_LED_YELLOW": 18,  # GPIO 18 - Yellow status LED
    }

# Thread synchronization decorator
def synchronized(lock_name):
    """Decorator for thread-safe methods using the specified lock attribute."""
    def decorator(method):
        @wraps(method)
        def wrapper(self, *args, **kwargs):
            lock = getattr(self, lock_name)
            with lock:
                return method(self, *args, **kwargs)
        return wrapper
    return decorator


class GPIOManager:
    """
    Enhanced manager for GPIO pins on Raspberry Pi CM5.
    
    This class provides thread-safe methods to initialize GPIO pins,
    control outputs, read inputs, handle events, and safely clean up
    resources when the application exits. It includes background monitoring
    and efficient UI update scheduling.
    """
    
    def __init__(self):
        """Initialize the GPIO Manager with advanced architecture."""
        # Core attributes
        self.logger = logging.getLogger('GPIOManager')
        self._setup_logger()
        self.initialized = False
        self.registered_pins = set()
        self._callbacks = {}
        
        # Thread synchronization
        self._gpio_lock = threading.RLock()  # Reentrant lock for GPIO operations
        self._update_lock = threading.Lock()  # Lock for UI update queue
        
        # Update queue system
        self._update_queue = queue.Queue()
        self._update_handlers = weakref.WeakSet()  # Memory-safe reference to UI handlers
        self._last_update_time = 0
        self._update_interval = 0.05  # 50ms coalescing window for updates
        
        # Monitoring system
        self._monitoring_active = False
        self._monitoring_thread = None
        self._monitoring_pins = set()  # Pins being actively monitored
        self._pin_states = {}  # Current state of each monitored pin
        self._pin_change_callbacks = {}  # Callbacks for pin state changes
        
        # Lifecycle flags
        self._initialized_components = set()
        self._is_selected = False  # Whether this manager is currently active
        
        # For lgpio specific handling
        self.handle = None  # lgpio chip handle, populated during initialization
        
        # Provide GPIO constants from the selected library
        self._setup_constants()
    
    def _setup_logger(self):
        """Configure logging for the GPIO manager."""
        handler = logging.StreamHandler()
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        
        if not self.logger.handlers:
            self.logger.addHandler(handler)
        
        self.logger.setLevel(logging.INFO)
    
    def _setup_constants(self):
        """Set up GPIO constants based on the available library."""
        if gpio_library == "RPi.GPIO":
            self.BCM = GPIO.BCM
            self.OUT = GPIO.OUT
            self.IN = GPIO.IN
            self.HIGH = GPIO.HIGH
            self.LOW = GPIO.LOW
            self.PUD_UP = GPIO.PUD_UP
            self.PUD_DOWN = GPIO.PUD_DOWN
            self.RISING = GPIO.RISING
            self.FALLING = GPIO.FALLING
            self.BOTH = GPIO.BOTH
        elif gpio_library == "lgpio":
            # Define equivalents for lgpio
            self.BCM = "BCM"  # Not used in lgpio, but kept for API compatibility
            self.OUT = 1
            self.IN = 0
            self.HIGH = 1
            self.LOW = 0
            self.PUD_UP = lgpio.SET_PULL_UP
            self.PUD_DOWN = lgpio.SET_PULL_DOWN
            self.RISING = lgpio.RISING_EDGE
            self.FALLING = lgpio.FALLING_EDGE
            self.BOTH = lgpio.EITHER_EDGE
        else:
            # Mock values for testing without GPIO
            self.BCM = "BCM"
            self.OUT = 1
            self.IN = 0
            self.HIGH = 1
            self.LOW = 0
            self.PUD_UP = 22
            self.PUD_DOWN = 21
            self.RISING = 31
            self.FALLING = 32
            self.BOTH = 33
    
    @synchronized("_gpio_lock")
    def initialize(self) -> bool:
        """
        Initialize GPIO with appropriate library and set up pins.
        
        This method selects the appropriate GPIO library, initializes the GPIO system,
        and sets up default pin states. It only initializes components that are needed,
        following the lazy loading principle.
        
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        if self.initialized:
            self.logger.warning("GPIO already initialized. Skipping...")
            return True
        
        if not GPIO_AVAILABLE:
            self.logger.warning("No GPIO library available. Running in simulation mode.")
            self.initialized = True
            return True
        
        try:
            # Initialize based on available library
            if gpio_library == "RPi.GPIO":
                # Disable GPIO warnings
                GPIO.setwarnings(False)
                
                # Set GPIO mode to BCM
                GPIO.setmode(GPIO.BCM)
                
                self.logger.info("Initialized RPi.GPIO in BCM mode")
                
            elif gpio_library == "lgpio":
                # Initialize lgpio
                self.handle = lgpio.gpiochip_open(0)
                if self.handle < 0:
                    self.logger.error(f"Failed to open gpiochip0: {self.handle}")
                    return False
                
                self.logger.info(f"Initialized lgpio with handle {self.handle}")
            
            # Mark as initialized but don't set up pins yet (lazy loading)
            self.initialized = True
            return True
            
        except Exception as e:
            self.logger.error(f"Error initializing GPIO: {e}")
            self.cleanup()
            return False
    
    def _lazy_initialize_component(self, component: str) -> bool:
        """
        Lazily initialize a specific GPIO component group.
        
        Args:
            component: Component group to initialize (e.g., 'inlets', 'controls')
            
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        if component in self._initialized_components:
            return True
        
        if not self.initialized:
            if not self.initialize():
                return False
        
        try:
            if component == 'inlets':
                for i in range(3):
                    inlet_pin = GPIO_PINS["INLET_PINS"][i]
                    self.setup_pin(inlet_pin, self.OUT, initial=self.LOW)
            
            elif component == 'outlets':
                for i in range(3):
                    outlet_pin = GPIO_PINS["OUTLET_PINS"][i]
                    self.setup_pin(outlet_pin, self.OUT, initial=self.LOW)
            
            elif component == 'empty_tanks':
                for i in range(3):
                    empty_tank_pin = GPIO_PINS["EMPTY_TANK_PINS"][i]
                    self.setup_pin(empty_tank_pin, self.OUT, initial=self.LOW)
            
            elif component == 'controls':
                if "START_BTN" in GPIO_PINS:
                    self.setup_pin(GPIO_PINS["START_BTN"], self.IN, pull_up_down=self.PUD_UP)
                
                if "STOP_BTN" in GPIO_PINS:
                    self.setup_pin(GPIO_PINS["STOP_BTN"], self.IN, pull_up_down=self.PUD_UP)
            
            elif component == 'leds':
                for led in ["STATUS_LED_GREEN", "STATUS_LED_RED", "STATUS_LED_YELLOW"]:
                    if led in GPIO_PINS and GPIO_PINS[led] >= 0:  # Skip if pin is -1 (not configured)
                        self.setup_pin(GPIO_PINS[led], self.OUT, initial=self.LOW)
            
            # Mark component as initialized
            self._initialized_components.add(component)
            return True
            
        except Exception as e:
            self.logger.error(f"Error initializing {component}: {e}")
            return False
    
    @synchronized("_gpio_lock")
    def setup_pin(self, pin: int, mode: int, initial: Optional[int] = None,
                 pull_up_down: Optional[int] = None) -> bool:
        """
        Set up a GPIO pin with specified mode and initial state.
        
        This method is thread-safe and works with either RPi.GPIO or lgpio.
        
        Args:
            pin: GPIO pin number (BCM numbering)
            mode: Pin mode (self.IN or self.OUT)
            initial: Initial state for output pins (self.HIGH or self.LOW)
            pull_up_down: Pull-up/down resistor configuration for input pins
            
        Returns:
            bool: True if pin setup was successful, False otherwise
        """
        if not self.initialized:
            self.logger.error("GPIO not initialized. Call initialize() first.")
            return False
        
        if not GPIO_AVAILABLE:
            # Simulation mode - record the pin setup but don't access hardware
            self.registered_pins.add(pin)
            return True
        
        try:
            if gpio_library == "RPi.GPIO":
                if mode == self.OUT and initial is not None:
                    GPIO.setup(pin, mode, initial=initial)
                elif mode == self.IN and pull_up_down is not None:
                    GPIO.setup(pin, mode, pull_up_down=pull_up_down)
                else:
                    GPIO.setup(pin, mode)
                
            elif gpio_library == "lgpio":
                if mode == self.OUT:
                    # Set up output pin
                    initial_value = initial if initial is not None else self.LOW
                    res = lgpio.gpio_claim_output(self.handle, pin, initial_value)
                    if res < 0:
                        self.logger.error(f"Failed to set pin {pin} as output: {res}")
                        return False
                else:
                    # Set up input pin
                    flags = 0
                    if pull_up_down == self.PUD_UP:
                        flags = lgpio.SET_PULL_UP
                    elif pull_up_down == self.PUD_DOWN:
                        flags = lgpio.SET_PULL_DOWN
                    
                    res = lgpio.gpio_claim_input(self.handle, pin, flags)
                    if res < 0:
                        self.logger.error(f"Failed to set pin {pin} as input: {res}")
                        return False
            
            self.registered_pins.add(pin)
            self.logger.debug(f"Set up GPIO pin {pin} as {'output' if mode == self.OUT else 'input'}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error setting up GPIO pin {pin}: {e}")
            return False
    
    @synchronized("_gpio_lock")
    def set_output(self, pin: int, state: int) -> bool:
        """
        Set the state of an output pin.
        
        This method is thread-safe and handles pin states efficiently.
        Changes to pin state trigger UI updates through the update queue.
        
        Args:
            pin: GPIO pin number (BCM numbering)
            state: Pin state (self.HIGH or self.LOW)
            
        Returns:
            bool: True if operation was successful, False otherwise
        """
        if not self.initialized:
            self.logger.error("GPIO not initialized. Call initialize() first.")
            return False
        
        if not GPIO_AVAILABLE:
            # Simulation mode - record the state change for monitoring
            self._pin_states[pin] = state
            self._queue_update('pin_state', {'pin': pin, 'state': state})
            return True
        
        try:
            # Verify pin is set up
            if pin not in self.registered_pins:
                # Attempt to auto-configure the pin as output
                if not self.setup_pin(pin, self.OUT):
                    return False
            
            # Set output state based on library
            if gpio_library == "RPi.GPIO":
                # Verify pin is set up as output
                pin_func = GPIO.gpio_function(pin)
                if pin_func != GPIO.OUT:
                    self.logger.error(f"GPIO pin {pin} is not configured as an output.")
                    return False
                
                GPIO.output(pin, state)
                
            elif gpio_library == "lgpio":
                res = lgpio.gpio_write(self.handle, pin, state)
                if res < 0:
                    self.logger.error(f"Failed to write to pin {pin}: {res}")
                    return False
            
            # Record state change for monitoring
            self._pin_states[pin] = state
            
            # Queue UI update
            self._queue_update('pin_state', {'pin': pin, 'state': state})
            
            return True
            
        except Exception as e:
            self.logger.error(f"Error setting GPIO pin {pin} to {state}: {e}")
            return False
    
    @synchronized("_gpio_lock")
    def read_input(self, pin: int) -> Optional[int]:
        """
        Read the state of an input pin.
        
        Thread-safe method that returns the current state of the specified pin.
        
        Args:
            pin: GPIO pin number (BCM numbering)
            
        Returns:
            int: Pin state (1 for self.HIGH, 0 for self.LOW) or None on error
        """
        if not self.initialized:
            self.logger.error("GPIO not initialized. Call initialize() first.")
            return None
        
        if not GPIO_AVAILABLE:
            # Simulation mode - return stored state or default LOW
            return self._pin_states.get(pin, self.LOW)
        
        try:
            # Verify pin is set up
            if pin not in self.registered_pins:
                # Attempt to auto-configure the pin as input
                if not self.setup_pin(pin, self.IN, pull_up_down=self.PUD_UP):
                    return None
            
            # Read input based on library
            if gpio_library == "RPi.GPIO":
                # Verify pin is set up as input
                pin_func = GPIO.gpio_function(pin)
                if pin_func != GPIO.IN:
                    self.logger.error(f"GPIO pin {pin} is not configured as an input.")
                    return None
                
                state = GPIO.input(pin)
                
            elif gpio_library == "lgpio":
                state = lgpio.gpio_read(self.handle, pin)
                if state < 0:
                    self.logger.error(f"Failed to read pin {pin}: {state}")
                    return None
            
            # Record state for monitoring
            self._pin_states[pin] = state
            
            return state
            
        except Exception as e:
            self.logger.error(f"Error reading GPIO pin {pin}: {e}")
            return None
    
    @synchronized("_gpio_lock")
    def add_event_detect(self, pin: int, edge: int, callback: Callable, bouncetime: int = 200) -> bool:
        """
        Add event detection to a GPIO pin.
        
        Thread-safe method to configure interrupts for pin state changes.
        
        Args:
            pin: GPIO pin number (BCM numbering)
            edge: Edge detection type (self.RISING, self.FALLING, or self.BOTH)
            callback: Function to call when event is detected
            bouncetime: Debounce time in milliseconds
            
        Returns:
            bool: True if event detection was added successfully, False otherwise
        """
        if not self.initialized:
            self.logger.error("GPIO not initialized. Call initialize() first.")
            return False
        
        if not GPIO_AVAILABLE:
            # Simulation mode - just store the callback
            self._callbacks[pin] = {
                'callback': callback,
                'edge': edge,
                'bouncetime': bouncetime
            }
            return True
        
        try:
            # Remove any existing event detection
            self.remove_event_detect(pin)
            
            # Verify pin is set up
            if pin not in self.registered_pins:
                # Attempt to auto-configure the pin as input
                if not self.setup_pin(pin, self.IN, pull_up_down=self.PUD_UP):
                    return False
            
            # Add event detection based on library
            if gpio_library == "RPi.GPIO":
                # Adapt the callback to queue UI updates
                def wrapped_callback(channel):
                    # Call the original callback
                    try:
                        callback(channel)
                    except Exception as e:
                        self.logger.error(f"Error in callback for pin {channel}: {e}")
                    
                    # Queue UI update
                    self._queue_update('pin_event', {'pin': channel})
                
                GPIO.add_event_detect(pin, edge, callback=wrapped_callback, bouncetime=bouncetime)
                
            elif gpio_library == "lgpio":
                # lgpio uses a different callback mechanism
                def lgpio_callback(chip, gpio, level, timestamp):
                    # Call the original callback with BCM pin number
                    try:
                        callback(pin)
                    except Exception as e:
                        self.logger.error(f"Error in callback for pin {pin}: {e}")
                    
                    # Queue UI update
                    self._queue_update('pin_event', {'pin': pin})
                
                # Calculate edge mode for lgpio
                edge_mode = lgpio.EITHER_EDGE
                if edge == self.RISING:
                    edge_mode = lgpio.RISING_EDGE
                elif edge == self.FALLING:
                    edge_mode = lgpio.FALLING_EDGE
                
                res = lgpio.gpio_claim_alert(self.handle, pin, edge_mode, lgpio_callback)
                if res < 0:
                    self.logger.error(f"Failed to set up event detection for pin {pin}: {res}")
                    return False
            
            # Store callback info
            self._callbacks[pin] = {
                'callback': callback,
                'edge': edge,
                'bouncetime': bouncetime
            }
            
            # Add to monitoring pins
            self._monitoring_pins.add(pin)
            
            self.logger.debug(f"Added event detection to GPIO pin {pin}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error adding event detection to GPIO pin {pin}: {e}")
            return False
    
    @synchronized("_gpio_lock")
    def remove_event_detect(self, pin: int) -> bool:
        """
        Remove event detection from a GPIO pin.
        
        Thread-safe method to clean up event detection settings.
        
        Args:
            pin: GPIO pin number (BCM numbering)
            
        Returns:
            bool: True if event detection was removed successfully, False otherwise
        """
        if not self.initialized:
            return True  # If GPIO is not initialized, no event detection to remove
        
        if not GPIO_AVAILABLE:
            # Simulation mode - just remove the callback
            if pin in self._callbacks:
                del self._callbacks[pin]
            return True
        
        try:
            # Remove event detection based on library
            if gpio_library == "RPi.GPIO":
                # Check if pin has event detection
                if pin in self._callbacks:
                    GPIO.remove_event_detect(pin)
                    del self._callbacks[pin]
                
            elif gpio_library == "lgpio":
                # lgpio handles event removal differently
                if pin in self._callbacks:
                    # Release the alert
                    lgpio.gpio_claim_input(self.handle, pin, 0)  # Reclaim as simple input
                    del self._callbacks[pin]
            
            # Remove from monitoring pins
            if pin in self._monitoring_pins:
                self._monitoring_pins.remove(pin)
            
            return True
            
        except Exception as e:
            self.logger.warning(f"Error removing event detection from GPIO pin {pin}: {e}")
            return False
    
    def _queue_update(self, update_type: str, data: Dict[str, Any]):
        """
        Queue a UI update with coalescing to avoid flooding the UI thread.
        
        Args:
            update_type: Type of update ('pin_state', 'pin_event', etc.)
            data: Update data dictionary
        """
        with self._update_lock:
            current_time = time.time()
            
            # Only queue update if enough time has passed since last update
            if current_time - self._last_update_time >= self._update_interval:
                self._update_queue.put((update_type, data))
                self._last_update_time = current_time
                
                # Process updates in the background
                threading.Thread(target=self._process_updates, daemon=True).start()
    
    def _process_updates(self):
        """Process queued updates and notify handlers."""
        # Batch updates together within a time window
        updates = []
        try:
            # Get the first update
            update = self._update_queue.get_nowait()
            updates.append(update)
            
            # Get any additional updates in the queue
            try:
                while True:
                    update = self._update_queue.get_nowait()
                    updates.append(update)
            except queue.Empty:
                pass
            
        except queue.Empty:
            return
        
        # Notify all registered update handlers
        for handler in self._update_handlers:
            try:
                handler(updates)
            except Exception as e:
                self.logger.error(f"Error in update handler: {e}")
    
    def register_update_handler(self, handler: Callable[[List[Tuple[str, Dict[str, Any]]]], None]):
        """
        Register a handler to receive UI updates.
        
        Args:
            handler: Callback function accepting a list of (update_type, data) tuples
        """
        self._update_handlers.add(handler)
    
    def unregister_update_handler(self, handler: Callable):
        """
        Unregister an update handler.
        
        Args:
            handler: Previously registered handler function
        """
        if handler in self._update_handlers:
            self._update_handlers.remove(handler)
    
    def start_monitoring(self, pins: Optional[List[int]] = None):
        """
        Start background monitoring of specified pins or all registered pins.
        
        Args:
            pins: Optional list of pins to monitor, or None for all pins
        """
        if self._monitoring_active:
            return
        
        self._monitoring_active = True
        
        # Determine which pins to monitor
        if pins is not None:
            self._monitoring_pins = set(pins)
        else:
            self._monitoring_pins = self.registered_pins.copy()
        
        # Start monitoring thread
        self._monitoring_thread = threading.Thread(
            target=self._monitor_pins,
            daemon=True
        )
        self._monitoring_thread.start()
        
        self.logger.info(f"Started monitoring {len(self._monitoring_pins)} pins")
    
    def _monitor_pins(self):
        """Background thread function for pin state monitoring."""
        while self._monitoring_active:
            try:
                # Monitor each pin in the monitoring set
                for pin in self._monitoring_pins:
                    # Skip pins with event detection (they're already being monitored)
                    if pin in self._callbacks:
                        continue
                    
                    # Read current state
                    current_state = self.read_input(pin)
                    
                    # Check if state changed
                    if pin in self._pin_states and self._pin_states[pin] != current_state:
                        # State changed, trigger any registered callbacks
                        if pin in self._pin_change_callbacks:
                            try:
                                self._pin_change_callbacks[pin](pin, current_state)
                            except Exception as e:
                                self.logger.error(f"Error in pin change callback for pin {pin}: {e}")
                        
                        # Queue UI update
                        self._queue_update('pin_change', {'pin': pin, 'state': current_state})
                    
                    # Update pin state
                    if current_state is not None:
                        self._pin_states[pin] = current_state
            
            except Exception as e:
                self.logger.error(f"Error in pin monitoring thread: {e}")
            
            # Sleep to avoid high CPU usage
            time.sleep(0.05)  # 50ms polling interval
    
    def stop_monitoring(self):
        """Stop background pin monitoring."""
        self._monitoring_active = False
        
        if self._monitoring_thread and self._monitoring_thread.is_alive():
            self._monitoring_thread.join(timeout=1.0)
            self._monitoring_thread = None
        
        self.logger.info("Stopped pin monitoring")
    
    def register_pin_change_callback(self, pin: int, callback: Callable[[int, int], None]):
        """
        Register a callback for pin state changes during monitoring.
        
        Args:
            pin: GPIO pin number
            callback: Function to call when pin state changes (pin, state)
        """
        self._pin_change_callbacks[pin] = callback
        
        # Add pin to monitoring set if not already there
        self._monitoring_pins.add(pin)
        
        # Make sure monitoring is started
        if not self._monitoring_active:
            self.start_monitoring()
    
    def unregister_pin_change_callback(self, pin: int):
        """
        Unregister a pin change callback.
        
        Args:
            pin: GPIO pin number
        """
        if pin in self._pin_change_callbacks:
            del self._pin_change_callbacks[pin]
    
    def set_drive_strength(self, pin: int, strength: int) -> bool:
        """
        Set drive strength for CM5 pin.
        
        Special feature for CM5: set the drive strength for outputs.
        
        Args:
            pin: GPIO pin number
            strength: Drive strength (2-16 mA)
            
        Returns:
            bool: True if operation was successful, False otherwise
        """
        if not self.initialized or not GPIO_AVAILABLE:
            return False
        
        if gpio_library != "lgpio":
            self.logger.warning("Drive strength control only available with lgpio")
            return False
        
        try:
            # CM5 supports configurable drive strength
            valid_strengths = [2, 4, 6, 8, 10, 12, 14, 16]
            if strength not in valid_strengths:
                self.logger.error(f"Invalid drive strength: {strength} mA. Must be one of {valid_strengths}")
                return False
            
            # Convert mA to lgpio drive setting (0-7)
            drive_index = valid_strengths.index(strength)
            
            res = lgpio.tx_set_drive(self.handle, pin, drive_index)
            if res < 0:
                self.logger.error(f"Failed to set drive strength for pin {pin}: {res}")
                return False
            
            self.logger.debug(f"Set drive strength for pin {pin} to {strength} mA")
            return True
            
        except Exception as e:
            self.logger.error(f"Error setting drive strength for pin {pin}: {e}")
            return False
    
    def set_chamber_valves(self, chamber_index: int, inlet_state: bool, outlet_state: bool) -> bool:
        """
        Set the state of inlet and outlet valves for a chamber with safety checks.
        
        This higher-level method ensures proper valve sequencing and safety.
        
        Args:
            chamber_index: Index of the chamber (0-2)
            inlet_state: State of inlet valve (True for open, False for closed)
            outlet_state: State of outlet valve (True for open, False for closed)
            
        Returns:
            bool: True if operations were successful, False otherwise
        """
        if not 0 <= chamber_index <= 2:
            self.logger.error(f"Invalid chamber index: {chamber_index}. Must be 0-2.")
            return False
        
        # Ensure valve components are initialized
        if 'inlets' not in self._initialized_components:
            self._lazy_initialize_component('inlets')
        
        if 'outlets' not in self._initialized_components:
            self._lazy_initialize_component('outlets')
        
        try:
            # Get pin numbers for this chamber
            inlet_pin = GPIO_PINS["INLET_PINS"][chamber_index]
            outlet_pin = GPIO_PINS["OUTLET_PINS"][chamber_index]
            
            # Safety: If both valves are being opened, ensure outlet is closed first
            if inlet_state and outlet_state:
                self.logger.warning("Cannot open both inlet and outlet valves simultaneously. Prioritizing inlet.")
                outlet_state = False
            
            # Apply states with appropriate safety delays
            if inlet_state:
                # Close outlet first if opening inlet
                self.set_output(outlet_pin, self.LOW)
                time.sleep(0.05)  # Small delay to ensure outlet closes first
            
            # Set valves to requested states
            inlet_success = self.set_output(inlet_pin, self.HIGH if inlet_state else self.LOW)
            outlet_success = self.set_output(outlet_pin, self.HIGH if outlet_state else self.LOW)
            
            # Queue a chamber status update
            self._queue_update('chamber_state', {
                'chamber': chamber_index,
                'inlet': inlet_state,
                'outlet': outlet_state
            })
            
            return inlet_success and outlet_success
            
        except Exception as e:
            self.logger.error(f"Error setting valves for chamber {chamber_index}: {e}")
            # Safety: ensure valves are closed on error
            try:
                self.set_output(GPIO_PINS["INLET_PINS"][chamber_index], self.LOW)
                self.set_output(GPIO_PINS["OUTLET_PINS"][chamber_index], self.LOW)
            except:
                pass
            return False
    
    def empty_chamber(self, chamber_index: int, state: bool) -> bool:
        """
        Control the empty tank valve for a chamber.
        
        Args:
            chamber_index: Index of the chamber (0-2)
            state: State of the empty valve (True for open, False for closed)
            
        Returns:
            bool: True if operation was successful, False otherwise
        """
        if not 0 <= chamber_index <= 2:
            self.logger.error(f"Invalid chamber index: {chamber_index}. Must be 0-2.")
            return False
        
        # Ensure empty tank components are initialized
        if 'empty_tanks' not in self._initialized_components:
            self._lazy_initialize_component('empty_tanks')
        
        try:
            empty_pin = GPIO_PINS["EMPTY_TANK_PINS"][chamber_index]
            result = self.set_output(empty_pin, self.HIGH if state else self.LOW)
            
            # Queue chamber status update
            self._queue_update('chamber_empty', {
                'chamber': chamber_index,
                'empty_state': state
            })
            
            return result
            
        except Exception as e:
            self.logger.error(f"Error controlling empty valve for chamber {chamber_index}: {e}")
            return False
    
    def set_status_led(self, led_type: str, state: bool) -> bool:
        """
        Set the state of a status LED.
        
        Args:
            led_type: Type of LED ("GREEN", "RED", or "YELLOW")
            state: LED state (True for on, False for off)
            
        Returns:
            bool: True if operation was successful, False otherwise
        """
        # Ensure LED components are initialized
        if 'leds' not in self._initialized_components:
            self._lazy_initialize_component('leds')
        
        led_key = f"STATUS_LED_{led_type.upper()}"
        if led_key not in GPIO_PINS:
            self.logger.error(f"Unknown status LED type: {led_type}")
            return False
        
        try:
            led_pin = GPIO_PINS[led_key]
            result = self.set_output(led_pin, self.HIGH if state else self.LOW)
            
            # Queue LED status update
            self._queue_update('led_state', {
                'led_type': led_type,
                'state': state
            })
            
            return result
            
        except Exception as e:
            self.logger.error(f"Error setting {led_type} LED: {e}")
            return False
    
    def all_off(self):
        """
        Turn off all output pins.
        
        This is a safety method to ensure all valves and LEDs are turned off.
        """
        if not self.initialized:
            return
        
        success = True
        for pin in self.registered_pins:
            try:
                # Determine if pin is an output
                is_output = False
                
                if gpio_library == "RPi.GPIO" and GPIO_AVAILABLE:
                    try:
                        pin_func = GPIO.gpio_function(pin)
                        is_output = (pin_func == GPIO.OUT)
                    except:
                        # If we can't determine, assume it might be an output
                        is_output = True
                else:
                    # For lgpio or simulation, check known output pins
                    output_pins = set()
                    for key in ["INLET_PINS", "OUTLET_PINS", "EMPTY_TANK_PINS"]:
                        if key in GPIO_PINS:
                            output_pins.update(GPIO_PINS[key])
                    
                    for led in ["STATUS_LED_GREEN", "STATUS_LED_RED", "STATUS_LED_YELLOW"]:
                        if led in GPIO_PINS and GPIO_PINS[led] >= 0:  # Skip if pin is -1 (not configured)
                            output_pins.add(GPIO_PINS[led])
                    
                    is_output = pin in output_pins
                
                # Turn off if it's an output
                if is_output:
                    if not self.set_output(pin, self.LOW):
                        success = False
                
            except Exception as e:
                self.logger.warning(f"Error turning off pin {pin}: {e}")
                success = False
        
        return success
    
    @synchronized("_gpio_lock")
    def cleanup(self):
        """
        Clean up all GPIO resources.
        
        This method safely releases all GPIO pins, stops monitoring,
        and resets state.
        """
        # Stop background monitoring
        if self._monitoring_active:
            self.stop_monitoring()
        
        # Process any remaining updates
        self._process_updates()
        
        try:
            # First ensure all output pins are in a safe state
            self.all_off()
            
            # Clean up based on library
            if gpio_library == "RPi.GPIO" and GPIO_AVAILABLE:
                GPIO.cleanup()
            elif gpio_library == "lgpio" and GPIO_AVAILABLE:
                # Clean up lgpio resources
                if self.handle is not None:
                    lgpio.gpiochip_close(self.handle)
                    self.handle = None
            
            # Reset state
            self.initialized = False
            self.registered_pins.clear()
            self._callbacks.clear()
            self._pin_states.clear()
            self._pin_change_callbacks.clear()
            self._monitoring_pins.clear()
            self._initialized_components.clear()
            
            self.logger.info("GPIO cleanup completed.")
            
        except Exception as e:
            self.logger.error(f"Error during GPIO cleanup: {e}")
    
    # Lifecycle methods for integration with UI framework
    def on_selected(self):
        """Called when this component becomes active."""
        self._is_selected = True
        # Start monitoring if registered pins exist
        if self.registered_pins and not self._monitoring_active:
            self.start_monitoring()
    
    def on_deselected(self):
        """Called when this component becomes inactive."""
        self._is_selected = False
        # Optionally stop monitoring to save resources
        if self._monitoring_active and not self._is_selected:
            self.stop_monitoring()
    
    def get_pin_state(self, pin: int) -> Optional[int]:
        """
        Get the current cached state of a pin without reading hardware.
        
        Args:
            pin: GPIO pin number
            
        Returns:
            Current pin state or None if unknown
        """
        return self._pin_states.get(pin)
    
    def get_chamber_states(self) -> List[Dict[str, bool]]:
        """
        Get the current state of all chambers.
        
        Returns:
            List of dictionaries with chamber state information
        """
        states = []
        for i in range(3):
            inlet_pin = GPIO_PINS["INLET_PINS"][i]
            outlet_pin = GPIO_PINS["OUTLET_PINS"][i]
            empty_pin = GPIO_PINS["EMPTY_TANK_PINS"][i]
            
            inlet_state = self._pin_states.get(inlet_pin, False)
            outlet_state = self._pin_states.get(outlet_pin, False)
            empty_state = self._pin_states.get(empty_pin, False)
            
            states.append({
                'inlet_open': bool(inlet_state),
                'outlet_open': bool(outlet_state),
                'empty_open': bool(empty_state)
            })
            
        return states
