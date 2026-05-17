#!/usr/bin/env bash
# rpi5_swap_benchmark.sh — clarus-edge SWaP sample with AIS UDP (clarus#138)
#
# Runs clarus-edge in AIS mode with NMEA replay (same fixture as edgesentry-rs #404).
# Measures CPU% / RSS of the clarus-edge process. For authoritative C2 annex numbers,
# run on physical RPi5 (aarch64) and paste results into c2-annex-a.md.
#
# Usage:
#   ./demo/rpi5_swap_benchmark.sh
#   ./demo/rpi5_swap_benchmark.sh --duration 30 --speed 30
#
# Live stream (dev laptop → RPi5):
#   USE_LIVE=1 AISSTREAM_API_KEY=... ./demo/rpi5_swap_benchmark.sh --host <pi-ip>

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
BIN="${CLARUS_BIN:-$ROOT/target/debug/clarus-edge}"
NMEA="${NMEA_FILE:-$REPO_ROOT/edgesentry-rs/demo/sg-strait-15min.nmea}"
REPLAY="$REPO_ROOT/edgesentry-rs/tools/nmea_udp_replay.py"
UDP_HOST="127.0.0.1"
UDP_PORT=9100
DURATION=60
SPEED=15
SKIP_BUILD=0
USE_LIVE="${USE_LIVE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration) DURATION="$2"; shift 2 ;;
    --speed) SPEED="$2"; shift 2 ;;
    --host) UDP_HOST="$2"; shift 2 ;;
    --port) UDP_PORT="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> cargo build -p clarus-edge (edge/)"
  (cd "$ROOT" && cargo build)
fi

if [[ ! -x "$BIN" ]]; then
  echo "error: clarus-edge not found — run: (cd edge && cargo build)" >&2
  exit 1
fi

if [[ ! -f "$NMEA" ]] && [[ "$USE_LIVE" != "1" ]]; then
  echo "error: NMEA fixture missing: $NMEA" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill $(jobs -p) 2>/dev/null || true' EXIT

DB_PATH="$TMP/clarus_bench.db"
export SITE_ID="${SITE_ID:-bench-ais-001}"
export PROFILE="${PROFILE:-sg-maritime-security}"
export PROFILES_DIR="${PROFILES_DIR:-$ROOT/../profiles}"
export SOURCE="ais://${UDP_HOST}:${UDP_PORT}"
export STORAGE_BACKEND="${STORAGE_BACKEND:-minio}"
export DB_PATH
export CYCLE_INTERVAL="${CYCLE_INTERVAL:-1}"
export HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-3600}"

echo "==> Starting clarus-edge (AIS UDP ${UDP_HOST}:${UDP_PORT})"
"$BIN" >"$TMP/clarus.log" 2>&1 &
EDGE_PID=$!
sleep 2

if ! kill -0 "$EDGE_PID" 2>/dev/null; then
  echo "error: clarus-edge failed to start" >&2
  cat "$TMP/clarus.log" >&2
  exit 1
fi

feed() {
  if [[ "$USE_LIVE" == "1" ]]; then
    python3 "$REPO_ROOT/edgesentry-rs/tools/aisstream_udp_bridge.py" \
      --host "$UDP_HOST" --port "$UDP_PORT" --duration "$DURATION"
  else
    python3 "$REPLAY" "$NMEA" --host "$UDP_HOST" --port "$UDP_PORT" \
      --speed "$SPEED" --duration "$DURATION" --loop
  fi
}

echo "==> Sampling clarus-edge for ${DURATION}s (pid $EDGE_PID)"
feed &
FEED_PID=$!

CPU_MAX=0
RSS_MAX_KB=0
END=$((SECONDS + DURATION))
while [[ $SECONDS -lt $END ]]; do
  if kill -0 "$EDGE_PID" 2>/dev/null; then
    read -r CPU RSS <<<"$(ps -p "$EDGE_PID" -o %cpu= -o rss= 2>/dev/null | tr -d ' ')" || true
    if [[ -n "${CPU:-}" ]]; then
      CPU_INT=$(python3 -c "import math; print(int(math.ceil(float('${CPU}' or 0))))")
      (( CPU_INT > CPU_MAX )) && CPU_MAX=$CPU_INT
      RSS_KB=$RSS
      if [[ "$(uname -s)" == "Darwin" ]]; then
        RSS_KB=$((RSS / 1024))
      fi
      (( RSS_KB > RSS_MAX_KB )) && RSS_MAX_KB=$RSS_KB
    fi
  fi
  sleep 1
done

wait "$FEED_PID" 2>/dev/null || true
kill "$EDGE_PID" 2>/dev/null || true
wait "$EDGE_PID" 2>/dev/null || true

EVENTS=$(python3 -c "
import duckdb
con = duckdb.connect('$DB_PATH', read_only=True)
try:
    n = con.execute('SELECT count(*) FROM audit_chain').fetchone()[0]
except Exception:
    n = 0
print(n)
" 2>/dev/null || echo 0)

RULES=$(python3 -c "
import duckdb
con = duckdb.connect('$DB_PATH', read_only=True)
try:
    rows = con.execute('SELECT DISTINCT rule_id FROM audit_chain').fetchall()
    print(', '.join(r[0] for r in rows) or '(none)')
except Exception:
    print('(none)')
" 2>/dev/null || echo "(none)")

RSS_MB=$(python3 -c "print(f'{$RSS_MAX_KB / 1024:.1f}')")

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  clarus-edge SWaP benchmark (clarus#138)                    │"
echo "├─────────────────────────────────────────────────────────────┤"
printf "│  Source        %-44s │\n" "$([ "$USE_LIVE" = 1 ] && echo live aisstream || echo replay)"
printf "│  Duration      %-44s │\n" "${DURATION}s @ ${SPEED}×"
printf "│  Audit records %-44s │\n" "$EVENTS"
printf "│  Rules fired   %-44s │\n" "$RULES"
printf "│  CPU (max)     %-44s │\n" "${CPU_MAX}%"
printf "│  RSS (max)     %-44s │\n" "${RSS_MB} MB"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
echo "Log: $TMP/clarus.log"
echo "Update edgesentry-commercial c2-annex-a.md after RPi5 hardware run."

if [[ "$EVENTS" -eq 0 ]]; then
  echo "warning: no audit records — check replay / profile / log" >&2
  exit 1
fi

echo "OK"
