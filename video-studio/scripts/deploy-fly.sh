#!/usr/bin/env bash
# One-command Fly.io deploy. Run this from the video-studio/ directory.
# Prerequisites: nothing — the script installs flyctl if missing.

set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Install flyctl if missing
if ! command -v fly >/dev/null 2>&1; then
  echo "→ Installing flyctl…"
  curl -fsSL https://fly.io/install.sh | sh
  export FLYCTL_INSTALL="$HOME/.fly"
  export PATH="$FLYCTL_INSTALL/bin:$PATH"
fi

# 2. Authenticate (interactive if not already logged in)
if ! fly auth whoami >/dev/null 2>&1; then
  echo "→ Sign in to Fly.io (browser will open)…"
  fly auth signup || fly auth login
fi

APP_NAME="${FLY_APP:-video-studio-$(openssl rand -hex 3 2>/dev/null || date +%s)}"
REGION="${FLY_REGION:-sin}"

echo "→ App name: $APP_NAME"
echo "→ Region:   $REGION"

# 3. Create app if needed
if ! fly status -a "$APP_NAME" >/dev/null 2>&1; then
  echo "→ Launching app…"
  fly launch --copy-config --no-deploy --name "$APP_NAME" --region "$REGION" --yes
fi

# 4. Create persistent volumes if they don't already exist
for vol_size in "data:1" "renders:10"; do
  name="${vol_size%%:*}"
  size="${vol_size##*:}"
  if ! fly volumes list -a "$APP_NAME" | grep -q "$name"; then
    echo "→ Creating volume $name (${size}GB)…"
    fly volumes create "$name" --size "$size" --region "$REGION" --yes -a "$APP_NAME"
  fi
done

# 5. Set PUBLIC_URL secret so the QR + share links use the real domain
PUBLIC_URL="https://${APP_NAME}.fly.dev"
fly secrets set "PUBLIC_URL=$PUBLIC_URL" -a "$APP_NAME"

# 6. Deploy
echo "→ Deploying (first build ≈ 5 min while whisper.cpp compiles)…"
fly deploy -a "$APP_NAME" --ha=false

echo ""
echo "✓ Done!"
echo ""
echo "  Open on any phone:   $PUBLIC_URL"
echo "  Logs:                fly logs -a $APP_NAME"
echo "  Shell:               fly ssh console -a $APP_NAME"
