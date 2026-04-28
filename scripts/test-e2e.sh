#!/usr/bin/env bash
# End-to-end test script for clarus.
#
# Stages:
#   1. Build        — cargo build
#   2. Unit tests   — cargo test
#   3. CSV replay   — fixture file without Ollama (always runs)
#   4. Explain      — CSV replay with --explain via Ollama (skipped if Ollama unavailable)
#   5. Live UDP     — sim-unity-udp.py sends packets; clarus reads them (skipped if Python absent)
#   6. Audit seal   — replay with --audit-key; verify AuditRecord chain linkage
#
# Usage:
#   ./scripts/test-e2e.sh                  # run all stages
#   ./scripts/test-e2e.sh --no-explain     # skip llama-server stage
#   ./scripts/test-e2e.sh --no-udp         # skip live UDP stage
#   ./scripts/test-e2e.sh --no-audit       # skip audit seal stage

set -euo pipefail
cd "$(dirname "$0")/.."

# ── colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
pass()  { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ $*${NC}"; }
header(){ echo -e "\n${BOLD}━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ── arg parsing ───────────────────────────────────────────────────────────────
SKIP_EXPLAIN=0; SKIP_UDP=0; SKIP_AUDIT=0
for arg in "$@"; do
  case $arg in
    --no-explain) SKIP_EXPLAIN=1 ;;
    --no-udp)     SKIP_UDP=1 ;;
    --no-audit)   SKIP_AUDIT=1 ;;
  esac
done

PROFILE="profiles/sg-port-safety"
FIXTURE="fixtures/forklift_approach.csv"
LLM_URL="http://localhost:8080"
UDP_ADDR="127.0.0.1:9100"   # use 9100 to avoid conflicting with other processes

echo -e "${BOLD}clarus end-to-end test${NC}"
echo    "  profile : $PROFILE"
echo    "  fixture : $FIXTURE"
echo    "  llm-url : $LLM_URL (model auto-discovered)"
ERRORS=0

# ── stage 1: build ────────────────────────────────────────────────────────────
header "Stage 1 — Build"
if cargo build --bin clarus 2>&1; then
  pass "cargo build succeeded"
else
  fail "cargo build failed"; exit 1
fi

# ── stage 2: unit tests ───────────────────────────────────────────────────────
header "Stage 2 — Unit tests"
TEST_OUT=$(cargo test 2>&1)
TOTAL=$(echo "$TEST_OUT" | grep -E "^test result" | awk '{sum+=$4} END{print sum}')
FAILED=$(echo "$TEST_OUT" | grep -E "^test result" | awk '{sum+=$6} END{print sum}')
if [[ "$FAILED" == "0" ]]; then
  pass "$TOTAL tests passed"
else
  fail "$FAILED tests failed"; ERRORS=$((ERRORS+1))
fi

# ── stage 3: CSV replay (no Ollama) ──────────────────────────────────────────
header "Stage 3 — CSV replay (rule engine, no Ollama)"
if [[ ! -f "$FIXTURE" ]]; then
  fail "Fixture not found: $FIXTURE"; ERRORS=$((ERRORS+1))
else
  REPLAY_OUT=$(cargo run --bin clarus -- --input "file://$FIXTURE" --profile "$PROFILE" 2>&1)
  RULE_LINES=$(echo "$REPLAY_OUT" | grep -c "^\\[t=.*\\] RISK" || true)
  REPLAY_COMPLETE=$(echo "$REPLAY_OUT" | grep -c "Replay complete" || true)
  if [[ "$REPLAY_COMPLETE" -eq 1 && "$RULE_LINES" -gt 0 ]]; then
    pass "Replay complete — $RULE_LINES risk events fired"
    # spot-check: MPA_CLEARANCE_5M must appear
    if echo "$REPLAY_OUT" | grep -q "MPA_CLEARANCE_5M"; then
      pass "MPA_CLEARANCE_5M rule fired (expected)"
    else
      fail "MPA_CLEARANCE_5M did not fire"; ERRORS=$((ERRORS+1))
    fi
    # spot-check: TTC_CRITICAL_3S must appear
    if echo "$REPLAY_OUT" | grep -q "TTC_CRITICAL_3S"; then
      pass "TTC_CRITICAL_3S rule fired (expected)"
    else
      fail "TTC_CRITICAL_3S did not fire"; ERRORS=$((ERRORS+1))
    fi
  else
    fail "Replay did not complete or no events fired"
    echo "$REPLAY_OUT"
    ERRORS=$((ERRORS+1))
  fi
fi

# ── stage 4: CSV replay with --explain ───────────────────────────────────────
header "Stage 4 — CSV replay with --explain (llama-server)"
if [[ "$SKIP_EXPLAIN" -eq 1 ]]; then
  warn "Skipped (--no-explain)"
else
  # check llama-server is reachable
  if ! curl -sf "$LLM_URL/v1/models" > /dev/null 2>&1; then
    warn "llama-server not reachable at $LLM_URL — skipping explain stage"
    warn "To start: ./scripts/run_llama.sh"
  else
    pass "llama-server reachable at $LLM_URL"

    EXPLAIN_OUT=$(cargo run --bin clarus -- \
      --input "file://$FIXTURE" \
      --profile "$PROFILE" \
      --explain \
      --llm-url "$LLM_URL" 2>&1)

    EXPLAIN_LINES=$(echo "$EXPLAIN_OUT" | grep -c "\\[EXPLANATION" || true)
    UNGROUNDED=$(echo "$EXPLAIN_OUT" | grep -c "ungrounded" || true)

    if [[ "$EXPLAIN_LINES" -gt 0 ]]; then
      pass "$EXPLAIN_LINES explanation(s) generated"
      if [[ "$UNGROUNDED" -gt 0 ]]; then
        warn "$UNGROUNDED explanation(s) flagged as ungrounded (hallucinated clause detected)"
      else
        pass "All explanations grounded"
      fi
      # print first explanation for visual confirmation
      echo
      echo "$EXPLAIN_OUT" | grep "\\[EXPLANATION" | head -1
      echo
    else
      fail "No explanations generated"; ERRORS=$((ERRORS+1))
      echo "$EXPLAIN_OUT" | tail -20
    fi
  fi
