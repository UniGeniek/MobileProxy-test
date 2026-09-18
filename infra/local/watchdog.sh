#!/bin/bash
# ============================================
# Watchdog — monitors modems + WireGuard
# Cron: */2 * * * * /opt/datacenter/watchdog.sh
# ============================================

LOG="/var/log/datacenter/watchdog.log"
MODEM_COUNT=20

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }

# ── 1. WireGuard health ──
WG_STATUS=$(wg show wg0 2>&1)
if echo "$WG_STATUS" | grep -q "latest handshake"; then
    HANDSHAKE_AGO=$(wg show wg0 latest-handshakes | awk '{print $2}')
    NOW=$(date +%s)
    DIFF=$((NOW - HANDSHAKE_AGO))
    if [ "$DIFF" -gt 180 ]; then
        log "WARN: WireGuard handshake stale (${DIFF}s ago). Restarting..."
        systemctl restart wg-quick@wg0
        sleep 5
    fi
else
    log "ERROR: WireGuard down. Restarting..."
    systemctl restart wg-quick@wg0
    sleep 5
fi

# ── 2. Modem health ──
for i in $(seq 1 $MODEM_COUNT); do
    IFACE="wwan$((i-1))"
    
    if [ ! -d "/sys/class/net/${IFACE}" ]; then
        log "WARN: ${IFACE} missing, attempting USB reset for modem ${i}"
        # Try mmcli reset
        mmcli -m $((i-1)) --reset 2>/dev/null || true
        sleep 5
        continue
    fi
    
    # Check if interface has IP
    IP=$(ip -4 addr show ${IFACE} 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
    if [ -z "$IP" ]; then
        log "WARN: ${IFACE} has no IP, reconnecting modem ${i}"
        mmcli -m $((i-1)) --simple-connect="apn=internet" 2>/dev/null || true
        sleep 5
    fi
done

# ── 3. Reset API health ──
RESET_API=$(curl -sf http://10.66.66.2:8880/health 2>/dev/null)
if [ "$RESET_API" != "OK" ]; then
    log "WARN: Reset API down. Restarting..."
    systemctl restart datacenter-reset-api
fi

# ── 4. Resource monitoring ──
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1)
MEM=$(free | awk '/Mem/{printf("%.0f"), $3/$2*100}')
DISK=$(df / | awk 'NR==2{print $5}' | tr -d '%')

if [ "$CPU" -gt 90 ]; then log "ALERT: CPU at ${CPU}%"; fi
if [ "$MEM" -gt 90 ]; then log "ALERT: Memory at ${MEM}%"; fi
if [ "$DISK" -gt 85 ]; then log "ALERT: Disk at ${DISK}%"; fi

# ── 5. WireGuard traffic stats ──
RX=$(wg show wg0 transfer | awk '{print $2}')
TX=$(wg show wg0 transfer | awk '{print $3}')
log "STATUS: WG rx=${RX} tx=${TX} CPU=${CPU}% MEM=${MEM}% DISK=${DISK}%"
