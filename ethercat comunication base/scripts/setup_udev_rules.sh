#!/bin/bash
# Setup all udev rules for Air Leakage Test System
# Installs all udev rules files from services directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICES_DIR="$PROJECT_ROOT/services"

cd "$PROJECT_ROOT"

echo "============================================================"
echo "Air Leakage Test System - Udev Rules Setup"
echo "============================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  This script must be run with sudo"
    echo "   Usage: sudo bash scripts/setup_udev_rules.sh"
    exit 1
fi

# Get the current user (the user who ran sudo)
CURRENT_USER="${SUDO_USER:-$USER}"
if [ -z "$CURRENT_USER" ] || [ "$CURRENT_USER" = "root" ]; then
    # Try to get the primary user from the home directory
    if [ -d "/home/bot" ]; then
        CURRENT_USER="bot"
    else
        echo "⚠️  Could not determine current user. Please run as: sudo -u \$USER bash scripts/setup_udev_rules.sh"
        exit 1
    fi
fi

echo "Setting up udev rules for user: $CURRENT_USER"
echo ""

UDEV_RULES_DIR="/etc/udev/rules.d"
INSTALLED_COUNT=0
UPDATED_COUNT=0
NEED_RELOAD=false

# List of udev rules files to install (in order of priority)
# Lower numbered files are processed first
UDEV_RULES=(
    "10-set-time-service.rules"  # Note: This is actually a polkit rule, handled separately
    "99-arduino-uart.rules"
    "99-usb-printer-permissions.rules"
    "99-usb-storage-systemd.rules"
    "99-usb-air-leakage-test.rules"
    "99-framebuffer-permissions.rules"
)

# Note about 10-set-time-service.rules
echo "Note: 10-set-time-service.rules is a polkit rule (not udev), handling separately..."
echo ""

# Install all udev rules
echo "Installing udev rules..."
echo ""

for rule_file in "${UDEV_RULES[@]}"; do
    # Skip the polkit rule for now (handle separately)
    if [ "$rule_file" = "10-set-time-service.rules" ]; then
        continue
    fi
    
    source_file="$SERVICES_DIR/$rule_file"
    target_file="$UDEV_RULES_DIR/$rule_file"
    
    if [ ! -f "$source_file" ]; then
        echo "⚠️  Source file not found: $source_file (skipping)"
        continue
    fi
    
    if [ -f "$target_file" ]; then
        # Check if files differ (including comment-only differences)
        # We update even if only comments differ to keep installed files in sync with source
        if ! diff -q "$source_file" "$target_file" > /dev/null 2>&1; then
            cp "$source_file" "$target_file"
            chmod 644 "$target_file"
            echo "  ✓ Updated: $rule_file"
            UPDATED_COUNT=$((UPDATED_COUNT + 1))
            NEED_RELOAD=true
        else
            echo "  ✓ Already up to date: $rule_file"
        fi
    else
        cp "$source_file" "$target_file"
        chmod 644 "$target_file"
        echo "  ✓ Installed: $rule_file"
        INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
        NEED_RELOAD=true
    fi
done

# Handle polkit rule (10-set-time-service.rules)
POLKIT_RULE="10-set-time-service.rules"
POLKIT_RULES_DIR="/etc/polkit-1/rules.d"
source_polkit="$SERVICES_DIR/$POLKIT_RULE"
target_polkit="$POLKIT_RULES_DIR/$POLKIT_RULE"

if [ -f "$source_polkit" ]; then
    echo ""
    echo "Installing polkit rule..."
    if [ ! -d "$POLKIT_RULES_DIR" ]; then
        mkdir -p "$POLKIT_RULES_DIR"
        echo "  ✓ Created polkit rules directory"
    fi
    
    if [ -f "$target_polkit" ]; then
        # Check if files differ (including comment-only differences)
        # We update even if only comments differ to keep installed files in sync with source
        # Note: We may not be able to read the target file without sudo, but we can still update it
        if ! diff -q "$source_polkit" "$target_polkit" > /dev/null 2>&1; then
            cp "$source_polkit" "$target_polkit"
            chmod 644 "$target_polkit"
            echo "  ✓ Updated polkit rule: $POLKIT_RULE"
            UPDATED_COUNT=$((UPDATED_COUNT + 1))
            # Restart polkit to load the updated rule
            systemctl restart polkit.service 2>/dev/null || systemctl restart polkit 2>/dev/null || true
        else
            echo "  ✓ Polkit rule already up to date: $POLKIT_RULE"
        fi
    else
        cp "$source_polkit" "$target_polkit"
        chmod 644 "$target_polkit"
        echo "  ✓ Installed polkit rule: $POLKIT_RULE"
        INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
        # Restart polkit to load the new rule
        systemctl restart polkit.service 2>/dev/null || systemctl restart polkit 2>/dev/null || true
    fi
fi

echo ""

# Additional setup for printer permissions
echo "Setting up additional permissions..."

# Add user to lp group for printer access
if id -nG "$CURRENT_USER" 2>/dev/null | grep -qw "lp"; then
    echo "  ✓ User $CURRENT_USER is already in the 'lp' group"
