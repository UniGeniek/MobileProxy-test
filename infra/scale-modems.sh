#!/bin/bash
# ============================================
# Scale modems: generate configs for N modems
# Usage: ./scale-modems.sh 50
# ============================================

COUNT=${1:-20}
echo "Generating configs for ${COUNT} modems..."

# ── 1. Generate 3proxy config ──
cat > /tmp/3proxy-scaled.cfg << 'HEADER'
daemon
pidfile /var/run/3proxy.pid
nscache 65536
nserver 8.8.8.8
nserver 1.1.1.1
timeouts 1 5 30 60 180 1800 15 60
log /var/log/3proxy/3proxy.log D
logformat "L%d-%m-%Y %H:%M:%S %N.%p %E %C:%c %R:%r %O %I %h %T"
rotate 30
users $/etc/3proxy/users.txt
auth strong
allow * * * 1-65535
flush
HEADER

for i in $(seq 1 ${COUNT}); do
    PORT=$((3000 + i))
    echo "" >> /tmp/3proxy-scaled.cfg
    echo "connlim 20 20" >> /tmp/3proxy-scaled.cfg
    echo "proxy -n -p${PORT} -e10.66.66.2" >> /tmp/3proxy-scaled.cfg
done

# Adjust maxconn based on count
sed -i "/flush/i maxconn $((COUNT * 25))" /tmp/3proxy-scaled.cfg

echo "[OK] 3proxy config: /tmp/3proxy-scaled.cfg (${COUNT} ports: 3001-$((3000+COUNT)))"

# ── 2. Generate iptables rules ──
echo "#!/bin/bash" > /tmp/iptables-scaled.sh
for i in $(seq 1 ${COUNT}); do
    PORT=$((3000 + i))
    echo "iptables -t mangle -A PREROUTING -i wg0 -p tcp --dport ${PORT} -j MARK --set-mark ${i}" >> /tmp/iptables-scaled.sh
done
echo "iptables-save > /etc/iptables/rules.v4" >> /tmp/iptables-scaled.sh
chmod +x /tmp/iptables-scaled.sh

echo "[OK] iptables rules: /tmp/iptables-scaled.sh"

# ── 3. Generate routing tables ──
echo "# Modem routing tables" > /tmp/rt_tables_append
for i in $(seq 1 ${COUNT}); do
    echo "$((100 + i)) modem${i}" >> /tmp/rt_tables_append
done

echo "[OK] Routing tables: /tmp/rt_tables_append (append to /etc/iproute2/rt_tables)"

# ── 4. Generate modem map for reset-api ──
echo "MODEM_MAP = {}" > /tmp/modem_map.py
for i in $(seq 1 ${COUNT}); do
    PORT=$((3000 + i))
    echo "MODEM_MAP[${PORT}] = {'index': ${i}, 'iface': 'wwan$((i-1))', 'device': '/dev/cdc-wdm$((i-1))', 'usb_port': 'usb${i}'}" >> /tmp/modem_map.py
done

echo "[OK] Modem map: /tmp/modem_map.py"

# ── 5. Scaling notes ──
echo ""
echo "=== Scaling Recommendations ==="
if [ "$COUNT" -le 20 ]; then
    echo "  Tier: Small (≤20 modems)"
    echo "  - Single Mini PC is sufficient"
    echo "  - 1 USB hub per 10 modems"
    echo "  - Memory: 4GB min"
elif [ "$COUNT" -le 50 ]; then
    echo "  Tier: Medium (21-50 modems)"
    echo "  - Use powered USB 3.0 hubs (max 10 per hub)"
    echo "  - Consider 2x WireGuard tunnels for redundancy"
    echo "  - Memory: 8GB recommended"
    echo "  - Add: MTU optimization (1420 on wg0)"
    echo "  - Add: connection pooling on 3proxy"
elif [ "$COUNT" -le 100 ]; then
    echo "  Tier: Large (51-100 modems)"
    echo "  - Split across 2-3 local nodes"
    echo "  - Each node: own WireGuard tunnel (10.66.66.2, .3, .4)"
    echo "  - VPS routes by port range:"
    echo "    3001-3033 → 10.66.66.2 (Node 1)"
    echo "    3034-3066 → 10.66.66.3 (Node 2)"
    echo "    3067-3100 → 10.66.66.4 (Node 3)"
    echo "  - Memory: 8GB per node"
    echo "  - Consider dedicated VPS for each 50 modems"
fi
