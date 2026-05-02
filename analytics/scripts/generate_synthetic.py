#!/usr/bin/env python3
"""
Generate synthetic vessel_features Parquet for the EdgeSentry analytics demo.

Produces ~500 vessels with realistic risk distributions:
  70%  low risk   (clean operators)
  20%  medium risk (some anomalies)
  10%  high risk  (sanctions-adjacent, heavy AIS gaps, STS transfers)

One vessel (MMSI 563012345 "MV Fortune Star") is hardcoded as the demo spotlight.

Usage:
    pip install pandas pyarrow numpy
    python scripts/generate_synthetic.py
    # writes data/vessel_features_synthetic.parquet and uploads to clarus-dev-public-analytics
"""

import pathlib, json
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

RNG = np.random.default_rng(42)
N = 500
OUT = pathlib.Path(__file__).parent.parent / "data" / "vessel_features_synthetic.parquet"

# ── Reference tables ──────────────────────────────────────────────────────────

FLAGS = {
    "Panama": 0.22, "Marshall Islands": 0.18, "Liberia": 0.14,
    "Singapore": 0.10, "Hong Kong": 0.08, "Bahamas": 0.07,
    "Malta": 0.06, "Cyprus": 0.05, "Greece": 0.05, "other": 0.05,
}
TYPES = {
    "Bulk Carrier": 0.30, "Container Ship": 0.25, "Tanker": 0.20,
    "General Cargo": 0.15, "RoRo": 0.05, "Other": 0.05,
}
NAMES_ADJ = ["Fortune", "Pacific", "Atlantic", "Eastern", "Western",
             "Golden", "Silver", "Ocean", "Star", "Pioneer"]
NAMES_NOUN = ["Star", "Express", "Voyager", "Pioneer", "Spirit",
              "Eagle", "Falcon", "Phoenix", "Horizon", "Quest"]


def _pick(d: dict, n: int) -> list:
    keys, probs = zip(*d.items())
    return RNG.choice(keys, size=n, p=probs).tolist()


def _vessel_names(n: int) -> list:
    adj  = RNG.choice(NAMES_ADJ,  size=n)
    noun = RNG.choice(NAMES_NOUN, size=n)
    nums = RNG.integers(100, 999,  size=n)
    return [f"MV {a} {b} {c}" for a, b, c in zip(adj, noun, nums)]


# ── Tier assignment ───────────────────────────────────────────────────────────

tiers = RNG.choice(["low", "medium", "high"], size=N, p=[0.70, 0.20, 0.10])


def _feature(tier, low_range, med_range, high_range):
    lo, hi = {"low": low_range, "medium": med_range, "high": high_range}[tier]
    return float(RNG.uniform(lo, hi))


def _int_feature(tier, low_range, med_range, high_range):
    lo, hi = {"low": low_range, "medium": med_range, "high": high_range}[tier]
    return int(RNG.integers(lo, hi + 1))


