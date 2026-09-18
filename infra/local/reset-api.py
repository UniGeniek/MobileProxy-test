#!/usr/bin/env python3
"""
Reset API — Local Node
Runs on Mini PC. Receives reset commands from VPS backend.
Endpoint: POST /reset?port=3001
"""

import subprocess
import json
import os
import time
import logging
import hmac
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# H-05: API key authentication
API_SECRET = os.environ.get('RESET_API_SECRET')
if not API_SECRET:
    log = logging.getLogger('reset-api')
    logging.basicConfig(level=logging.INFO)
    log.error('FATAL: RESET_API_SECRET environment variable is not set!')
    exit(1)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('reset-api')

# ── Port → Modem mapping ──
# port 3001 → modem index 1 → interface wwan0 → USB device /dev/cdc-wdm0
# Adjust device paths for your hardware (Huawei E3372, ZTE MF833V, etc.)
MODEM_MAP = {}
for i in range(1, 21):
    MODEM_MAP[3000 + i] = {
        'index': i,
        'iface': f'wwan{i-1}',
        'device': f'/dev/cdc-wdm{i-1}',
        'usb_port': f'usb{i}',
    }

def reset_modem(port: int) -> dict:
    """Reset a modem by port number."""
    if port not in MODEM_MAP:
        return {'success': False, 'error': f'Unknown port {port}'}

    modem = MODEM_MAP[port]
    iface = modem['iface']
    device = modem['device']
    idx = modem['index']

    log.info(f"Resetting modem {idx} (port {port}, iface {iface})")

    old_ip = get_ip(iface)

    try:
        # Method 1: mmcli (ModemManager)
        # Find modem index in ModemManager
        result = subprocess.run(
            ['mmcli', '-L', '-J'],
            capture_output=True, text=True, timeout=10
        )
        mm_modems = json.loads(result.stdout).get('modem-list', [])

        mm_index = None
        for m in mm_modems:
            # Check if this modem corresponds to our device
            m_idx = m.split('/')[-1]
            detail = subprocess.run(
                ['mmcli', '-m', m_idx, '-J'],
                capture_output=True, text=True, timeout=10
            )
            info = json.loads(detail.stdout)
            ports = info.get('modem', {}).get('generic', {}).get('ports', [])
            for p in ports:
                if modem['device'].split('/')[-1] in p:
                    mm_index = m_idx
                    break
            if mm_index:
                break

        if mm_index:
            # Disable → Enable cycle
            subprocess.run(['mmcli', '-m', mm_index, '--disable'], timeout=15)
            time.sleep(2)
            subprocess.run(['mmcli', '-m', mm_index, '--enable'], timeout=15)
            time.sleep(3)
            # Reconnect bearer
            subprocess.run(
                ['mmcli', '-m', mm_index, '--simple-connect=apn=internet'],
                timeout=30
            )
        else:
            # Method 2: USB power cycle
            log.warning(f"ModemManager not found for {device}, trying USB reset")
            subprocess.run(['usbreset', device], timeout=10)

        # Wait for interface to come back
        for attempt in range(10):
            time.sleep(2)
            if iface_exists(iface):
                break

        time.sleep(3)
        new_ip = get_ip(iface)

        # Re-setup routing for this modem
        gw = get_gateway(iface)
        if gw:
            subprocess.run(
                ['/usr/local/bin/setup-modem-routes.sh', str(idx), iface, gw],
                timeout=10
            )

        return {
            'success': True,
            'port': port,
            'modem_index': idx,
            'interface': iface,
            'old_ip': old_ip,
            'new_ip': new_ip,
            'ip_changed': old_ip != new_ip
        }

    except Exception as e:
        log.error(f"Reset failed for modem {idx}: {e}")
        return {'success': False, 'error': str(e)}


def get_ip(iface: str) -> str:
    try:
        result = subprocess.run(
            ['ip', '-4', '-j', 'addr', 'show', iface],
            capture_output=True, text=True, timeout=5
        )
        data = json.loads(result.stdout)
        if data and data[0].get('addr_info'):
            return data[0]['addr_info'][0]['local']
    except:
        pass
    return 'unknown'


def get_gateway(iface: str) -> str:
    try:
        result = subprocess.run(
            ['ip', '-4', '-j', 'route', 'show', 'dev', iface],
            capture_output=True, text=True, timeout=5
        )
        routes = json.loads(result.stdout)
        for r in routes:
            if r.get('dst') == 'default':
                return r.get('gateway', '')
    except:
        pass
    return None


def iface_exists(iface: str) -> bool:
    return os.path.exists(f'/sys/class/net/{iface}')


def get_all_status() -> list:
    status = []
    for port, modem in MODEM_MAP.items():
        iface = modem['iface']
        exists = iface_exists(iface)
        status.append({
            'port': port,
            'index': modem['index'],
            'interface': iface,
            'online': exists,
            'ip': get_ip(iface) if exists else None
        })
    return status


class ResetHandler(BaseHTTPRequestHandler):
    def _check_auth(self):
        """H-05: Verify API key from X-API-Key header."""
        key = self.headers.get('X-API-Key', '')
        if not key or not hmac.compare_digest(key, API_SECRET):
            self.send_error(403, 'Forbidden: invalid or missing API key')
            return False
        return True

    def do_POST(self):
        if not self._check_auth():
            return
        parsed = urlparse(self.path)
        if parsed.path == '/reset':
            params = parse_qs(parsed.query)
            port = int(params.get('port', [0])[0])
            result = reset_modem(port)
            code = 200 if result['success'] else 500
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_error(404)

    def do_GET(self):
        parsed = urlparse(self.path)
        # Health endpoint is public, all others require auth
        if parsed.path != '/health' and not self._check_auth():
            return
        if parsed.path == '/status':
            status = get_all_status()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(status).encode())
        elif parsed.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'OK')
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        log.info(f"{self.client_address[0]} - {format % args}")


if __name__ == '__main__':
    # Bind only to WireGuard interface (not public)
    server = HTTPServer(('10.66.66.2', 8880), ResetHandler)
    log.info("Reset API listening on 10.66.66.2:8880")
    server.serve_forever()
