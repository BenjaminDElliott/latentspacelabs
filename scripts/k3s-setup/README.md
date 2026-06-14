# k3s Cluster Setup — RunPod / Unprivileged Container

## Quick Start (Agent-Driven)

Run this to stand up a k3s cluster from scratch:

```bash
bash /workspace/latentspacelabs/scripts/k3s-setup/install.sh
```

Or do it step by step (see below).

---

## Prerequisites

- **OS:** Ubuntu 24.04+
- **Capability:** `SYS_ADMIN` (privileged container or capability cap) — required for kubelet bind-mount
- **Persistent storage:** `/workspace` (NFS/mfs mount) — state survives pod restarts
- **Python 3.12+** (for kine DB manipulation)

## One-Liner Install

```bash
bash scripts/k3s-setup/install.sh
```

This does everything:
1. Downloads k3s v1.36.1 binary
2. Installs supervisord config
3. Starts k3s server (API server + kubelet)
4. Waits for cluster readiness
5. Saves kubeconfig

## Manual Steps (If You Prefer Control)

### 1. Download k3s binary

```bash
mkdir -p /workspace/hermes/bin
curl -fsSL https://github.com/k3s-io/k3s/releases/download/v1.36.1+k3s1/k3s \
  -o /workspace/hermes/bin/k3s
chmod +x /workspace/hermes/bin/k3s
cp /workspace/hermes/bin/k3s /usr/local/bin/k3s
```

### 2. Configure supervisord

Create `/etc/supervisor/conf.d/k3s-server.conf`:

```ini
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
```

### 3. Start k3s

```bash
supervisord -c /etc/supervisor/supervisord.conf
# or: supervisorctl start k3s-server
```

### 4. Wait for readiness

```bash
# Wait up to 5 minutes for API server
for i in $(seq 1 30); do
  curl -sk https://127.0.0.1:6443/readyz 2>/dev/null | grep -q "ping ok" && break
  sleep 10
done

# Verify
kubectl get nodes    # should show your node as Ready
kubectl get pods -A  # core components should be Running
```

### 5. Configure kubeconfig

```bash
cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
kubectl config set-cluster default --server=https://127.0.0.1:6443
```

## Ports Reference

| Port | Service |
|------|---------|
| 6443 | API server |
| 2379 | etcd |
| 2380 | etcd peer |
| 6444 | API server secure port |
| 10257 | controller-manager |
| 10259 | scheduler |

## Multi-Environment Setup (Namespaces)

```bash
# Create namespace structure
kubectl create namespace dev
kubectl create namespace stage
kubectl create namespace prod

# Apply resource quotas (see namespaces/ directory)
kubectl apply -f scripts/k3s-setup/namespaces/
```

## Addons

### cert-manager (TLS)

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.3/cert-manager.yaml
```

### Longhorn (Persistent Storage)

```bash
kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.8.0/deploy/longhorn.yaml
```

## Troubleshooting

### Kubelet fails to start

```bash
# Check logs
tail -100 /var/log/k3s-server.err.log | grep -i "kubelet\|bind"

# Fix: ensure SYS_ADMIN capability is set on the container
# In RunPod UI: check "Privileged" or add SYS_ADMIN cap

# Restart k3s
supervisorctl restart k3s-server
```

### API server not ready

```bash
# Clear etcd state for fresh start
rm -rf /var/lib/rancher/k3s/server/db/etcd/*
rm -f /var/lib/rancher/k3s/server/db/state.db*

# Restart
supervisorctl restart k3s-server

# Wait up to 5 min for rbac/bootstrap-roles hook
```

### Bootstrap key stuck

```bash
# Use the fix script
python3 scripts/k3s-setup/fix-bootstrap-key.py
```

### No node registered

```bash
# Kubelet runs as child of k3s server — check logs
tail -200 /var/log/k3s-server.err.log | grep -i "kubelet started"
# Should see: "kubelet started successfully"
```

## State Persistence

k3s stores state in `/var/lib/rancher/k3s/`. To persist across pod restarts:

1. **Before restart:**
   ```bash
   cp -a /var/lib/rancher/k3s/ /workspace/k3s-data/
   ```

2. **After restart:**
   ```bash
   cp -a /workspace/k3s-data/server/ /var/lib/rancher/k3s/
   supervisorctl start k3s-server
   ```

The `install.sh` script handles this automatically.

## Files

```
scripts/k3s-setup/
├── README.md          # This file
├── install.sh         # Full one-line install script
├── supervisord.conf   # Supervisor config template
├── fix-bootstrap-key.py  # Clear stuck bootstrap key
├── namespaces/        # Dev/stage/prod namespace configs
│   ├── dev.yaml
│   ├── stage.yaml
│   └── prod.yaml
└── addons/
    ├── cert-manager.yaml
    └── longhorn.yaml
```

## Architecture

```
┌──────────────────────────────────────────┐
│ RunPod Pod (2TB RAM, 128 CPU, 685TB disk)│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ k3s Server (control plane + agent) │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │ k3s binary (v1.36.1)         │  │  │
│  │  │ containerd + runc            │  │  │
│  │  │ Flannel CNI + CoreDNS        │  │  │
│  │  │ Metrics Server               │  │  │
│  │  │ Local-path-provisioner       │  │  │
│  │  │ Helm-controller              │  │  │
│  │  └──────────────────────────────┘  │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │ dev/   │ stage/   │ prod/ ns │  │  │
│  │  └──────────────────────────────┘  │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │ Traefik (ingress)            │  │  │
│  │  │ cert-manager (TLS)           │  │  │
│  │  │ Longhorn (storage)           │  │  │
│  │  └──────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```
