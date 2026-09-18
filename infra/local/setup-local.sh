#!/bin/bash
set -euo pipefail

# ============================================
# Local Node Setup — WireGuard + Routing + Reset API
# Run as root on Mini PC (Ubuntu)
# ============================================

# ── EDIT THESE ──
VPS_PUBLIC_IP="YOUR_VPS_IP"
VPS_PUBLIC_KEY="YOUR_VPS_PUBLIC_KEY"
LOCAL_PRIVATE_KEY="YOUR_LOCAL_PRIVATE_KEY"
WG_PORT=51820
MODEM_COUNT=20

echo "=== [1/5] Install packages ==="
apt-get update && apt-get install -y \
  wireguard wireguard-tools \
  usb-modeswitch modemmanager \
  iptables-persistent \
  python3 python3-pip python3-flask \
  curl jq htop

echo "=== [2/5] WireGuard config ==="
mkdir -p /etc/wireguard

cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.66.66.2/24
PrivateKey = ${LOCAL_PRIVATE_KEY}

# Routing: only tunnel traffic destined for the WG subnet
# Do NOT route all traffic through VPS (we need local LTE egress)

[Peer]
PublicKey = ${VPS_PUBLIC_KEY}
Endpoint = ${VPS_PUBLIC_IP}:${WG_PORT}
AllowedIPs = 10.66.66.0/24
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

echo "=== [3/5] Policy-Based Routing (per modem) ==="

# Create routing tables
for i in $(seq 1 ${MODEM_COUNT}); do
  TABLE_ID=$((100 + $i))
  TABLE_NAME="modem${i}"
  grep -q "${TABLE_ID} ${TABLE_NAME}" /etc/iproute2/rt_tables 2>/dev/null || \
    echo "${TABLE_ID} ${TABLE_NAME}" >> /etc/iproute2/rt_tables
done

# Create routing setup script
cat > /usr/local/bin/setup-modem-routes.sh << 'SCRIPT'
#!/bin/bash
# Called after modems come online
# Usage: setup-modem-routes.sh <modem_index> <interface> <gateway>
# Example: setup-modem-routes.sh 1 wwan0 10.0.0.1

IDX=$1
IFACE=$2
GW=$3
TABLE_ID=$((100 + IDX))
MARK=$IDX

# Flush old routes for this table
ip route flush table ${TABLE_ID} 2>/dev/null || true

# Add default route through this modem's interface
ip route add default via ${GW} dev ${IFACE} table ${TABLE_ID}

# Mark-based routing: packets marked with $IDX use modem$IDX table
ip rule del fwmark ${MARK} 2>/dev/null || true
ip rule add fwmark ${MARK} table ${TABLE_ID} priority $((200 + IDX))

# NAT: masquerade outgoing on this interface
iptables -t nat -A POSTROUTING -o ${IFACE} -j MASQUERADE

echo "[OK] Modem ${IDX}: ${IFACE} via ${GW} (table ${TABLE_ID}, mark ${MARK})"
SCRIPT
chmod +x /usr/local/bin/setup-modem-routes.sh

echo "=== [4/5] iptables: Forward + Mark rules ==="

# Enable forwarding
sysctl -w net.ipv4.ip_forward=1

# Accept forwarded traffic from WireGuard
iptables -A FORWARD -i wg0 -j ACCEPT
iptables -A FORWARD -o wg0 -j ACCEPT

# Mark packets from VPS based on destination port
# Port 3001 → mark 1 → modem1, Port 3002 → mark 2 → modem2, etc.
for i in $(seq 1 ${MODEM_COUNT}); do
  PORT=$((3000 + $i))
  iptables -t mangle -A PREROUTING -i wg0 -p tcp --dport ${PORT} -j MARK --set-mark ${i}
done

# Save
iptables-save > /etc/iptables/rules.v4

echo "=== [5/5] Sysctl tuning ==="
cat > /etc/sysctl.d/99-proxy-local.conf << 'EOF'
net.ipv4.ip_forward = 1
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.core.netdev_max_backlog = 8192
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
EOF
sysctl --system

echo ""
echo "=== Local Node Setup Complete ==="
echo "WireGuard IP: 10.66.66.2"
echo ""
echo "Next steps:"
echo "  1. Plug in modems, wait for wwan0..wwan19"
echo "  2. Run: setup-modem-routes.sh <idx> <iface> <gateway>"
echo "  3. Start reset API: python3 /opt/datacenter/reset-api.py"
echo "  4. Test: curl --proxy VPS_IP:3001 ifconfig.me"
