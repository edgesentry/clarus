# RPi5 deployment

## First-time setup

```bash
# 1. Copy systemd service
sudo cp clarus-edge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable clarus-edge

# 2. Download and install the latest binary
chmod +x update.sh
./update.sh

# 3. Copy and edit config
cp ../config.env.example ../config.env
# edit config.env — set R2 credentials, profile, site ID

# 4. Start
sudo systemctl start clarus-edge
sudo systemctl status clarus-edge
```

## Updating to a new release

```bash
cd ~/clarus/edge/deploy
./update.sh
```

The script downloads the latest `clarus-edge-aarch64-linux` binary from GitHub Releases,
installs it to `/usr/local/bin/clarus-edge`, and restarts the systemd service.

## Logs

```bash
journalctl -u clarus-edge -f
```

## How builds work

Every push to `main` that touches `edge/` (or any new version tag) triggers
`.github/workflows/build-edge-aarch64.yml`:

1. Checks out both `clarus` and `edgesentry-rs`
2. Cross-compiles with `cargo-zigbuild` (aarch64-unknown-linux-gnu, glibc 2.31+)
3. On a version tag: uploads binary to the GitHub Release
4. On non-tag pushes: uploads as a workflow artifact (7-day retention)

No Docker required. No SSH inbound to RPi5 required.
