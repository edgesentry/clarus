#!/usr/bin/env python3
"""
Inject tampered WORM records for Q3 and Q4 E2E test scenarios.

Q3: BLD-TAMPER-PASS  — claims Gold certification, but proof_bytes don't match (fraud attempt)
Q4: BLD-TAMPER-FAIL  — claims Not Certified, but proof_bytes don't match (sabotage attempt)

Both records have valid-looking structure but the ZKP proof is invalid:
  proof_bytes ≠ blake3(decode(public_values))
This is detectable in documaris via the proof verification UI.
"""

import base64
import hashlib
import json
import os
import sys
import time
import hmac
import hashlib
import datetime
import urllib.request
import urllib.error
import struct
import random

# ── R2 credentials ───────────────────────────────────────────────────────────

ACCOUNT_ID        = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY_ID     = os.environ["R2_ACCESS_KEY_ID"]
SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
AUDIT_BUCKET     = "clarus-dev-public-audit"
RAW_BUCKET       = "clarus-dev-public-raw"
R2_ENDPOINT      = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"
REGION           = "auto"
SERVICE          = "s3"

# ── Scenario definitions ──────────────────────────────────────────────────────

NOW_MS = int(time.time() * 1000)

SCENARIOS = [
    {
        "name": "Q3",
        "site_id": "BLD-TAMPER-PASS",
        "run_id": str(NOW_MS),
        "seq": 0,
        # Claims Gold (passes BCA Green Mark) — but proof is tampered
        "attestation": {
            "site_id": "BLD-TAMPER-PASS",
            "eui_kwh_m2": 90.0,          # claims EUI well below Gold threshold
            "cert_level": "gold_plus",
            "all_criteria_pass": True,
            "cop_pass": True,
            "lpd_pass": True,
            "period_start_ms": NOW_MS - 2000,
            "period_end_ms": NOW_MS,
        },
        "tamper": True,
    },
    {
        "name": "Q4",
        "site_id": "BLD-TAMPER-FAIL",
        "run_id": str(NOW_MS + 1),
        "seq": 0,
        # Claims Not Certified (fails BCA Green Mark) — but proof is also tampered
        "attestation": {
            "site_id": "BLD-TAMPER-FAIL",
            "eui_kwh_m2": 170.0,         # claims very high EUI — but numbers are made up
            "cert_level": "not_certified",
            "all_criteria_pass": False,
            "cop_pass": False,
            "lpd_pass": False,
            "period_start_ms": NOW_MS - 2000,
            "period_end_ms": NOW_MS,
        },
        "tamper": True,
    },
]

# ── AWS Sig V4 signing ────────────────────────────────────────────────────────

def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def get_signing_key(key, datestamp, region, service):
    k_date    = sign(("AWS4" + key).encode("utf-8"), datestamp)
    k_region  = sign(k_date, region)
    k_service = sign(k_region, service)
    k_signing = sign(k_service, "aws4_request")
    return k_signing

def r2_put(bucket: str, key: str, body: bytes, content_type: str = "application/json"):
    now = datetime.datetime.utcnow()
    amzdate   = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")

    url      = f"{R2_ENDPOINT}/{bucket}/{key}"
    host     = f"{ACCOUNT_ID}.r2.cloudflarestorage.com"
    body_sha = hashlib.sha256(body).hexdigest()

    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{body_sha}\n"
        f"x-amz-date:{amzdate}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"

    canonical_request = "\n".join([
        "PUT",
        f"/{bucket}/{key}",
        "",
        canonical_headers,
        signed_headers,
        body_sha,
    ])

    credential_scope = f"{datestamp}/{REGION}/{SERVICE}/aws4_request"
    string_to_sign   = "\n".join([
        "AWS4-HMAC-SHA256",
        amzdate,
        credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])

    signing_key = get_signing_key(SECRET_ACCESS_KEY, datestamp, REGION, SERVICE)
    signature   = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={ACCESS_KEY_ID}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    headers = {
        "Content-Type":        content_type,
        "x-amz-date":         amzdate,
        "x-amz-content-sha256": body_sha,
        "Authorization":       authorization,
    }

    req = urllib.request.Request(url, data=body, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code}: {e.read().decode()[:200]}")
        return e.code


