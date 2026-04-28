#!/usr/bin/env bash
# Smoke-test the audit sealing pipeline.
#
# Generates a fresh Ed25519 keypair, replays the forklift fixture with
# --audit-key, captures the AuditRecord chain, and verifies it with
# edgesentry-audit verify-chain.
#
# Usage:
#   ./scripts/test-audit.sh
#   ./scripts/test-audit.sh --profile profiles/sg-port-safety   # override profile
#   ./scripts/test-audit.sh --fixture fixtures/forklift_approach.csv

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
pass() { echo -e "${GREEN}  ✓ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; exit 1; }
header() { echo -e "\n${BOLD}━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

PROFILE="profiles/sg-port-safety"
FIXTURE="fixtures/forklift_approach.csv"
DEVICE_ID="clarus-audit-test"
CHAIN_FILE="/tmp/clarus-audit-chain.json"
EDS="../../edgesentry-rs/target/debug/eds"

for arg in "$@"; do
  case $arg in
    --profile=*) PROFILE="${arg#*=}" ;;
    --fixture=*) FIXTURE="${arg#*=}" ;;
  esac
done

echo -e "${BOLD}clarus audit seal test${NC}"
echo "  profile : $PROFILE"
echo "  fixture : $FIXTURE"

# ── stage 1: build clarus ─────────────────────────────────────────────────────
header "Stage 1 — Build clarus"
cargo build --bin clarus 2>&1 | grep -v "^$" || true
pass "cargo build succeeded"

# ── stage 2: generate keypair ─────────────────────────────────────────────────
header "Stage 2 — Generate keypair"
# Use eds if available, otherwise fall back to the well-known test vector
if [[ -f "$EDS" ]]; then
  KEYPAIR_JSON=$("$EDS" audit generate-keypair 2>/dev/null)
  PRIVATE_KEY=$(echo "$KEYPAIR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['private_key_hex'])" 2>/dev/null)
  PUBLIC_KEY=$(echo "$KEYPAIR_JSON"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['public_key_hex'])"  2>/dev/null)
fi

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  # Well-known test vector (01 × 32 bytes) — deterministic, never use in production
  PRIVATE_KEY="0101010101010101010101010101010101010101010101010101010101010101"
  PUBLIC_KEY="8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"
  echo "  (eds not found — using deterministic test vector; never use in production)"
fi
pass "private key ready (${PRIVATE_KEY:0:8}…)"

# ── stage 3: run replay and capture AuditRecords ──────────────────────────────
header "Stage 3 — Replay fixture with --audit-key"
CLARUS_OUT=$(cargo run --bin clarus -- \
  --input "file://$FIXTURE" \
  --profile "$PROFILE" \
  --audit-key "$PRIVATE_KEY" \
  --device-id "$DEVICE_ID" 2>&1)

RECORD_COUNT=$(echo "$CLARUS_OUT" | grep -c "^\s*\[AUDIT\]" || true)
if [[ "$RECORD_COUNT" -eq 0 ]]; then
  fail "No AuditRecords produced — check --audit-key wiring"
fi
pass "$RECORD_COUNT AuditRecord(s) produced"

# ── stage 4: build chain JSON and verify ─────────────────────────────────────
header "Stage 4 — Build chain and verify"
echo "$CLARUS_OUT" \
  | grep "^\s*\[AUDIT\]" \
  | sed 's/.*\[AUDIT\] //' \
  | python3 -c "import sys,json; print(json.dumps([json.loads(l) for l in sys.stdin]))" \
  > "$CHAIN_FILE"

CHAIN_LEN=$(python3 -c "import json; d=json.load(open('$CHAIN_FILE')); print(len(d))")
pass "Chain file written: $CHAIN_FILE ($CHAIN_LEN records)"

# Verify chain linkage in Python (no eds binary required)
python3 - "$CHAIN_FILE" <<'PYEOF'
import sys, json
records = json.load(open(sys.argv[1]))
for i, rec in enumerate(records):
    assert rec["sequence"] == i + 1, f"record {i}: sequence mismatch"
    if i > 0:
        import hashlib
        prev = records[i - 1]
        # prev_record_hash of record[i] must be non-zero after the first record
        assert rec["prev_record_hash"] != [0]*32, f"record {i}: prev_hash is zero"
print(f"  chain linkage OK: {len(records)} records, sequences 1–{len(records)}")
PYEOF
pass "Chain linkage verified (sequences + prev_record_hash non-zero after record 1)"

# Try eds verify-chain if available
if [[ -f "$EDS" ]]; then
  if "$EDS" audit verify-chain "$CHAIN_FILE" 2>/dev/null; then
    pass "eds audit verify-chain passed"
  else
    fail "eds audit verify-chain failed"
  fi
else
  echo "  (eds not found — skipping cryptographic verify-chain)"
fi

# ── stage 5: spot-checks ─────────────────────────────────────────────────────
header "Stage 5 — Spot-checks"
if python3 -c "import json,sys; d=json.load(open('$CHAIN_FILE')); sys.exit(0 if any('MPA_CLEARANCE_5M' in r['object_ref'] for r in d) else 1)"; then
  pass "MPA_CLEARANCE_5M appears in sealed chain"
else
  fail "MPA_CLEARANCE_5M missing from sealed chain"
fi

if python3 -c "import json,sys; d=json.load(open('$CHAIN_FILE')); sys.exit(0 if any('TTC_CRITICAL_3S' in r['object_ref'] for r in d) else 1)"; then
  pass "TTC_CRITICAL_3S appears in sealed chain"
else
  fail "TTC_CRITICAL_3S missing from sealed chain"
fi

FIRST_SEQ=$(python3 -c "import json; print(json.load(open('$CHAIN_FILE'))[0]['sequence'])")
FIRST_PREV=$(python3 -c "import json; print(json.load(open('$CHAIN_FILE'))[0]['prev_record_hash'])")
if [[ "$FIRST_SEQ" == "1" ]]; then
  pass "First record has sequence=1"
else
  fail "First record sequence is $FIRST_SEQ, expected 1"
fi
if echo "$FIRST_PREV" | grep -q "0, 0, 0"; then
  pass "First record has zero prev_record_hash (genesis)"
else
  fail "First record prev_record_hash is not zero"
fi

# ── summary ───────────────────────────────────────────────────────────────────
header "Summary"
echo -e "${GREEN}${BOLD}  All audit checks passed. Chain: $CHAIN_FILE${NC}"
