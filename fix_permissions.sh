#!/bin/bash

echo "EasyISP WireGuard Permission Fixer"
echo "=================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (try 'sudo ./fix_permissions.sh')"
  exit 1
fi

# Detect current user (if running via sudo)
ACTUAL_USER=$(logname 2>/dev/null || echo $SUDO_USER)
if [ -z "$ACTUAL_USER" ]; then
    ACTUAL_USER=$(whoami)
fi

echo "Detected user: $ACTUAL_USER"

# Path to wg
WG_PATH=$(which wg)
if [ -z "$WG_PATH" ]; then
    echo "Error: 'wg' command not found. Is WireGuard installed?"
    exit 1
fi
echo "WireGuard path: $WG_PATH"

# Create sudoers file for passwordless wg execution
SUDOERS_FILE="/etc/sudoers.d/easyisp-wg"

echo "Configuring sudoers for $ACTUAL_USER..."

# Add rule: User can run 'wg' without password
echo "$ACTUAL_USER ALL=(root) NOPASSWD: $WG_PATH" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"

# Make sure syntax is valid
visudo -c -f "$SUDOERS_FILE"
if [ $? -eq 0 ]; then
    echo "✅ Permissions updated successfully!"
    echo "The user '$ACTUAL_USER' can now run 'sudo wg' without a password."
else
    echo "❌ Error verifying sudoers file. Reverting..."
    rm "$SUDOERS_FILE"
    exit 1
fi

echo ""
echo "Current Interface Status:"
if ip link show wg0 >/dev/null 2>&1; then
    echo "✅ Interface 'wg0' exists."
else
    echo "⚠️ Interface 'wg0' NOT found!"
    echo "If your interface is named differently (e.g. wg-server), please update your .env file:"
    echo "WG_INTERFACE=your-interface-name"
fi

echo ""
echo "Restarting backend service..."
if pm2 list >/dev/null 2>&1; then
    pm2 restart easyisp-backend 2>/dev/null || echo "Could not restart PM2 service automatically."
else
    echo "PM2 not detected or accessible. You may need to restart your backend manually."
fi

echo "Done."
