#!/bin/bash

# Configuration
PRIVATE_KEY="SHqroU8jMMVOSuOXAkloY4Z3wMGhEJGyKXX9xgRnfFk="
ADDRESS="10.10.0.1/16"
PORT="51820"
INTERFACE="wg0"

echo "Creating WireGuard config for $INTERFACE..."

# Install WireGuard if missing (just in case)
if ! command -v wg &> /dev/null; then
    echo "Installing wireguard..."
    apt update && apt install wireguard -y
fi

# Enable IP Forwarding
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-wireguard.conf
sysctl -p /etc/sysctl.d/99-wireguard.conf

# Create Config File
cat > /etc/wireguard/$INTERFACE.conf <<EOF
[Interface]
PrivateKey = $PRIVATE_KEY
Address = $ADDRESS
ListenPort = $PORT
PostUp = iptables -A FORWARD -i $INTERFACE -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i $INTERFACE -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# Peers will be added automatically
EOF

chmod 600 /etc/wireguard/$INTERFACE.conf

echo "Starting WireGuard interface..."
systemctl enable wg-quick@$INTERFACE
systemctl start wg-quick@$INTERFACE

# Verify
echo "Done. Status:"
wg show
