#!/usr/bin/env bash
# End-to-end test script for clarus.
#
# Stages:
#   1. Build        — cargo build
#   2. Unit tests   — cargo test
#   3. CSV replay   — rule engine only, no LLM (always runs)
#   4. Explain      — CSV replay with --explain via llama-server (skipped if server not running)
#   5. Live UDP     — sim-unity-udp.py sends packets; clarus reads them (skipped if Python absent)
#   6. Audit seal   — replay with --audit-key; verify AuditRecord chain linkage
#
# Usage:
#   ./scripts/test-e2e.sh                  # run all stages
#   ./scripts/test-e2e.sh --no-explain     # skip llama-server stage
#   ./scripts/test-e2e.sh --no-udp         # skip live UDP stage
#   ./scripts/test-e2e.sh --no-audit       # skip audit seal stage
#   ./scripts/test-e2e.sh --no-pause       # run without pausing between stages (CI mode)

set -euo pipefail
cd "$(dirname "$0")/.."

# ── colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
pass()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()   { echo -e "${RED}  ✗ $*${NC}"; }
info()   { echo -e "${DIM}    $*${NC}"; }
header() { echo -e "\n${BOLD}━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ── arg parsing ───────────────────────────────────────────────────────────────
SKIP_EXPLAIN=0; SKIP_UDP=0; SKIP_AUDIT=0; NO_PAUSE=0
for arg in "$@"; do
  case $arg in
    --no-explain) SKIP_EXPLAIN=1 ;;
    --no-udp)     SKIP_UDP=1 ;;
    --no-audit)   SKIP_AUDIT=1 ;;
    --no-pause)   NO_PAUSE=1 ;;
  esac
done

PROFILE="profiles/sg-port-safety"
FIXTURE="fixtures/forklift_approach.csv"
LLM_URL="http://localhost:8080"
UDP_ADDR="127.0.0.1:9100"

pause() {
  if [[ "$NO_PAUSE" -eq 0 ]]; then
    echo ""
    echo -e "${DIM}  Press Enter to continue to the next stage…${NC}"
    read -r
  fi
}

echo -e "${BOLD}clarus end-to-end test${NC}"
echo    "  profile  : $PROFILE"
echo    "  fixture  : $FIXTURE"
echo    "  llm-url  : $LLM_URL"
echo    ""
echo    "  Tests the full pipeline: Rust engine → LLM explanation → tamper-proof audit chain."
echo    "  Run with --no-pause to skip prompts (useful in CI)."
ERRORS=0

# ── stage 1: build ────────────────────────────────────────────────────────────
header "Stage 1 — Build"
echo ""
info "Compiling the clarus binary from source."
info "This catches any Rust compilation errors before running tests."
echo ""
if cargo build --bin clarus 2>&1; then
  pass "cargo build succeeded — binary is ready"
else
  fail "cargo build failed — fix compilation errors before continuing"
  exit 1
fi
pause

# ── stage 2: unit tests ───────────────────────────────────────────────────────
header "Stage 2 — Unit tests"
echo ""
info "Running all unit tests across engine, explanation, and input-adapter crates."
info "These tests verify physics primitives, rule evaluation, LLM client,"
info "CSV parsing, UDP parsing, and the audit seal/verify round-trip."
echo ""
TEST_OUT=$(cargo test 2>&1)
TOTAL=$(echo "$TEST_OUT" | grep -E "^test result" | awk '{sum+=$4} END{print sum}')
FAILED=$(echo "$TEST_OUT" | grep -E "^test result" | awk '{sum+=$6} END{print sum}')
if [[ "$FAILED" == "0" ]]; then
  pass "$TOTAL unit tests passed"
else
  fail "$FAILED test(s) failed — see output below"
  echo "$TEST_OUT" | grep "FAILED"
  ERRORS=$((ERRORS+1))
fi
pause

# ── stage 3: CSV replay (no LLM) ─────────────────────────────────────────────
header "Stage 3 — CSV replay (rule engine only)"
echo ""
info "Replaying a pre-recorded forklift-approach scenario through the rule engine."
info "No LLM is involved — this validates the physics and rule evaluation pipeline"
info "end-to-end using a deterministic fixture (15 frames, 2 entities)."
info ""
info "Spot-checks:"
info "  · MPA_CLEARANCE_5M  — clearance drops below 5 m threshold"
info "  · TTC_CRITICAL_3S   — time-to-collision drops below 3 s threshold"
echo ""
if [[ ! -f "$FIXTURE" ]]; then
  fail "Fixture not found: $FIXTURE"
  ERRORS=$((ERRORS+1))
