---
name: clarus-run-demo
description: Run the clarus end-to-end demo pipeline (14 stages) or the document compliance / maritime security demos. Use when verifying the full pipeline or preparing a demo for reviewers.
license: Apache-2.0
compatibility: Requires eds binary built from edgesentry-rs, optional LLM server for explain step
metadata:
  repo: clarus
---

## Full 14-stage demo (recommended)

```bash
bash scripts/run_local_demo.sh --no-pause
```

## Document compliance demo (PIER71-11 / documaris)

```bash
cd ../edgesentry-rs
PROFILE=../clarus/profiles/sg-port-compliance

# TC1 — compliant voyage
./target/debug/eds parse maritime \
  --source crates/edgesentry-document/fixtures/voyage_V001_compliant.csv \
  --out /tmp/entity.jsonl
./target/debug/eds document fill --input /tmp/entity.jsonl --template fal-form-1 --out /tmp/filled.jsonl
./target/debug/eds document check --input /tmp/filled.jsonl --profile $PROFILE --out /tmp/alerts.jsonl

# TC2 — BWM expired (expect HIGH alert)
./target/debug/eds parse maritime \
  --source crates/edgesentry-document/fixtures/voyage_V002_bwm_expired.csv \
  --out /tmp/entity2.jsonl
./target/debug/eds document fill --input /tmp/entity2.jsonl --template fal-form-1 --out /tmp/filled2.jsonl
./target/debug/eds document check --input /tmp/filled2.jsonl --profile $PROFILE --out /tmp/alerts2.jsonl
```

## Maritime security demo (CAP Vista Tier 2)

```bash
cd ../edgesentry-rs
PROFILE=../clarus/profiles/sg-maritime-security

./target/debug/eds ingest replay \
  --source crates/edgesentry-ingest/fixtures/ais_maritime_approach.csv \
  --profile $PROFILE --out /tmp/vessel_frames.jsonl
./target/debug/eds evaluate run \
  --input /tmp/vessel_frames.jsonl --profile $PROFILE --out /tmp/vessel_alerts.jsonl
# Expected: RESTRICTED_ZONE_APPROACH HIGH at t=56000ms; AIS_TRACK_GAP at t=60000ms
```

See [references/demo-guide.md](references/demo-guide.md) for full audience-specific talking points.