fi

# ── stage 5: live UDP ─────────────────────────────────────────────────────────
header "Stage 5 — Live UDP (sim-unity-udp.py → clarus)"
if [[ "$SKIP_UDP" -eq 1 ]]; then
  warn "Skipped (--no-udp)"
elif ! command -v python3 &>/dev/null; then
  warn "python3 not found — skipping UDP stage"
else
  SCRIPT="scripts/sim-unity-udp.py"
  if [[ ! -f "$SCRIPT" ]]; then
    warn "$SCRIPT not found — skipping UDP stage"
  else
    # start clarus listening on UDP in background
    cargo run --bin clarus -- \
      --input "udp://$UDP_ADDR" \
      --profile "$PROFILE" > /tmp/clarus-udp.log 2>&1 &
    CLARUS_PID=$!

    # give the socket time to bind
    sleep 1

    # send 5 packets via the simulator
    python3 "$SCRIPT" --addr "$UDP_ADDR" --count 5 --interval 0.2 2>&1

    # give clarus time to process
    sleep 1
    kill "$CLARUS_PID" 2>/dev/null || true
    wait "$CLARUS_PID" 2>/dev/null || true

    UDP_EVENTS=$(grep -c "RISK" /tmp/clarus-udp.log 2>/dev/null || true)
    if [[ "$UDP_EVENTS" -gt 0 ]]; then
      pass "Live UDP: $UDP_EVENTS risk events received and processed"
    else
      fail "Live UDP: no risk events processed"
      cat /tmp/clarus-udp.log
      ERRORS=$((ERRORS+1))
    fi
  fi
fi

# ── stage 6: audit seal ───────────────────────────────────────────────────────
header "Stage 6 — Audit seal (RiskEvent → AuditRecord chain)"
if [[ "$SKIP_AUDIT" -eq 1 ]]; then
  warn "Skipped (--no-audit)"
elif ! command -v python3 &>/dev/null; then
  warn "python3 not found — skipping audit stage"
else
  # deterministic test vector (01 × 32 bytes) — fine for CI, never use in production
  AUDIT_KEY="0101010101010101010101010101010101010101010101010101010101010101"
  CHAIN_FILE="/tmp/clarus-audit-chain.json"

  AUDIT_OUT=$(cargo run --bin clarus -- \
    --input "file://$FIXTURE" \
    --profile "$PROFILE" \
    --audit-key "$AUDIT_KEY" \
    --device-id "clarus-e2e" 2>&1)

  RECORD_COUNT=$(echo "$AUDIT_OUT" | grep -c "^\s*\[AUDIT\]" || true)
  if [[ "$RECORD_COUNT" -eq 0 ]]; then
    fail "No AuditRecords produced"; ERRORS=$((ERRORS+1))
  else
    pass "$RECORD_COUNT AuditRecord(s) sealed"

    # extract chain to JSON
    echo "$AUDIT_OUT" \
      | grep "^\s*\[AUDIT\]" \
      | sed 's/.*\[AUDIT\] //' \
      | python3 -c "import sys,json; print(json.dumps([json.loads(l) for l in sys.stdin]))" \
      > "$CHAIN_FILE"

    # verify sequence ordering and prev_record_hash linkage
    if python3 - "$CHAIN_FILE" <<'PYEOF'
import sys, json
records = json.load(open(sys.argv[1]))
for i, rec in enumerate(records):
    assert rec["sequence"] == i + 1, f"record {i}: sequence mismatch"
    if i > 0:
        assert rec["prev_record_hash"] != [0]*32, f"record {i}: prev_hash is zero"
PYEOF
    then
      pass "Chain linkage verified (${RECORD_COUNT} records, sequences + prev_record_hash)"
    else
      fail "Chain linkage check failed"; ERRORS=$((ERRORS+1))
    fi

    # spot-check rule IDs appear in object_ref
    if python3 -c "import json,sys; d=json.load(open('$CHAIN_FILE')); sys.exit(0 if any('MPA_CLEARANCE_5M' in r['object_ref'] for r in d) else 1)"; then
      pass "MPA_CLEARANCE_5M sealed in chain"
    else
      fail "MPA_CLEARANCE_5M missing from chain"; ERRORS=$((ERRORS+1))
    fi
    if python3 -c "import json,sys; d=json.load(open('$CHAIN_FILE')); sys.exit(0 if any('TTC_CRITICAL_3S' in r['object_ref'] for r in d) else 1)"; then
      pass "TTC_CRITICAL_3S sealed in chain"
    else
      fail "TTC_CRITICAL_3S missing from chain"; ERRORS=$((ERRORS+1))
    fi
  fi
fi

# ── summary ───────────────────────────────────────────────────────────────────
header "Summary"
if [[ "$ERRORS" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  All stages passed.${NC}"
else
  echo -e "${RED}${BOLD}  $ERRORS stage(s) failed.${NC}"
  exit 1
fi