else
  REPLAY_OUT=$(cargo run --bin clarus -- --input "file://$FIXTURE" --profile "$PROFILE" 2>&1)
  RULE_LINES=$(echo "$REPLAY_OUT" | grep -c "^\\[t=.*\\] RISK" || true)
  REPLAY_COMPLETE=$(echo "$REPLAY_OUT" | grep -c "Replay complete" || true)
  if [[ "$REPLAY_COMPLETE" -eq 1 && "$RULE_LINES" -gt 0 ]]; then
    pass "Replay complete — $RULE_LINES risk events fired across 15 frames"
    if echo "$REPLAY_OUT" | grep -q "MPA_CLEARANCE_5M"; then
      pass "MPA_CLEARANCE_5M fired — forklift breached 5 m minimum clearance"
    else
      fail "MPA_CLEARANCE_5M did not fire"; ERRORS=$((ERRORS+1))
    fi
    if echo "$REPLAY_OUT" | grep -q "TTC_CRITICAL_3S"; then
      pass "TTC_CRITICAL_3S fired — time-to-collision dropped below 3 s"
    else
      fail "TTC_CRITICAL_3S did not fire"; ERRORS=$((ERRORS+1))
    fi
  else
    fail "Replay did not complete or no risk events fired"
    echo "$REPLAY_OUT"
    ERRORS=$((ERRORS+1))
  fi
fi
pause

# ── stage 4: CSV replay with --explain ───────────────────────────────────────
header "Stage 4 — LLM explanation (llama-server)"
echo ""
info "Sending each RiskEvent to a local LLM to generate a plain-language alert"
info "with a verifiable regulation citation."
info ""
info "The grounding check rejects any LLM output that cites a regulation clause"
info "(§N.N) that is not present in the KB snippet — catching hallucinations."
info ""
info "Uses a 1-frame fixture (4 events) to keep this stage fast."
info "Start the LLM server first if not running:  ./scripts/run_llama.sh"
echo ""
if [[ "$SKIP_EXPLAIN" -eq 1 ]]; then
  warn "Skipped (--no-explain)"
elif ! curl -sf "$LLM_URL/v1/models" > /dev/null 2>&1; then
  warn "llama-server not reachable at $LLM_URL — skipping"
  warn "To start: ./scripts/run_llama.sh"
else
  MODEL_ID=$(curl -sf "$LLM_URL/v1/models" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null || echo "unknown")
  pass "llama-server reachable — model: $MODEL_ID"
  echo ""

  EXPLAIN_OUT=$(cargo run --bin clarus -- \
    --input "file://fixtures/forklift_approach_1frame.csv" \
    --profile "$PROFILE" \
    --explain \
    --llm-url "$LLM_URL" 2>&1)

  EXPLAIN_LINES=$(echo "$EXPLAIN_OUT" | grep -c "\\[EXPLANATION" || true)
  UNGROUNDED=$(echo "$EXPLAIN_OUT" | grep -c "ungrounded" || true)
  ERRORS_LLM=$(echo "$EXPLAIN_OUT" | grep -c "EXPLANATION ERROR" || true)

  if [[ "$EXPLAIN_LINES" -gt 0 ]]; then
    pass "$EXPLAIN_LINES explanation(s) generated"
    if [[ "$UNGROUNDED" -gt 0 ]]; then
      warn "$UNGROUNDED explanation(s) flagged as ungrounded — LLM cited a clause not in the KB"
    else
      pass "All explanations grounded — no hallucinated regulation clauses"
    fi
    if [[ "$ERRORS_LLM" -gt 0 ]]; then
      warn "$ERRORS_LLM explanation(s) failed — see output above"
    fi
    echo ""
    info "Sample explanation:"
    echo "$EXPLAIN_OUT" | grep "\\[EXPLANATION" | head -1
    echo ""
  else
    fail "No explanations generated"
    echo "$EXPLAIN_OUT" | tail -20
    ERRORS=$((ERRORS+1))
  fi
fi
pause

# ── stage 5: live UDP ─────────────────────────────────────────────────────────
header "Stage 5 — Live UDP (sim-unity-udp.py → clarus)"
echo ""
info "Simulates a live Unity scene by sending UDP packets to clarus."
info "The simulator (sim-unity-udp.py) generates 5 forklift-approach frames"
info "at 5 Hz, mimicking real-time sensor output from a Unity environment."
info "clarus listens on udp://$UDP_ADDR and processes each packet through"
info "the rule engine, exactly as it would in a live deployment."
echo ""
if [[ "$SKIP_UDP" -eq 1 ]]; then
  warn "Skipped (--no-udp)"
elif ! command -v python3 &>/dev/null; then
  warn "python3 not found — skipping UDP stage"
