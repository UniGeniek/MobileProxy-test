#!/bin/sh
set -e

echo "Starting 3proxy..."
echo "Ports: 3001-3050"
echo "Config: /etc/3proxy/3proxy.cfg"

# Run 3proxy in foreground
exec 3proxy /etc/3proxy/3proxy.cfg
