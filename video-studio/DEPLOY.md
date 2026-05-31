# Deployment guide

Three ways to put video-studio online — pick the one that matches your budget.

| Option | Cost | Setup time | Difficulty |
|---|---|---|---|
| **Fly.io** | $0–5/mo | 5 min | ⭐ easiest, recommended |
| **Self-host (VPS)** | $5–10/mo | 10 min | ⭐⭐ if you know SSH |
| **Self-host (home / NAS)** | $0 | 5 min | ⭐⭐ needs port-forward or tunnel |

---

## 🚀  Option 1 — Fly.io (recommended)

Free tier: 3× shared-cpu-1x VMs (1GB RAM each) + 3GB persistent storage. Enough for one personal app.

### One-time setup

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Sign up (free, no credit card required for free tier)
fly auth signup

# 3. From inside this repo
cd video-studio
fly launch --copy-config --no-deploy
#   → it'll ask for app name and region. Pick "sin" (Singapore) for Asia.

# 4. Create the two persistent volumes
fly volumes create data    --size 1  --region sin --yes
fly volumes create renders --size 10 --region sin --yes

# 5. Deploy 🎉
fly deploy
```

After `fly deploy` finishes (~5 min on first run because whisper.cpp compiles), the terminal prints the live URL:

```
https://video-studio-<random>.fly.dev
```

Open that on any phone — auto HTTPS, real PWA install works, share sheet works.

### Updates

```bash
fly deploy           # rebuilds and rolls out new image
fly logs             # tail server logs
fly ssh console      # shell into the running container
fly status           # see machines / volumes
```

### Scaling for heavier use

```bash
fly scale memory 4096    # bump to 4 GB RAM for parallel renders
fly scale count 2        # run two machines for HA (each handles renders)
```

---

## 🐳  Option 2 — Self-host on a VPS (DigitalOcean / Hetzner / Vultr / …)

Any cheap Ubuntu/Debian VPS works. Tested on 1 vCPU / 2 GB RAM.

```bash
# On the VPS (logged in as root or with sudo):
apt update && apt install -y docker.io docker-compose-v2 git
git clone https://github.com/<you>/video-studio.git
cd video-studio
docker compose up -d --build
```

That builds the image (~5 min first time) and runs it on port `8080`.

### Reverse proxy + HTTPS

For a real domain with HTTPS, put Caddy in front:

```bash
# Install Caddy
apt install -y caddy

# Edit /etc/caddy/Caddyfile:
cat <<'EOF' > /etc/caddy/Caddyfile
your-domain.example.com {
    reverse_proxy localhost:8080
}
EOF

systemctl restart caddy
```

Caddy auto-fetches Let's Encrypt cert. Done.

---

## 🏠  Option 3 — Self-host at home (with public tunnel)

If you want to keep your data 100% on your own machine but still access from the road:

```bash
# Run the app locally
docker compose up -d --build

# Install cloudflared (one-time)
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/install-and-setup/installation/

# Then in a separate terminal:
cloudflared tunnel --url http://localhost:8080
```

cloudflared prints a `https://<random>.trycloudflare.com` URL that proxies to your machine. Free, no signup needed for quick tunnels. For a permanent subdomain use `cloudflared tunnel create`.

Alternatives: `ngrok http 8080`, `bore.pub`, `localtunnel`.

---

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4321` | HTTP port to bind |
| `DATA_DIR` | `./data` | Persistent jobs DB |
| `RENDERS_DIR` | `./renders` | Output MP4s |
| `UPLOAD_DIR` | `./assets/_uploads` | Temp upload buffer |
| `PUBLIC_URL` | (empty) | Used in QR + share links |
| `NODE_ENV` | `production` (in Docker) | |

---

## Disk usage

- whisper.cpp + base model bake into image: **~200 MB**
- ffmpeg + fonts: **~200 MB**
- Node + npm deps: **~80 MB**
- Per render output: **5–50 MB** depending on length

Total image size: **~600 MB**. Each render takes 30–180 s of CPU.

---

## What about a database?

Currently jobs are persisted to a JSON file at `$DATA_DIR/jobs.json` (last 200 jobs). That's enough for single-user / small-team usage and survives restarts.

If you want SQLite/Postgres later (user accounts, full history, multi-tenant), the `pipeline/` modules are pure functions and the swap is isolated to `web/server.js`.