else
    usermod -a -G lp "$CURRENT_USER" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "  ✓ User $CURRENT_USER added to 'lp' group"
        echo "    ⚠️  Note: User may need to log out and back in for group changes to take effect"
    else
        echo "  ⚠️  Could not add user to 'lp' group (may not be critical)"
    fi
fi

# Add user to dialout group for serial/Arduino access
if id -nG "$CURRENT_USER" 2>/dev/null | grep -qw "dialout"; then
    echo "  ✓ User $CURRENT_USER is already in the 'dialout' group"
else
    usermod -a -G dialout "$CURRENT_USER" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "  ✓ User $CURRENT_USER added to 'dialout' group"
    else
        echo "  ⚠️  Could not add user to 'dialout' group (may not be critical)"
    fi
fi

# Add user to video group for framebuffer access
if id -nG "$CURRENT_USER" 2>/dev/null | grep -qw "video"; then
    echo "  ✓ User $CURRENT_USER is already in the 'video' group"
else
    usermod -a -G video "$CURRENT_USER" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "  ✓ User $CURRENT_USER added to 'video' group"
    else
        echo "  ⚠️  Could not add user to 'video' group (may not be critical)"
    fi
fi

echo ""

# Fix permissions on existing devices (ensure both root and bot user can access)
echo "Fixing permissions on existing devices..."
echo "  (Ensuring both root and bot user have access)"

# Printer devices - 0666 allows root, bot, and all users
PRINTER_PATHS=("/dev/usb/lp0" "/dev/usb/lp1" "/dev/usb/lp2" "/dev/usblp0" "/dev/usblp1" "/dev/usblp2" "/dev/lp0" "/dev/lp1" "/dev/lp2")
for path in "${PRINTER_PATHS[@]}"; do
    if [ -c "$path" ]; then
        # Set permissions: 0666 = rw-rw-rw- (root, group, others all read/write)
        chmod 0666 "$path" 2>/dev/null
        # Ensure bot user can access (either via group or world permissions)
        chgrp lp "$path" 2>/dev/null || chgrp root "$path" 2>/dev/null || true
        echo "  ✓ Fixed permissions on $path (accessible by root and bot)"
    fi
done

# Framebuffer devices - 0666 allows root, bot, and all users
for path in /dev/fb[0-9]*; do
    if [ -c "$path" ]; then
        # Set permissions: 0666 = rw-rw-rw- (root, group, others all read/write)
        chmod 0666 "$path" 2>/dev/null
        # Ensure video group ownership (bot user is in video group)
        chgrp video "$path" 2>/dev/null || chgrp root "$path" 2>/dev/null || true
        echo "  ✓ Fixed permissions on $path (accessible by root and bot)"
    fi
done

# Arduino/serial devices - ensure bot user can access
# These use 0664 with dialout group, which bot is in
for path in /dev/ttyACM[0-9]* /dev/ttyUSB[0-9]*; do
    if [ -c "$path" ]; then
        # Check if it might be an Arduino (group should be dialout)
        current_group=$(stat -c '%G' "$path" 2>/dev/null || echo "")
        if [ "$current_group" != "dialout" ]; then
            chgrp dialout "$path" 2>/dev/null || true
        fi
        # Ensure permissions allow group read/write (root always has access)
        chmod 0664 "$path" 2>/dev/null || chmod 0666 "$path" 2>/dev/null || true
        echo "  ✓ Fixed permissions on $path (accessible by root and bot via dialout group)"
    fi
done

echo ""

# Reload udev rules if needed
if [ "$NEED_RELOAD" = "true" ]; then
    echo "Reloading udev rules..."
    udevadm control --reload-rules
    udevadm trigger --subsystem-match=usbmisc --subsystem-match=block --subsystem-match=tty --subsystem-match=graphics
    echo "  ✓ Udev rules reloaded"
else
    echo "Udev rules are up to date (no reload needed)"
fi

echo ""

# Summary
echo "============================================================"
echo "✅ Udev rules setup complete"
echo "============================================================"
echo ""
echo "Summary:"
echo "  - Installed: $INSTALLED_COUNT rule(s)"
echo "  - Updated: $UPDATED_COUNT rule(s)"
echo "  - User '$CURRENT_USER' is in required groups (lp, dialout, video)"
echo "  - Existing device permissions have been fixed"
echo ""
echo "Permission Summary:"
echo "  - Root user: Full access to all devices (always available)"
echo "  - Bot user: Access via group membership (lp, dialout, video) or 0666 permissions"
echo "  - Printer devices: 0666 (accessible by root and bot)"
echo "  - Framebuffer devices: 0666 (accessible by root and bot)"
echo "  - Arduino/serial devices: 0664 with dialout group (accessible by root and bot)"
echo ""
echo "Installed rules:"
for rule_file in "${UDEV_RULES[@]}"; do
    if [ "$rule_file" != "10-set-time-service.rules" ]; then
        if [ -f "$UDEV_RULES_DIR/$rule_file" ]; then
            echo "  ✓ $rule_file"
        fi
    fi
done
if [ -f "$target_polkit" ]; then
    echo "  ✓ $POLKIT_RULE (polkit)"
fi
echo ""
echo "Note: If devices are already connected, you may need to:"
echo "  1. Disconnect and reconnect the device, OR"
echo "  2. Log out and back in (for group membership to take effect)"
echo ""

