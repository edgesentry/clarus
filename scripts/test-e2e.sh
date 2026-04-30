#!/usr/bin/env bash
# test-e2e.sh — end-to-end pipeline test using the eds CLI from edgesentry-rs.
#
# The Rust engine moved to edgesentry/edgesentry-rs (issue #31).
# This script validates the full pipeline using the `eds` binary.
#
# Usage:
#   ./scripts/test-e2e.sh              # interactive
#   ./scripts/test-e2e.sh --no-pause   # CI / non-interactive
#   ./scripts/test-e2e.sh --no-explain # skip LLM stage
#
# Prerequisites:
#   eds binary in PATH, OR edgesentry-rs built at ../edgesentry-rs/target/debug/eds
#   For explain stage: llama-server running on http://localhost:8080

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
pass()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()   { echo -e "${RED}  ✗ $*${NC}"; exit 1; }
info()   { echo -e "${DIM}    $*${NC}"; }
header() { echo -e "\n${BOLD}━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

NO_PAUSE=0; SKIP_EXPLAIN=0
for arg in "$@"; do
  case $arg in
    --no-pause)   NO_PAUSE=1 ;;
    --no-explain) SKIP_EXPLAIN=1 ;;
  esac
done

pause() {
  [[ "$NO_PAUSE" -eq 1 ]] && return
  echo -e "\n${DIM}  Press Enter to continue…${NC}"; read -r
}

# Prefer local build from edgesentry-rs sibling over any installed binary.
if [[ -x "../edgesentry-rs/target/debug/eds" ]]; then
  EDS="../edgesentry-rs/target/debug/eds"
elif command -v eds &>/dev/null && eds --version 2>/dev/null | grep -qE "^eds [0-9]"; then
  EDS=eds
  warn "Using eds from PATH — ensure it is built from edgesentry-rs"
else
  fail "eds not found. Build edgesentry-rs: cd ../edgesentry-rs && cargo build -p eds"
fi

PROFILE="profiles/demo"
FIXTURE="fixtures/forklift_approach.csv"
LLM_URL="http://localhost:8080"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo -e "${BOLD}clarus end-to-end test (eds pipeline)${NC}"
info "eds     : $EDS"; info "profile : $PROFILE"; info "fixture : $FIXTURE"
echo ""

header "Stage 1 — Ingest (CSV → EntityFrame JSONL)"
"$EDS" ingest replay --source "$FIXTURE" --profile "$PROFILE" --out "$TMP/frames.jsonl"
FRAMES=$(tail -n +2 "$TMP/frames.jsonl" | wc -l | tr -d ' ')
pass "$FRAMES frames written"
pause

header "Stage 2 — Evaluate (EntityFrame → RiskEvent JSONL)"
"$EDS" evaluate run --input "$TMP/frames.jsonl" --profile "$PROFILE" --out "$TMP/events.jsonl"
EVENTS=$(tail -n +2 "$TMP/events.jsonl" | wc -l | tr -d ' ')
pass "$EVENTS risk event(s) detected"

python3 -c "
import json, sys
lines = [l for l in open('$TMP/events.jsonl') if l.strip() and not l.startswith('{\"eds_schema')]
rules = {json.loads(l)['rule_id'] for l in lines}
assert 'PROXIMITY_ALERT' in rules, 'PROXIMITY_ALERT missing'
assert 'TTC_ALERT' in rules, 'TTC_ALERT missing'
" && pass "PROXIMITY_ALERT and TTC_ALERT both fired" || fail "Expected risk events did not fire"
pause

header "Stage 3 — Assess (RiskEvent → Assessment JSONL)"
"$EDS" assess run --input "$TMP/events.jsonl" --out "$TMP/assessment.jsonl"
TREND=$(tail -n +2 "$TMP/assessment.jsonl" | python3 -c "import sys,json; print(json.load(sys.stdin)['trend'])" 2>/dev/null || echo "?")
pass "Assessment complete — trend: $TREND"
pause

header "Stage 4 — Explain (RiskEvent → Explanation JSONL)"
if [[ "$SKIP_EXPLAIN" -eq 1 ]]; then
  warn "Skipped (--no-explain)"
elif ! curl -sf "$LLM_URL/v1/models" >/dev/null 2>&1; then
  warn "llama-server not reachable at $LLM_URL — skipping (start with ./scripts/run_llama.sh)"
else
  "$EDS" explain run --input "$TMP/events.jsonl" --n 2 --pick severity \
    --llm-url "$LLM_URL" --profile "$PROFILE" --out "$TMP/explanations.jsonl"
  EXP=$(tail -n +2 "$TMP/explanations.jsonl" | wc -l | tr -d ' ')
  pass "$EXP explanation(s) written"
fi
pause

header "Stage 5 — Report (Events + Assessment → Markdown)"
"$EDS" report generate \
  --events "$TMP/events.jsonl" --assessment "$TMP/assessment.jsonl" \
  --site-name "Demo Site" --period "$(date '+%B %Y')" --out "$TMP/report.md"
pass "Markdown report written ($(wc -c < "$TMP/report.md" | tr -d ' ') bytes)"

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  All stages passed.${NC}"
info "Full 14-stage demo: bash scripts/run_local_demo.sh --no-pause (from edgesentry-rs)"