else
  SCRIPT="scripts/sim-unity-udp.py"
  if [[ ! -f "$SCRIPT" ]]; then
    warn "$SCRIPT not found — skipping UDP stage"
  else
    info "Starting clarus in UDP listen mode…"
    cargo run --bin clarus -- \
      --input "udp://$UDP_ADDR" \
      --profile "$PROFILE" > /tmp/clarus-udp.log 2>&1 &
    CLARUS_PID=$!
    sleep 1

    info "Sending 5 simulated frames from sim-unity-udp.py…"
    python3 "$SCRIPT" --addr "$UDP_ADDR" --count 5 --interval 0.2 2>&1

    sleep 1
    kill "$CLARUS_PID" 2>/dev/null || true
    wait "$CLARUS_PID" 2>/dev/null || true

    UDP_EVENTS=$(grep -c "RISK" /tmp/clarus-udp.log 2>/dev/null || true)
    if [[ "$UDP_EVENTS" -gt 0 ]]; then
      pass "Live UDP: $UDP_EVENTS risk events received and processed in real time"
    else
      fail "Live UDP: no risk events processed — check /tmp/clarus-udp.log"
      cat /tmp/clarus-udp.log
      ERRORS=$((ERRORS+1))
    fi
  fi
fi
pause

# ── stage 6: audit seal ───────────────────────────────────────────────────────
header "Stage 6 — Audit seal (RiskEvent → AuditRecord chain)"
echo ""
info "Replays the full fixture with --audit-key to produce a tamper-proof"
info "AuditRecord chain using BLAKE3 hashing and Ed25519 signing."
info ""
info "Each AuditRecord contains:"
info "  · rule_id, regulation, measured value — what happened"
info "  · BLAKE3 hash of the payload           — content integrity"
info "  · Ed25519 signature                    — authenticity"
info "  · prev_record_hash                     — chain linkage (like a blockchain)"
info ""
info "The chain is then verified: sequence numbers must be contiguous and each"
info "record must reference the hash of the previous one."
echo ""
if [[ "$SKIP_AUDIT" -eq 1 ]]; then
  warn "Skipped (--no-audit)"
elif ! command -v python3 &>/dev/null; then
  warn "python3 not found — skipping audit stage"
else
  AUDIT_KEY="0101010101010101010101010101010101010101010101010101010101010101"
  CHAIN_FILE="/tmp/clarus-audit-chain.json"
  info "Using deterministic test key (01×32 bytes) — never use this in production."
  echo ""

  AUDIT_OUT=$(cargo run --bin clarus -- \
    --input "file://$FIXTURE" \
    --profile "$PROFILE" \
    --audit-key "$AUDIT_KEY" \
    --device-id "clarus-e2e" 2>&1)

  RECORD_COUNT=$(echo "$AUDIT_OUT" | grep -c "^\s*\[AUDIT\]" || true)
  if [[ "$RECORD_COUNT" -eq 0 ]]; then
    fail "No AuditRecords produced — check --audit-key wiring"
    ERRORS=$((ERRORS+1))
  else
    pass "$RECORD_COUNT AuditRecord(s) sealed (one per RiskEvent)"

    echo "$AUDIT_OUT" \
      | grep "^\s*\[AUDIT\]" \
      | sed 's/.*\[AUDIT\] //' \
      | python3 -c "import sys,json; print(json.dumps([json.loads(l) for l in sys.stdin]))" \
      > "$CHAIN_FILE"

    if python3 - "$CHAIN_FILE" <<'PYEOF'
import sys, json
records = json.load(open(sys.argv[1]))
for i, rec in enumerate(records):
    assert rec["sequence"] == i + 1, f"record {i}: sequence mismatch"
    if i > 0:
        assert rec["prev_record_hash"] != [0]*32, f"record {i}: prev_hash is zero"
PYEOF
    then
      pass "Chain linkage verified — sequences contiguous, prev_record_hash linked"
    else
      fail "Chain linkage check failed"; ERRORS=$((ERRORS+1))
    fi

    if python3 -c "import json,sys; d=json.load(open('$CHAIN_FILE')); sys.exit(0 if any('MPA_CLEARANCE_5M' in r['object_ref'] for r in d) else 1)"; then
      pass "MPA_CLEARANCE_5M events are in the sealed chain"
    else
      fail "MPA_CLEARANCE_5M missing from chain"; ERRORS=$((ERRORS+1))
    fi
    if python3 -c "import json,sys; d=json.load(open('$CHAIN_FILE')); sys.exit(0 if any('TTC_CRITICAL_3S' in r['object_ref'] for r in d) else 1)"; then
      pass "TTC_CRITICAL_3S events are in the sealed chain"
    else
      fail "TTC_CRITICAL_3S missing from chain"; ERRORS=$((ERRORS+1))
    fi

    echo ""
    info "Chain written to $CHAIN_FILE — inspect with: python3 -m json.tool $CHAIN_FILE | head -40"
  fi
fi
pause

# ── summary ───────────────────────────────────────────────────────────────────
header "Summary"
echo ""
if [[ "$ERRORS" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  All stages passed.${NC}"
  echo ""
  info "The clarus pipeline is working end-to-end:"
  info "  CSV/UDP input → rule engine → LLM explanation → tamper-proof audit chain"
else
  echo -e "${RED}${BOLD}  $ERRORS stage(s) failed.${NC}"
  exit 1
fi