# ── Blake3 (pure Python fallback) ────────────────────────────────────────────
# Real BLAKE3 would require a C extension. For the "correct" proof we use
# SHA-256 in a way that can be detected by documaris as "not blake3",
# but for the tampered records we just use random bytes — that's the whole point.

def make_proof(attestation_json: bytes, tamper: bool) -> tuple[str, str]:
    """Returns (proof_bytes_b64, public_values_b64)."""
    pub_val_b64 = base64.b64encode(attestation_json).decode()

    if tamper:
        # Tampered: use random bytes — won't match blake3(attestation_json)
        proof_bytes = bytes(random.getrandbits(8) for _ in range(32))
    else:
        # Correct mock: blake3 — use hashlib sha256 as stand-in (documaris checks blake3)
        # For honest records, this would be real blake3; here it doesn't matter
        proof_bytes = hashlib.sha256(attestation_json).digest()[:32]

    return base64.b64encode(proof_bytes).decode(), pub_val_b64


# ── WORM record builder ───────────────────────────────────────────────────────

def make_worm_record(scenario: dict) -> bytes:
    att    = scenario["attestation"]
    att_json = json.dumps(att, separators=(",", ":")).encode()
    proof_bytes_b64, pub_val_b64 = make_proof(att_json, scenario["tamper"])

    record = {
        "sequence":        scenario["seq"],
        "timestamp_ms":    NOW_MS,
        "device_id":       scenario["site_id"],
        "entity_ids":      ["OUTLET-SENSORS"],
        "evidence_quality": "Certified",
        "object_ref":      f"risk-event:EUI_PLATINUM_EXCEEDED",
        "rule_id":         "EUI_PLATINUM_EXCEEDED",
        "severity":        "High",
        # Mock chain hashes (not cryptographically linked — standalone demo records)
        "payload_hash_hex":     "0" * 64,
        "prev_record_hash_hex": "0" * 64,
        "record_hash_hex":      "0" * 64,
        "signature_hex":        "0" * 64,
        "zk_proof": {
            "framework":    "mock",
            "program_id":   "bca-green-mark-2021-v1-mock",
            "proof_bytes":  proof_bytes_b64,
            "public_values": pub_val_b64,
        },
    }
    return json.dumps(record, indent=2).encode()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    random.seed(42)

    for sc in SCENARIOS:
        site    = sc["site_id"]
        run_id  = sc["run_id"]
        seq     = sc["seq"]
        seq_str = str(seq).zfill(20)

        print(f"\n{'='*60}")
        print(f"{sc['name']}: {site} — {'TAMPERED' if sc['tamper'] else 'honest'}")
        print(f"  cert_level:       {sc['attestation']['cert_level']}")
        print(f"  all_criteria_pass:{sc['attestation']['all_criteria_pass']}")

        # 1. Upload WORM record to audit bucket
        worm_key  = f"chains/{site}/{run_id}/{seq_str}.json"
        worm_body = make_worm_record(sc)
        print(f"  Uploading audit record → {worm_key}")
        status = r2_put(AUDIT_BUCKET, worm_key, worm_body)
        print(f"  Status: {status}")

        # 2. Upload zkp-latest pointer to raw bucket
        ptr_key  = f"zkp-latest/{site}.json"
        ptr_body = json.dumps({
            "run_id":   run_id,
            "last_seq": seq,
            "site_id":  site,
        }).encode()
        print(f"  Uploading zkp-latest pointer → {ptr_key}")
        status = r2_put(RAW_BUCKET, ptr_key, ptr_body)
        print(f"  Status: {status}")

    print("\nDone. documaris will show Q3/Q4 as 'proof invalid' after BLAKE3 verification.")


if __name__ == "__main__":
    main()
