#!/usr/bin/env python3
"""
Generate synthetic heartbeat + alert Parquet files for the /live demo page.
Simulates ~60 minutes of edge daemon output from two sites.

Usage (from clarus/analytics/):
    source /Users/yoheionishi/work/edgesentry/maridb/.venv/bin/activate
    python scripts/generate_live_demo.py
    # uploads to R2 via wrangler
"""

import json, math, pathlib, subprocess, tempfile, time
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

RNG = np.random.default_rng(42)
NOW = int(time.time() * 1000)
MINUTE = 60_000

SITES = ["site_sgp_001", "site_sgp_002"]
OUT   = pathlib.Path(__file__).parent.parent / "data" / "live"
OUT.mkdir(parents=True, exist_ok=True)

# ── Heartbeats ────────────────────────────────────────────────────────────────

def drift_score(i: int) -> float:
    base = 0.02 + 0.01 * math.sin(i * 0.3)
    if i % 12 == 11:
        return min(base + 0.65, 1.0)   # UNCALIBRATED
    if i % 8 >= 6:
        return base + 0.38              # DEGRADED
    return base


def calibration_status(drift: float) -> str:
    if drift < 0.3:  return "VALID"
    if drift < 0.6:  return "DEGRADED"
    return "UNCALIBRATED"


def generate_heartbeats(site_id: str, n: int = 120, offset_ms: int = 0):
    rows = []
    for i in range(n):
        ts = NOW - (n - i) * 30_000 + offset_ms  # one heartbeat every 30s
        drift = drift_score(i)
        cal = calibration_status(drift)

        # Evidence quality counts vary with scenario
        if cal == "UNCALIBRATED":
            cert, deg, rej = 0, 1, 3
        elif cal == "DEGRADED":
            cert, deg, rej = 2, 3, 1
        else:
            cert, deg, rej = int(RNG.integers(4, 9)), int(RNG.integers(0, 2)), 0

        rows.append({
            "id": i,
            "timestamp_ms": ts,
            "site_id": site_id,
            "drift_score": round(drift, 4),
            "calibration_status": cal,
            "certified_count": cert,
            "degraded_count": deg,
            "rejected_count": rej,
            "total_events": cert + deg + rej,
            "chain_tip_hash": f"{'a' * (i % 16 + 1):0<64}",
            "synced": True,
        })
    return pd.DataFrame(rows)


# ── Alerts ────────────────────────────────────────────────────────────────────

RULES = [
    ("PROXIMITY_ALERT",          "HIGH",     "distance < 5.0"),
    ("TTC_ALERT",                "HIGH",     "ttc < 3.0"),
    ("RESTRICTED_ZONE_APPROACH", "HIGH",     "zone_member"),
    ("AIS_TRACK_GAP",            "CRITICAL", "ais_gap > 480"),
]


def generate_alerts(site_id: str, n: int = 40, offset_ms: int = 0):
    rows = []
    for i in range(n):
        ts = NOW - (n - i) * 90_000 + offset_ms + int(RNG.integers(-15_000, 15_000))
        rule_id, severity, _ = RULES[i % len(RULES)]

        # Confidence/quality pattern mirrors sim.rs
        cycle = i
        if cycle % 5 == 0:
            conf = round(0.28 + (i % 15) * 0.01, 2)
            quality = "Rejected"
        elif cycle % 3 == 0:
            conf = round(0.55 + (i % 20) * 0.01, 2)
            quality = "Degraded"
        else:
            conf = round(0.88 + (i % 12) * 0.01, 2)
            quality = "Certified"

        rows.append({
            "sequence": i,
            "site_id": site_id,
            "timestamp_ms": ts,
            "rule_id": rule_id,
            "severity": severity,
            "evidence_quality": quality,
            "confidence_cv": conf,
            "measured_value": round(float(RNG.uniform(0.5, 4.9)), 2),
            "threshold": 5.0 if "PROXIMITY" in rule_id else 3.0 if "TTC" in rule_id else 0.0,
            "entity_ids": json.dumps(["FL-01", "W-03"] if "PROXIMITY" in rule_id or "TTC" in rule_id else ["V-001"]),
            "payload_hash_hex": f"{i:064x}",
            "signature_hex": f"{i * 2:0128x}",
            "prev_hash_hex": f"{max(0, i - 1):064x}",
            "synced": True,
        })
    return pd.DataFrame(rows)


# ── Write + upload ────────────────────────────────────────────────────────────

def write_and_upload(df: pd.DataFrame, r2_key: str):
    local = OUT / r2_key.replace("/", "_")
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), local)
    print(f"  written {local.name} ({len(df)} rows)")

    result = subprocess.run(
        ["wrangler", "r2", "object", "put",
         f"clarus-public/{r2_key}",
         "--file", str(local),
         "--content-type", "application/octet-stream",
         "--remote"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f"  uploaded → {r2_key}")
    else:
        print(f"  upload failed: {result.stderr.strip()}")


def main():
    for i, site_id in enumerate(SITES):
        offset = i * 7_000  # slight time offset between sites

        print(f"\n[{site_id}] Heartbeats...")
        hb = generate_heartbeats(site_id, n=120, offset_ms=offset)
        ts = NOW - (120 * 30_000)
        write_and_upload(hb, f"live/{site_id}/heartbeats/{ts}.parquet")

        print(f"[{site_id}] Alerts...")
        al = generate_alerts(site_id, n=40, offset_ms=offset)
        write_and_upload(al, f"live/{site_id}/audit_chain/{ts}.parquet")

    print("\nDone.")
    print("Open https://feat-analytics-scorecard.clarus-analytics.pages.dev/live")


if __name__ == "__main__":
    main()
