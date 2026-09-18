#!/bin/bash
set -euo pipefail

# ============================================
# VPS Setup — WireGuard + 3proxy + Firewall
# Run as root on fresh Ubuntu 22.04/24.04
# ============================================

PUBLIC_IP=$(curl -s4 ifconfig.me)
WG_PORT=51820
PROXY_PORTS="3001:3020"
PANEL_PORT=443
LOCAL_NODE_WG_IP="10.66.66.2"

echo "=== [1/6] Install packages ==="
apt-get update && apt-get install -y \
  wireguard wireguard-tools \
  3proxy \
  iptables-persistent \
  curl wget htop iftop vnstat \
  fail2ban ufw \
  jq

echo "=== [2/6] WireGuard keys ==="
mkdir -p /etc/wireguard
cd /etc/wireguard

# Generate VPS keys
wg genkey | tee vps_private.key | wg pubkey > vps_public.key
chmod 600 vps_private.key

# Generate Local Node keys (transfer public key securely)
wg genkey | tee local_private.key | wg pubkey > local_public.key
chmod 600 local_private.key

VPS_PRIV=$(cat vps_private.key)
LOCAL_PUB=$(cat local_public.key)

echo "=== [3/6] WireGuard config ==="
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.66.66.1/24
ListenPort = ${WG_PORT}
PrivateKey = ${VPS_PRIV}

# Enable forwarding on up
PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT
PostUp = iptables -A FORWARD -o wg0 -j ACCEPT
# L-04: WireGuard Kill-switch
PostUp = iptables -I FORWARD -i eth0 -o eth0 -j DROP
PostDown = iptables -t nat -D POSTROUTING -o wg0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -o wg0 -j ACCEPT
PostDown = iptables -D FORWARD -i eth0 -o eth0 -j DROP

[Peer]
# Local Node (Mini PC)
PublicKey = ${LOCAL_PUB}
AllowedIPs = 10.66.66.2/32
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf

# Enable and start
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

echo "=== [4/6] Firewall (UFW) ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp           # SSH
ufw allow ${WG_PORT}/udp   # WireGuard
ufw allow ${PANEL_PORT}/tcp # Dashboard
ufw allow 3001:3020/tcp    # Proxy ports
ufw --force enable

echo "=== [5/6] SSH Hardening ==="
sed -i 's/#PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#MaxAuthTries 6/MaxAuthTries 3/' /etc/ssh/sshd_config
systemctl restart sshd

# Fail2ban
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 3
bantime = 3600
findtime = 600
EOF
systemctl enable fail2ban && systemctl restart fail2ban

echo "=== [6/6] Sysctl tuning ==="
cat > /etc/sysctl.d/99-proxy.conf << 'EOF'
net.ipv4.ip_forward = 1
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.core.netdev_max_backlog = 8192
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
EOF
sysctl --system

echo ""
echo "=== VPS Setup Complete ==="
echo "Public IP:    ${PUBLIC_IP}"
echo "WireGuard IP: 10.66.66.1"
echo "WG Port:      ${WG_PORT}"
echo ""
echo "VPS Public Key (give to local node):"
cat /etc/wireguard/vps_public.key
echo ""
echo "Local Node Private Key (transfer securely via scp/sftp. DO NOT echo here):"
echo "(Private key saved to /etc/wireguard/local_private.key)"
echo ""
echo "Next: run setup-local.sh on the Mini PC"
