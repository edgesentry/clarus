#!/usr/bin/env bash
# Restart clarus-edge: kill any running instance, wipe local DB, start fresh.

set -euo pipefail
cd "$(dirname "$0")"

echo "[restart.sh] Stopping existing clarus-edge..."
pkill -f clarus-edge 2>/dev/null && echo "[restart.sh] Killed." || echo "[restart.sh] Not running."
sleep 1

echo "[restart.sh] Clearing local DuckDB..."
rm -f clarus_edge.db clarus_edge.db-shm clarus_edge.db-wal

exec bash run.sh "$@"
