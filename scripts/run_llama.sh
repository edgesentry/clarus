#!/usr/bin/env bash
# Start llama-server (llama.cpp) + Caddy HTTPS proxy for the clarus analytics app.
#
# The analytics app calls: https://localhost:8443/v1/chat/completions
#   (Caddy proxies 8443 → 8080 so both Chrome and Safari work without mixed-content issues)
#
# Prerequisites (one-time):
#   macOS:  brew install llama.cpp caddy
#   Linux:  llama.cpp — https://github.com/ggml-org/llama.cpp/releases/latest
#           caddy     — https://caddyserver.com/docs/install
#
# Usage:
#   ./scripts/run_llama.sh
#   ./scripts/run_llama.sh --model bartowski/Llama-3.2-3B-Instruct-GGUF --gguf-file Llama-3.2-3B-Instruct-Q4_K_M.gguf
#   ./scripts/run_llama.sh --port 8080

set -euo pipefail

HF_MODEL="bartowski/Llama-3.2-3B-Instruct-GGUF"
GGUF_FILE="Llama-3.2-3B-Instruct-Q4_K_M.gguf"
PORT="${LLM_PORT:-8080}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)     HF_MODEL="$2"; shift 2 ;;
    --gguf-file) GGUF_FILE="$2"; shift 2 ;;
    --port)      PORT="$2";     shift 2 ;;
    --help|-h)   grep "^#" "$0" | sed 's/^# \{0,2\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

OS="$(uname -s)"
case "${OS}" in Darwin*) OS_NAME="macOS" ;; Linux*) OS_NAME="Linux" ;; *) OS_NAME="${OS}" ;; esac

if ! command -v llama-server &>/dev/null; then
  echo "❌  llama-server not found.  Install: brew install llama.cpp"
  exit 1
fi

GPU_LAYERS=99
[[ "${OS_NAME}" != "macOS" ]] && GPU_LAYERS=0

echo "🤖 Starting llama-server (${OS_NAME})"
echo "   Model    = ${HF_MODEL} (${GGUF_FILE})"
echo "   Endpoint → http://localhost:${PORT}/v1/chat/completions"

EXISTING_PID=$(lsof -ti ":${PORT}" 2>/dev/null | head -1 || true)
if [[ -n "${EXISTING_PID}" ]]; then
  echo "   ♻️  llama-server already running on :${PORT} (PID ${EXISTING_PID}) — reusing"
  LLM_PID="${EXISTING_PID}"
else
  llama-server \
    --hf-repo "${HF_MODEL}" \
    --hf-file "${GGUF_FILE}" \
    --port "${PORT}" \
    --ctx-size 4096 \
    --n-gpu-layers "${GPU_LAYERS}" &
  LLM_PID=$!
fi

echo "   Waiting for server…"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/v1/models" > /dev/null 2>&1; then
    echo "   ✅ llama-server ready → http://localhost:${PORT}/v1"

    # ── Caddy HTTPS proxy (8080 → 8443) ──────────────────────────────────────
    HTTPS_PORT=$((PORT + 363))
    CADDY_PID=""
    if command -v caddy &>/dev/null; then
      caddy reverse-proxy \
        --from "localhost:${HTTPS_PORT}" \
        --to   "localhost:${PORT}" \
        > /tmp/caddy-llama.log 2>&1 &
      CADDY_PID=$!
      CADDY_READY=0
      for _c in $(seq 1 15); do
        ! kill -0 "${CADDY_PID}" 2>/dev/null && break
        curl -sk --max-time 1 "https://localhost:${HTTPS_PORT}/v1/models" > /dev/null 2>&1 \
          && CADDY_READY=1 && break
        sleep 1
      done
      if [[ ${CADDY_READY} -eq 1 ]]; then
        echo "   ✅ Caddy HTTPS proxy  → https://localhost:${HTTPS_PORT}/v1"
        echo "      (Safari: accept the Caddy local-CA cert on first visit)"
      else
        echo "   ❌ Caddy failed — LLM offline in Safari. Check /tmp/caddy-llama.log"
        CADDY_PID=""
      fi
    else
      echo "   ❌ caddy not found — LLM offline in Safari.  Install: brew install caddy"
    fi
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && echo "   ⚠️  llama-server did not respond in 60s"
done
echo ""

_cleanup() {
  echo ""
  [[ -z "${EXISTING_PID}" ]] && kill "${LLM_PID}" 2>/dev/null || true
  [[ -n "${CADDY_PID:-}" ]]  && kill "${CADDY_PID}" 2>/dev/null || true
  echo "Done."
}
trap '_cleanup' EXIT INT TERM

if [[ -z "${EXISTING_PID}" ]]; then
  wait "${LLM_PID}"
else
  echo "   (llama-server is external — press Ctrl+C to stop Caddy)"
  wait "${CADDY_PID:-}" 2>/dev/null || true
fi
