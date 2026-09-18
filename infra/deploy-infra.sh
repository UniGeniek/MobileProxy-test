#!/bin/bash
# ============================================
# Deploy infra to VPS + Local Node
# Run from your dev machine
# ============================================

set -euo pipefail

VPS_HOST="${1:-YOUR_VPS_IP}"
LOCAL_HOST="${2:-YOUR_LOCAL_IP}"
SSH_KEY="${3:-~/.ssh/id_rsa}"

echo "=== Deploying to VPS: ${VPS_HOST} ==="

# Upload VPS configs
scp -i "$SSH_KEY" infra/vps/setup-vps.sh root@${VPS_HOST}:/tmp/
scp -i "$SSH_KEY" infra/vps/3proxy.cfg root@${VPS_HOST}:/tmp/

# Run VPS setup
ssh -i "$SSH_KEY" root@${VPS_HOST} "chmod +x /tmp/setup-vps.sh && /tmp/setup-vps.sh"

# Install 3proxy config
ssh -i "$SSH_KEY" root@${VPS_HOST} "
  mkdir -p /etc/3proxy /var/log/3proxy
  cp /tmp/3proxy.cfg /etc/3proxy/3proxy.cfg
  # Create empty users file (managed by backend)
  touch /etc/3proxy/users.txt
  systemctl enable 3proxy 2>/dev/null || true
  systemctl restart 3proxy 2>/dev/null || true
"

echo ""
echo "=== Deploying to Local Node: ${LOCAL_HOST} ==="

# Upload local configs
scp -i "$SSH_KEY" infra/local/setup-local.sh root@${LOCAL_HOST}:/tmp/
scp -i "$SSH_KEY" infra/local/reset-api.py root@${LOCAL_HOST}:/tmp/
scp -i "$SSH_KEY" infra/local/watchdog.sh root@${LOCAL_HOST}:/tmp/
scp -i "$SSH_KEY" infra/local/datacenter-reset-api.service root@${LOCAL_HOST}:/tmp/

# Run Local setup
ssh -i "$SSH_KEY" root@${LOCAL_HOST} "chmod +x /tmp/setup-local.sh && /tmp/setup-local.sh"

# Install services
ssh -i "$SSH_KEY" root@${LOCAL_HOST} "
  mkdir -p /opt/datacenter /var/log/datacenter
  cp /tmp/reset-api.py /opt/datacenter/
  cp /tmp/watchdog.sh /opt/datacenter/
  chmod +x /opt/datacenter/watchdog.sh
  cp /tmp/datacenter-reset-api.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable datacenter-reset-api
  systemctl start datacenter-reset-api
  
  # Cron watchdog every 2 minutes
  (crontab -l 2>/dev/null; echo '*/2 * * * * /opt/datacenter/watchdog.sh') | sort -u | crontab -
"

echo ""
echo "=== Verification ==="
echo "1. Check WireGuard:"
echo "   ssh root@${VPS_HOST} 'wg show'"
echo "   ssh root@${LOCAL_HOST} 'wg show'"
echo ""
echo "2. Ping through tunnel:"
echo "   ssh root@${VPS_HOST} 'ping -c 3 10.66.66.2'"
echo ""
echo "3. Test proxy (from any machine):"
echo "   curl --proxy ${VPS_HOST}:3001 -U user:pass http://ifconfig.me"
echo ""
echo "4. Test reset:"
echo "   ssh root@${VPS_HOST} 'curl -X POST http://10.66.66.2:8880/reset?port=3001'"
echo ""
echo "5. Check modem status:"
echo "   ssh root@${VPS_HOST} 'curl http://10.66.66.2:8880/status | jq'"
