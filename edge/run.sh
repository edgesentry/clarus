#!/usr/bin/env bash
# Start the clarus-edge daemon.
# Loads config.env if present, starts MinIO via Docker if STORAGE_BACKEND=minio.

set -euo pipefail
cd "$(dirname "$0")"

# Load config
[[ -f config.env ]] && set -a && source config.env && set +a

BACKEND="${STORAGE_BACKEND:-minio}"

# ── MinIO setup ───────────────────────────────────────────────────────────────
if [[ "$BACKEND" == "minio" ]]; then
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^clarus-minio$"; then
    echo "[run.sh] Starting MinIO..."
    docker run -d \
      --name clarus-minio \
      -p 9000:9000 -p 9001:9001 \
      -e MINIO_ROOT_USER="${MINIO_ACCESS_KEY:-minioadmin}" \
      -e MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY:-minioadmin}" \
      minio/minio server /data --console-address ":9001"
    sleep 3

    echo "[run.sh] Creating buckets..."
    docker run --rm --network host --entrypoint sh minio/mc -c "
      mc alias set local http://localhost:9000 \
        ${MINIO_ACCESS_KEY:-minioadmin} ${MINIO_SECRET_KEY:-minioadmin} --quiet &&
      mc mb --ignore-existing local/${AUDIT_BUCKET:-clarus-audit} &&
      mc mb --ignore-existing local/${ANALYTICS_BUCKET:-clarus-public}
    " || true
    echo "[run.sh] MinIO ready — console: http://localhost:9001"
  else
    echo "[run.sh] MinIO already running"
  fi
fi

# ── Build + run ───────────────────────────────────────────────────────────────
echo "[run.sh] Building clarus-edge..."
cargo build --release 2>&1 | grep -E "^error|Compiling clarus-edge|Finished" || true

echo "[run.sh] Starting daemon (site=${SITE_ID:-site_dev_001} profile=${PROFILE:-sg-maritime-security})"
exec ./target/release/clarus-edge "$@"
