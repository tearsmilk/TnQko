#!/usr/bin/env bash
# Installs the TnQko bot as a systemd service. Does not touch nginx, docker or other services.
# Usage (as root):  bash install.sh        (re-run the same command later to update)
set -euo pipefail

REPO="tearsmilk/TnQko"
BRANCH="${BRANCH:-claude/laughing-feynman-n5uvtp}"
APP_USER="tnqko"
APP_DIR="/opt/tnqko-bot"

[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }

# Node.js >= 20 (only installed if missing, an existing Node is left alone)
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
if ! node_ok; then
  apt-get update -y && apt-get install -y nodejs npm curl ca-certificates
  node_ok || { echo "Node >= 20 is required but apt gave: $(node -v 2>/dev/null || echo none). Install Node 20+ and re-run."; exit 1; }
fi
echo "Node: $(node -v)"

id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

# Fetch code (keeps .env and data/ on update)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}" | tar -xz -C "$TMP"
SRC="$(find "$TMP" -mindepth 2 -maxdepth 2 -type d -name bot | head -1)"
[ -n "$SRC" ] || { echo "bot/ folder not found in repo"; exit 1; }
mkdir -p "$APP_DIR"
tar -C "$SRC" --exclude=.env --exclude=data --exclude=node_modules -cf - . | tar -C "$APP_DIR" -xf -
mkdir -p "$APP_DIR/data"

# Token (asked once, never echoed)
if [ ! -f "$APP_DIR/.env" ]; then
  read -rsp "Discord BOT_TOKEN: " TOKEN; echo
  printf 'BOT_TOKEN=%s\nMESSAGE_CONTENT=0\n' "$TOKEN" > "$APP_DIR/.env"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

(cd "$APP_DIR" && sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund)

cat > /etc/systemd/system/tnqko-bot.service <<UNIT
[Unit]
Description=TnQko Discord bot
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable tnqko-bot >/dev/null
systemctl restart tnqko-bot
sleep 4
systemctl --no-pager --lines=15 status tnqko-bot || true
echo; echo "Logs: journalctl -u tnqko-bot -f"
