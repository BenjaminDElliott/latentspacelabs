#!/bin/bash
# k3s Cluster Setup — RunPod / Unprivileged Container
# One-line install: bash <(curl -sL <repo>/scripts/k3s-setup/install.sh)
# Or: bash scripts/k3s-setup/install.sh
set -euo pipefail

K3S_VERSION="v1.36.1+k3s1"
K3S_DIR="/workspace/hermes/bin"
K3S_DATA="/workspace/k3s-data"
SUPERVISOR_CONF="/etc/supervisor/conf.d/k3s-server.conf"

echo "=== k3s Cluster Setup ==="

# 1. Download k3s binary
echo "[1/6] Downloading k3s ${K3S_VERSION}..."
mkdir -p "$K3S_DIR"
if [ ! -f "$K3S_DIR/k3s" ] || ! "$K3S_DIR/k3s" --version 2>/dev/null | grep -q "$K3S_VERSION"; then
  curl -fsSL "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/k3s" \
    -o "$K3S_DIR/k3s"
  chmod +x "$K3S_DIR/k3s"
fi
cp "$K3S_DIR/k3s" /usr/local/bin/k3s
echo "  -> k3s binary installed"

# 2. Restore persisted state
echo "[2/6] Restoring persisted state..."
if [ -d "$K3S_DATA/server" ]; then
  cp -a "$K3S_DATA/server/"* /var/lib/rancher/k3s/server/ 2>/dev/null || true
  echo "  -> State restored from ${K3S_DATA}/server/"
else
  echo "  -> Fresh start (no persisted state)"
fi

# 3. Create supervisor config
echo "[3/6] Creating supervisord config..."
cat > "$SUPERVISOR_CONF" <<'EOF'
[program:k3s-server]
command=/usr/local/bin/k3s server \
  --write-kubeconfig-mode=644 \
  --disable traefik \
  --snapshotter native \
  --cluster-init
directory=/
user=root
autostart=true
autorestart=true
startsecs=10
startretries=5
stderr_logfile=/var/log/k3s-server.err.log
stdout_logfile=/var/log/k3s-server.out.log
stdout_logfile_maxbytes=10MB
stopsignal=INT
stopwaitsecs=10
priority=1
EOF

# Ensure supervisord directory exists
mkdir -p /etc/supervisor
if [ ! -f /etc/supervisor/supervisord.conf ]; then
  # Minimal supervisord config if none exists
  cat > /etc/supervisor/supervisord.conf <<'EOF'
[supervisord]
nodaemon=true
logfile=/var/log/supervisord.log
logfile_maxbytes=10MB

[unix_http_server]
file=/var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[inet_http_server]
port=0.0.0.0:9001
EOF
fi

echo "  -> Config written to ${SUPERVISOR_CONF}"

# 4. Start k3s
echo "[4/6] Starting k3s server..."
if command -v supervisord &>/dev/null; then
  supervisord -c /etc/supervisor/supervisord.conf &
  sleep 2
  supervisorctl start k3s-server 2>/dev/null || true
else
  # Run directly (fallback if no supervisord)
  /usr/local/bin/k3s server \
    --write-kubeconfig-mode=644 \
    --disable traefik \
    --snapshotter native \
    --cluster-init &
  echo "  -> k3s started in background (PID $!)"
fi

# 5. Wait for readiness
echo "[5/6] Waiting for cluster readiness..."
READY=false
for i in $(seq 1 60); do
  if curl -sk https://127.0.0.1:6443/readyz 2>/dev/null | grep -q "ping ok"; then
    READY=true
    break
  fi
  sleep 5
done

if [ "$READY" != "true" ]; then
  echo "  -> WARNING: API server not ready after 5 minutes"
  echo "  -> Check logs: tail -100 /var/log/k3s-server.err.log"
  echo "  -> If bootstrap key stuck, run: python3 fix-bootstrap-key.py"
fi
echo "  -> API server status: $([ "$READY" = "true" ] && echo 'READY' || echo 'CHECK LOGS')"

# 6. Save kubeconfig and verify
echo "[6/6] Configuring kubeconfig..."
if [ -f /etc/rancher/k3s/k3s.yaml ]; then
  cp /etc/rancher/k3s/k3s.yaml ~/.kube/config 2>/dev/null || true
  mkdir -p ~/.kube
  cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
  kubectl config set-cluster default --server=https://127.0.0.1:6443 --kubeconfig=~/.kube/config 2>/dev/null || true
  echo "  -> Kubeconfig at ~/.kube/config"
fi

# Persist state
cp -a /var/lib/rancher/k3s/server/ "$K3S_DATA/" 2>/dev/null || true

# Show status
echo ""
echo "=== Cluster Status ==="
kubectl get nodes 2>/dev/null || echo "  Nodes: checking..."
kubectl get pods -A 2>/dev/null | head -20 || echo "  Pods: checking..."
echo ""
echo "=== Ports ==="
echo "  API server: https://127.0.0.1:6443"
echo "  etcd: https://127.0.0.1:2379"
echo "  KUBECONFIG: ~/.kube/config"
echo ""
echo "=== Next Steps ==="
echo "  1. Create namespaces: kubectl create namespace dev stage prod"
echo "  2. Install addons: kubectl apply -f scripts/k3s-setup/addons/cert-manager.yaml"
echo "  3. Save this setup: https://github.com/BenjaminDElliott/latentspacelabs"
echo ""
echo "=== Done ==="
