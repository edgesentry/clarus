#!/usr/bin/env bash
# Pull latest clarus-edge binary from GitHub Releases and restart the service.
#
# Usage:
#   ./update.sh            # install latest release
#   ./update.sh --dry-run  # show what would be downloaded, no changes
#
# Run once to set up:
#   sudo cp clarus-edge.service /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable clarus-edge
#   ./update.sh            # first install
#   sudo systemctl start clarus-edge

set -euo pipefail

REPO="edgesentry/clarus"
ASSET="clarus-edge-aarch64-linux"
INSTALL_PATH="/usr/local/bin/clarus-edge"
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

echo "[update.sh] Fetching latest release info from $REPO..."
RELEASE_JSON=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest")

TAG=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | jq -r ".assets[] | select(.name == \"$ASSET\") | .browser_download_url")

if [[ -z "$DOWNLOAD_URL" || "$DOWNLOAD_URL" == "null" ]]; then
  echo "[update.sh] ERROR: asset '$ASSET' not found in release $TAG"
  echo "[update.sh] Available assets:"
  echo "$RELEASE_JSON" | jq -r '.assets[].name'
  exit 1
fi

echo "[update.sh] Latest release: $TAG"
echo "[update.sh] Download URL:   $DOWNLOAD_URL"

if $DRY_RUN; then
  echo "[update.sh] Dry-run — no changes made."
  exit 0
fi

echo "[update.sh] Downloading..."
curl -fL "$DOWNLOAD_URL" -o "${INSTALL_PATH}.tmp"
chmod +x "${INSTALL_PATH}.tmp"
sudo mv "${INSTALL_PATH}.tmp" "$INSTALL_PATH"

echo "[update.sh] Installed to $INSTALL_PATH"

if systemctl is-active --quiet clarus-edge 2>/dev/null; then
  echo "[update.sh] Restarting clarus-edge service..."
  sudo systemctl restart clarus-edge
  echo "[update.sh] Done. Status:"
  systemctl status clarus-edge --no-pager --lines=5
else
  echo "[update.sh] Service not running. Start with: sudo systemctl start clarus-edge"
fi
