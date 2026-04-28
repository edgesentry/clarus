# clarus

A physics-based safety and security engine for ports, construction sites, and critical infrastructure.

clarus enforces known safety regulations — consistently, at machine speed, on every shift — and produces tamper-proof evidence that it was doing so.

---

## What it does

Existing safety AI detects that two objects are close. clarus detects *why* that proximity is dangerous — using physics, not pattern-matching — and generates a cryptographically signed record admissible in regulatory investigations and insurance claims.

```
Input (CCTV, AIS, or simulation coordinates)
    ↓
Rust physics engine
  computes: distance, relative velocity, braking distance, time-to-collision
  evaluates: against encoded safety regulations (MPA, MOM WSH Act, COLREGs)
  fires:     RiskEvent { rule_id, measured_value, threshold, regulation_citation }
    ↓
Local LLM (no cloud)
  produces: plain-language alert with exact regulation clause
  e.g. "Forklift 01 is 3.2 m from Worker 03 — below the 5 m minimum required
        under MPA Port Safety Circular No. 14 of 2023 §3.1. Braking distance
        at current speed is 4.1 m. Collision window: 2.3 s."
    ↓
edgesentry-audit
  seals: every event with BLAKE3 + Ed25519 cryptographic signature
  chain: tamper-proof hash chain across all records
  output: AuditRecord { timestamp, rule, measured_value, threshold,
                        regulation_citation, sensor_hash, signature }
```

---

## Why physics, not AI inference

Every camera-vision safety system on the market uses the same logic: two objects are close → alert fires. This produces alert fatigue — operators ignore the system within weeks because it fires on every routine safe pass.

clarus computes what matters: given the forklift's current speed, what is its stopping distance? Is the remaining clearance smaller than that stopping distance? If yes, alert. If no, log silently. One alert, correct moment, regulatory citation attached.

The risk determination is **100% deterministic Rust code** — verifiable, reproducible, and fast enough to run on a drone payload at under 500mW. The LLM only explains what the physics engine already decided.

---

## Architecture

The engine is open source. Revenue comes from **profiles** — versioned, jurisdiction-specific packages of encoded regulations.

```
clarus-core  (this repo — Apache 2.0)
├── Input Adapter    — normalises any sensor into EntityStream
├── Rust Logic Engine — physics computation + rule evaluation
├── LLM Explanation  — local inference, RAG-grounded citations
└── edgesentry-audit — cryptographic seal on every event

clarus-profiles  (commercial)
├── sg-port-safety/          ← MPA Port Safety Circulars + MOM WSH Act
├── sg-maritime-security/    ← COLREGs + restricted zone definitions
├── sg-construction-safety/  ← MOM WSH (Construction) Regulations
└── jp-port-safety/          ← Japan Industrial Safety and Health Act
```

A profile is a JSON rule file + regulatory KB + entity parameters. The engine is correct but generic; a profile is what makes it legally defensible in a specific jurisdiction.

---

## Who it is for

**Port terminal operators** — near-miss detection against MPA rules; one-click MOM compliance report; insurance premium reduction via actuarial-grade audit trail.

**Construction companies** — BizSAFE performance-based grading; MOM stop-work order risk reduction; documented due diligence before incidents occur.

**Defence / critical infrastructure** — the same engine, with a different profile, monitors perimeter security for SAF, SCDF, or Home Team deployments. Profile switching takes one command.

---

## Current status

Architecture defined. PoC implementation in progress targeting CAP Vista submission (30 June 2026) and PIER71 Smart Port Challenge (15 June 2026).

See [`docs/roadmap1-poc.md`](docs/roadmap1-poc.md) for the week-by-week build plan from today through the 6-month PoC audit log.

---

## Quick start

```bash
# Run the demo profile (generic rules, no jurisdiction-specific content)
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo

# With LLM explanation (requires llama-server — see scripts/run_llama.sh)
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo \
  --explain

# End-to-end test
./scripts/test-e2e.sh
```

## Using a jurisdiction-specific profile

Commercial profiles are not included in this repo — they are licensed separately.
To use one, point `--profile` at any directory containing a `rules.json` and a `kb/` folder:

```bash
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile /path/to/your/profile
```

### Profile format

```
my-profile/
├── rules.json          # rule conditions, severities, and regulation citations
└── kb/
    ├── RULE_ID_1.txt   # regulatory text snippet for LLM grounding
    └── RULE_ID_2.txt
```

`rules.json` example:

```json
[
  { "rule_id": "MIN_CLEARANCE", "condition": "distance < 5.0",
    "severity": "HIGH", "regulation": "Your Regulation §3.1" },
  { "rule_id": "TTC_WARNING",   "condition": "ttc < 3.0",
    "severity": "HIGH", "regulation": "Your Regulation §3.2" }
]
```

Supported conditions: `distance < N`, `ttc < N`, `zone_member` (requires a `zone` polygon field).

---

## Docs

| Document | Contents |
|---|---|
| [`docs/roadmap1-poc.md`](docs/roadmap1-poc.md) | Week-by-week build plan: Phase 0 (submission) → Phase 1 (deployment prep) → Phase 2 (PoC execution) |
| [`docs/demo-guide.md`](docs/demo-guide.md) | Step-by-step demo walkthrough |
