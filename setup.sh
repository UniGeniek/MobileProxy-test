#!/bin/bash

# DataCenter Deployment Script for Ubuntu 24.04
# Patriot Optim Mini M1v5 (N100) Optimization

set -e

echo "--- ⚡ DataCenter Linux Deployment Tool ⚡ ---"

# 1. Update and install dependencies
echo "[1/5] Updating system and checking Docker..."
sudo apt-get update && sudo apt-get install -y curl git-core

if ! [ -x "$(command -v docker)" ]; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "  + Docker installed."
fi

# 2. Create directories with correct permissions
echo "[2/5] Creating directories..."
mkdir -p backend/logs proxy/logs backend/data pg_data redis_data
sudo chown -R $USER:$USER .

# 3. Setup .env
if [ ! -f .env ]; then
    echo "[3/5] Setting up .env file..."
    cp .env.example .env
    
    # Generate random secrets
    JWT_SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
    JWT_REFRESH=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
    DB_PASS=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 16)
    
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    sed -i "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH/" .env
    sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$DB_PASS/" .env
    echo "  ! Secrets generated in .env"
else
    echo "[3/5] .env already exists, skipping."
fi

# 4. Proxy users
if [ ! -f proxy/users.txt ]; then
    echo "[4/5] Creating default proxy users..."
    echo "admin:CL:admin123" > proxy/users.txt
    echo "  ! Default proxy user: admin / admin123"
fi

# 5. OS Optimization for 50 proxies (High load)
echo "[5/5] Applying kernel optimizations for high-traffic proxying..."
# Increase open files limit and connection tracking
sudo bash -c 'cat > /etc/sysctl.d/99-datacenter.conf <<EOF
fs.file-max = 100000
net.core.somaxconn = 4096
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_max_syn_backlog = 4096
net.core.netdev_max_backlog = 8192
EOF'
sudo sysctl --system > /dev/null

echo ""
echo "--- ✅ Setup Complete ---"
echo "To start the system, run:"
echo "  docker compose up --build -d"
echo ""
echo "Dashboard will be at: http://<SERVER_IP>:5173"
