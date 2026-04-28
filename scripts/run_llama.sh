#!/usr/bin/env bash
# Start llama-server (llama.cpp) as a local OpenAI-compatible endpoint for
# the clarus --explain pipeline.
#
# clarus calls: http://localhost:8080/v1/chat/completions
#
# Prerequisites (one-time):
#   macOS:   brew install llama.cpp
#   Linux:   download pre-built binary from https://github.com/ggml-org/llama.cpp/releases/latest
#            e.g. llama-<tag>-bin-ubuntu-x64.zip  →  unzip, add llama-server to PATH
#   Windows: download https://github.com/ggml-org/llama.cpp/releases/latest
#            e.g. llama-<tag>-bin-win-avx2-x64.zip  →  unzip, add llama-server.exe to PATH
#
# Usage:
#   ./scripts/run_llama.sh
#   ./scripts/run_llama.sh --model bartowski/Llama-3.2-3B-Instruct-GGUF --gguf-file Llama-3.2-3B-Instruct-Q4_K_M.gguf
#   ./scripts/run_llama.sh --port 8081
#
# Options:
#   --model     HF repo  (default: bartowski/Llama-3.2-3B-Instruct-GGUF)
#   --gguf-file filename (default: Llama-3.2-3B-Instruct-Q4_K_M.gguf)
#   --port      port     (default: 8080)

set -euo pipefail

HF_MODEL="bartowski/Llama-3.2-3B-Instruct-GGUF"
GGUF_FILE="Llama-3.2-3B-Instruct-Q4_K_M.gguf"
PORT="${LLM_PORT:-8080}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)     HF_MODEL="$2"; shift 2 ;;
    --gguf-file) GGUF_FILE="$2"; shift 2 ;;
    --port)      PORT="$2";     shift 2 ;;
    --help|-h)
      sed -n '/^# Usage/,/^[^#]/{ /^[^#]/d; s/^# \{0,2\}//; p }' "$0"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

OS="$(uname -s)"
case "${OS}" in
  Darwin*)               OS_NAME="macOS" ;;
  Linux*)                OS_NAME="Linux" ;;
  MINGW*|MSYS*|CYGWIN*)  OS_NAME="Windows" ;;
  *)                     OS_NAME="${OS}" ;;
esac

if ! command -v llama-server &>/dev/null; then
  echo "llama-server not found. Install llama.cpp:"
  case "${OS_NAME}" in
    macOS)   echo "  brew install llama.cpp" ;;
    Linux)   echo "  https://github.com/ggml-org/llama.cpp/releases/latest" ;;
    Windows) echo "  https://github.com/ggml-org/llama.cpp/releases/latest" ;;
  esac
  exit 1
fi

# macOS: Metal GPU acceleration. Linux/Windows: CPU unless CUDA build is used.
GPU_LAYERS=99
if [[ "${OS_NAME}" != "macOS" ]]; then
  GPU_LAYERS=0
fi

# Reuse an existing server on this port rather than binding a second instance.
EXISTING_PID=$(lsof -ti ":${PORT}" 2>/dev/null | head -1 || true)
if [[ -n "${EXISTING_PID}" ]]; then
  echo "llama-server already running on :${PORT} (PID ${EXISTING_PID}) — reusing"
  LLM_PID="${EXISTING_PID}"
else
  echo "Starting llama-server (${OS_NAME})"
  echo "  model    = ${HF_MODEL} / ${GGUF_FILE}"
  echo "  endpoint = http://localhost:${PORT}/v1/chat/completions"
  echo "  Press Ctrl+C to stop."
  echo ""
  llama-server \
    --hf-repo "${HF_MODEL}" \
    --hf-file "${GGUF_FILE}" \
    --port "${PORT}" \
    --ctx-size 4096 \
    --n-gpu-layers "${GPU_LAYERS}" \
    &
  LLM_PID=$!
fi

# Wait for readiness
echo "Waiting for server to be ready…"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/v1/models" > /dev/null 2>&1; then
    echo "llama-server ready → http://localhost:${PORT}/v1"
    echo ""
    echo "Run clarus with --explain:"
    echo "  cargo run --bin clarus -- \\"
    echo "    --input file://fixtures/forklift_approach.csv \\"
    echo "    --profile profiles/demo \\"
    echo "    --explain --llm-url http://localhost:${PORT}"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "llama-server did not respond in 60s — check output above"
  fi
done

echo ""

_cleanup() {
  echo ""
  if [[ -z "${EXISTING_PID}" ]]; then
    echo "Shutting down llama-server…"
    kill "${LLM_PID}" 2>/dev/null || true
  fi
  echo "Done."
}
trap '_cleanup' EXIT INT TERM

if [[ -z "${EXISTING_PID}" ]]; then
  wait "${LLM_PID}"
fi