rows = []
for i, tier in enumerate(tiers):
    mmsi = f"{RNG.integers(100_000_000, 999_999_999):09d}"
    flag = _pick(FLAGS, 1)[0]
    vtype = _pick(TYPES, 1)[0]
    built = int(RNG.integers(1998, 2024))

    ais_gap_count   = _int_feature(tier, (0, 2),  (3, 15),  (16, 60))
    ais_gap_max_h   = _feature(tier,     (0, 4),   (5, 48),  (48, 480))
    sts_count       = _int_feature(tier, (0, 0),  (1, 3),   (3, 12))
    loitering_h     = _feature(tier,     (0, 8),  (8, 60),  (60, 300))
    sanctions_dist  = _int_feature(tier, (5, 10), (3, 6),   (1, 3))
    cluster_ratio   = _feature(tier,     (0, 0.05),(0.05,0.25),(0.25, 0.80))
    flag_changes    = _int_feature(tier, (0, 0),  (0, 1),   (1, 4))
    ownership_depth = _int_feature(tier, (1, 2),  (2, 5),   (5, 10))
    sanctions_hits  = _int_feature(tier, (0, 0),  (0, 0),   (0, 3))

    # Weighted behavioral score (0–100)
    score = (
        0.15 * min(ais_gap_count / 60, 1) * 100 +
        0.15 * min(ais_gap_max_h / 480, 1) * 100 +
        0.20 * min(sts_count / 12, 1) * 100 +
        0.10 * min(loitering_h / 300, 1) * 100 +
        0.15 * max(0, (10 - sanctions_dist) / 9) * 100 +
        0.10 * cluster_ratio * 100 +
        0.05 * min(flag_changes / 4, 1) * 100 +
        0.05 * min(ownership_depth / 10, 1) * 100 +
        0.05 * min(sanctions_hits / 3, 1) * 100
    )

    # Traditional underwriting factors
    flag_risk = {"Panama": 1.3, "Marshall Islands": 1.2, "Liberia": 1.1,
                 "Singapore": 0.9, "Hong Kong": 0.95}.get(flag, 1.1)
    age_factor = 1.0 + max(0, (2026 - built - 10) * 0.02)
    type_factor = {"Tanker": 1.4, "Bulk Carrier": 1.2, "Container Ship": 1.1,
                   "General Cargo": 1.15}.get(vtype, 1.1)
    base_premium = int(100_000 * flag_risk * age_factor * type_factor)

    behavioral_loading = 1.0 + (score / 100) * 1.5
    final_premium = int(base_premium * behavioral_loading)

    rows.append({
        "mmsi": mmsi,
        "vessel_name": f"MV {RNG.choice(NAMES_ADJ)} {RNG.choice(NAMES_NOUN)} {RNG.integers(100,999)}",
        "flag_state": flag,
        "vessel_type": vtype,
        "built_year": built,
        "tier": tier,
        "ais_gap_count_30d": ais_gap_count,
        "ais_gap_max_hours": round(ais_gap_max_h, 1),
        "sts_candidate_count": sts_count,
        "loitering_hours_30d": round(loitering_h, 1),
        "sanctions_distance": sanctions_dist,
        "cluster_sanctions_ratio": round(cluster_ratio, 3),
        "flag_changes_2y": flag_changes,
        "ownership_depth": ownership_depth,
        "sanctions_list_count": sanctions_hits,
        "behavioral_score": round(score, 1),
        "traditional_premium_usd": base_premium,
        "behavioral_premium_usd": final_premium,
    })

df = pd.DataFrame(rows)

# ── Demo spotlight vessel (hardcoded for demo video) ─────────────────────────
# Replace row 0 with MV Fortune Star — high risk, good demo story.

spotlight = {
    "mmsi": "563012345",
    "vessel_name": "MV Fortune Star",
    "flag_state": "Panama",
    "vessel_type": "Bulk Carrier",
    "built_year": 2008,
    "tier": "high",
    "ais_gap_count_30d": 14,
    "ais_gap_max_hours": 127.5,
    "sts_candidate_count": 3,
    "loitering_hours_30d": 89.2,
    "sanctions_distance": 2,
    "cluster_sanctions_ratio": 0.42,
    "flag_changes_2y": 2,
    "ownership_depth": 7,
    "sanctions_list_count": 0,
    "behavioral_score": 74.3,
    "traditional_premium_usd": 180_000,
    "behavioral_premium_usd": 340_000,
}
df.iloc[0] = spotlight

# Ensure correct dtypes
int_cols = ["ais_gap_count_30d", "sts_candidate_count", "sanctions_distance",
            "flag_changes_2y", "ownership_depth", "sanctions_list_count",
            "built_year", "traditional_premium_usd", "behavioral_premium_usd"]
for c in int_cols:
    df[c] = df[c].astype(int)

import subprocess

OUT.parent.mkdir(exist_ok=True)
pq.write_table(pa.Table.from_pandas(df, preserve_index=False), OUT)
print(f"Written {len(df)} vessels → {OUT}")
print(f"  Tiers: {df['tier'].value_counts().to_dict()}")
print(f"  Score range: {df['behavioral_score'].min():.1f}–{df['behavioral_score'].max():.1f}")
print(f"  Demo vessel: MMSI 563012345  score={spotlight['behavioral_score']}  premium ${spotlight['traditional_premium_usd']:,}→${spotlight['behavioral_premium_usd']:,}")

# Upload to clarus-dev-public-analytics
result = subprocess.run(
    ["wrangler", "r2", "object", "put",
     "clarus-dev-public-analytics/vessel_features_synthetic.parquet",
     "--file", str(OUT),
     "--content-type", "application/octet-stream",
     "--remote"],
    capture_output=True, text=True
)
if result.returncode == 0:
    print("  uploaded → clarus-dev-public-analytics/vessel_features_synthetic.parquet")
else:
    print(f"  upload failed: {result.stderr.strip()}")
