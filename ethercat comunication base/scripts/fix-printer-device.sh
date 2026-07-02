#!/bin/bash
# Fix broken printer device nodes and symlinks
# This script fixes common issues with USB printer devices

set -e

echo "============================================================"
echo "Fixing Printer Device Nodes and Symlinks"
echo "============================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  This script must be run with sudo"
    echo "   Usage: sudo bash scripts/fix-printer-device.sh"
    exit 1
fi

# Check if usblp module is loaded
if ! lsmod | grep -q "^usblp"; then
    echo "Loading usblp kernel module..."
    modprobe usblp || {
        echo "❌ Failed to load usblp module"
        exit 1
    }
    echo "✅ usblp module loaded"
    sleep 1  # Give udev time to create device nodes
fi

# Find printer devices from /sys/class/usbmisc
echo "Scanning for printer devices..."
PRINTER_FIXED=false

for sys_path in /sys/class/usbmisc/lp*; do
    if [ ! -L "$sys_path" ]; then
        continue
    fi
    
    device_name=$(basename "$sys_path")
    device_num=$(echo "$device_name" | sed 's/lp//')
    
    # Read major:minor from sysfs
    if [ ! -f "$sys_path/dev" ]; then
        continue
    fi
    
    IFS=':' read major minor < "$sys_path/dev"
    major=$((0x$major))
    minor=$((0x$minor))
    
    echo ""
    echo "Found printer device: $device_name (major: $major, minor: $minor)"
    
    # Device paths to check/fix
    # Udev can create the device at /dev/usb/lp* directly (based on DEVNAME in uevent)
    dev_usb_lp="/dev/usb/$device_name"  # Primary location (created by udev based on DEVNAME)
    dev_lp="/dev/$device_name"          # Alternative location (kernel default)
    dev_usblp="/dev/usblp$device_num"   # Alternative naming
    
    # Ensure /dev/usb directory exists
    mkdir -p /dev/usb
    chmod 755 /dev/usb
    
    # Remove any broken symlinks first
    if [ -L "$dev_usb_lp" ] && [ ! -e "$dev_usb_lp" ]; then
        echo "  Removing broken symlink: $dev_usb_lp"
        rm -f "$dev_usb_lp"
    fi
    
    # Trigger udev to create the device node properly
    # Udev will create it based on the DEVNAME from uevent (which is usb/lp0)
    if [ ! -c "$dev_usb_lp" ]; then
        echo "  Triggering udev to create device node: $dev_usb_lp"
        udevadm trigger --subsystem-match=usbmisc --action=add
        sleep 1
        
        # Also try forcing a change event on the device
        if [ -f "$sys_path/uevent" ]; then
            echo "add" > "$sys_path/uevent" 2>/dev/null || true
            sleep 0.5
        fi
    fi
    
    # Set permissions on /dev/usb/lp* (primary device location created by udev)
    if [ -c "$dev_usb_lp" ]; then
        echo "  Setting permissions on $dev_usb_lp (0666)"
        chmod 0666 "$dev_usb_lp" || true
        chgrp lp "$dev_usb_lp" 2>/dev/null || true
        echo "  ✅ Device $dev_usb_lp is valid and accessible"
        PRINTER_FIXED=true
    else
        echo "  ⚠️  Device $dev_usb_lp does not exist as character device"
        # Fallback: check if /dev/lp* exists (older kernel behavior)
        if [ -c "$dev_lp" ]; then
            echo "  Found device at $dev_lp (fallback location)"
            chmod 0666 "$dev_lp" || true
            chgrp lp "$dev_lp" 2>/dev/null || true
            # Create symlink to expected location
            if [ ! -e "$dev_usb_lp" ]; then
                echo "  Creating symlink: $dev_usb_lp -> $dev_lp"
                ln -sf "$dev_lp" "$dev_usb_lp"
            fi
            PRINTER_FIXED=true
        else
            echo "  ⚠️  No device node found - may need to reconnect printer or reload usblp module"
            echo "  Try: sudo modprobe -r usblp && sudo modprobe usblp"
        fi
    fi
    
    # Also check /dev/usblp* (alternative naming)
    if [ -e "$dev_usblp" ] && [ -c "$dev_usblp" ]; then
        echo "  ✅ Device $dev_usblp exists and is valid"
        chmod 0666 "$dev_usblp" || true
        chgrp lp "$dev_usblp" 2>/dev/null || true
        PRINTER_FIXED=true
    fi
done

echo ""
if [ "$PRINTER_FIXED" = "true" ]; then
    echo "✅ Printer device nodes and symlinks fixed"
    echo ""
    echo "Current printer devices:"
    ls -la /dev/lp* /dev/usb/lp* /dev/usblp* 2>/dev/null || true
else
    echo "⚠️  No printer devices found in /sys/class/usbmisc"
    echo "   Make sure a USB printer is connected and usblp module is loaded"
fi

echo ""
echo "============================================================"

