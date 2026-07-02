#!/bin/bash
# Setup printer permissions for USB printer devices
# This ensures the application can access /dev/usb/lp* devices

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "============================================================"
echo "Printer Permissions Setup"
echo "============================================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  This script must be run with sudo"
    echo "   Usage: sudo bash scripts/setup_printer_permissions.sh"
    exit 1
fi

# Get the current user (the user who ran sudo)
CURRENT_USER="${SUDO_USER:-$USER}"
if [ -z "$CURRENT_USER" ] || [ "$CURRENT_USER" = "root" ]; then
    # Try to get the primary user from the home directory
    if [ -d "/home/bot" ]; then
        CURRENT_USER="bot"
    else
        echo "⚠️  Could not determine current user. Please run as: sudo -u \$USER bash scripts/setup_printer_permissions.sh"
        exit 1
    fi
fi

echo "Setting up printer permissions for user: $CURRENT_USER"
echo ""

# Method 1: Add user to lp group (recommended for security)
echo "1. Adding user to 'lp' group..."
if id -nG "$CURRENT_USER" | grep -qw "lp"; then
    echo "   ✓ User $CURRENT_USER is already in the 'lp' group"
else
    usermod -a -G lp "$CURRENT_USER"
    if [ $? -eq 0 ]; then
        echo "   ✓ User $CURRENT_USER added to 'lp' group"
        echo "   ⚠️  Note: User may need to log out and back in for group changes to take effect"
    else
        echo "   ⚠️  Could not add user to 'lp' group (may not be critical)"
    fi
fi

echo ""

# Method 2: Ensure udev rules are installed
echo "2. Checking udev rules for printer permissions..."
UDEV_RULES_FILE="/etc/udev/rules.d/99-usb-printer-permissions.rules"
SOURCE_RULES_FILE="$PROJECT_ROOT/services/99-usb-printer-permissions.rules"

# Check if source rule file exists
if [ ! -f "$SOURCE_RULES_FILE" ]; then
    echo "   ⚠️  Source udev rule file not found: $SOURCE_RULES_FILE"
    echo "   Using inline rule instead..."
    # Create a printer-specific udev rule with 0666 permissions (more permissive)
    cat > /tmp/printer-permissions-rule.tmp << 'EOF'
# Udev rules for USB printer device permissions
# Ensures printer devices are accessible to all users (0666) or lp group
# This rule works alongside existing printer detection rules

# USB printer devices - set permissions to allow access
KERNEL=="lp[0-9]*", SUBSYSTEM=="usbmisc", ACTION=="add", \
  MODE="0666", \
  SYMLINK+="usb/%k"

KERNEL=="usblp[0-9]*", SUBSYSTEM=="usbmisc", ACTION=="add", \
  MODE="0666"

# Also handle /dev/usb/lp* symlinks - ensure parent directory exists
ACTION=="add", SUBSYSTEM=="usbmisc", KERNEL=="lp[0-9]*", \
  RUN+="/bin/mkdir -p /dev/usb", \
  RUN+="/bin/chmod 755 /dev/usb"
EOF
    SOURCE_RULES_FILE="/tmp/printer-permissions-rule.tmp"
fi

# Check if rule already exists and is correct
if [ -f "$UDEV_RULES_FILE" ]; then
    if diff -q "$UDEV_RULES_FILE" "$SOURCE_RULES_FILE" > /dev/null 2>&1; then
        echo "   ✓ Udev rule already exists and is up to date"
        [ "$SOURCE_RULES_FILE" = "/tmp/printer-permissions-rule.tmp" ] && rm -f /tmp/printer-permissions-rule.tmp
    else
        echo "   ⚠️  Udev rule exists but differs. Updating..."
        cp "$SOURCE_RULES_FILE" "$UDEV_RULES_FILE"
        chmod 644 "$UDEV_RULES_FILE"
        echo "   ✓ Udev rule updated"
        NEED_UDEV_RELOAD=true
        [ "$SOURCE_RULES_FILE" = "/tmp/printer-permissions-rule.tmp" ] && rm -f /tmp/printer-permissions-rule.tmp
    fi
else
    cp "$SOURCE_RULES_FILE" "$UDEV_RULES_FILE"
    chmod 644 "$UDEV_RULES_FILE"
    echo "   ✓ Udev rule installed to $UDEV_RULES_FILE"
    NEED_UDEV_RELOAD=true
    [ "$SOURCE_RULES_FILE" = "/tmp/printer-permissions-rule.tmp" ] && rm -f /tmp/printer-permissions-rule.tmp
fi

echo ""

# Reload udev rules if needed (must be done before fixing devices)
if [ "$NEED_UDEV_RELOAD" = "true" ]; then
    echo "3. Reloading udev rules..."
    udevadm control --reload-rules
    udevadm trigger --subsystem-match=usbmisc --action=add
    echo "   ✓ Udev rules reloaded"
    # Give udev time to create device nodes
    sleep 1
else
    echo "3. Udev rules are up to date (no reload needed)"
fi

echo ""

# Fix existing printer devices (if any) - must be done AFTER udev reload
echo "4. Fixing existing printer device nodes and symlinks..."
if [ -f "$PROJECT_ROOT/scripts/fix-printer-device.sh" ]; then
    bash "$PROJECT_ROOT/scripts/fix-printer-device.sh" || {
        echo "   ⚠️  Could not fix existing printer devices (may not be critical if no printer is connected)"
    }
else
    echo "   ⚠️  fix-printer-device.sh script not found, skipping device fix"
fi

echo ""

# Method 3: Fix permissions on existing printer devices (if any exist)
# Note: This is now redundant since fix-printer-device.sh handles permissions,
# but kept for backward compatibility and as a fallback
echo "5. Verifying permissions on existing printer devices..."
PRINTER_PATHS=("/dev/usb/lp0" "/dev/usb/lp1" "/dev/usb/lp2" "/dev/usblp0" "/dev/usblp1" "/dev/usblp2" "/dev/lp0" "/dev/lp1" "/dev/lp2")

for path in "${PRINTER_PATHS[@]}"; do
    if [ -c "$path" ]; then
        chmod 0666 "$path" 2>/dev/null
        if [ $? -eq 0 ]; then
            echo "   ✓ Fixed permissions on $path"
        else
            echo "   ⚠️  Could not fix permissions on $path (may require device reconnection)"
        fi
    fi
done

echo ""

echo "============================================================"
echo "✅ Printer permissions setup complete"
echo "============================================================"
echo ""
echo "Summary:"
echo "  - User '$CURRENT_USER' is in the 'lp' group"
echo "  - Udev rules installed to ensure printer devices are accessible"
echo "  - Existing printer device permissions have been fixed"
echo ""
echo "Note: If printer devices are already connected, you may need to:"
echo "  1. Disconnect and reconnect the printer, OR"
echo "  2. Log out and back in (for group membership to take effect)"
echo ""

