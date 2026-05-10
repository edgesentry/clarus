# API Reference

The Clarus Verification API provides B2B endpoints for verifying BCA Green Mark ZKP attestations.

Interactive documentation is available at:

**[clarus.edgesentry.io/api-docs](https://clarus.edgesentry.io/api-docs)**

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/verify?site=<id>` | Verify attestation — returns cert level, proof validity, verify URL |
| `GET /api/verify/raw?site=<id>` | Raw ZkProof envelope for client-side / B2B verification |

## Quick reference

=== "curl"

    ```bash
    # Verify a site
    curl "https://clarus.edgesentry.io/api/verify?site=MCH-OUTLET-042" | jq .

    # Raw proof envelope
    curl "https://clarus.edgesentry.io/api/verify/raw?site=MCH-OUTLET-042" | jq .
    ```

=== "JavaScript"

    ```js
    const res = await fetch("https://clarus.edgesentry.io/api/verify?site=MCH-OUTLET-042");
    const { valid, cert_level, proof_verified, verify_url } = await res.json();
    ```

=== "Python"

    ```python
    import httpx
    r = httpx.get("https://clarus.edgesentry.io/api/verify", params={"site": "MCH-OUTLET-042"})
    print(r.json())
    ```

## Response example

```json
{
  "valid": true,
  "site_id": "MCH-OUTLET-042",
  "cert_level": "gold",
  "all_criteria_pass": true,
  "cop_pass": true,
  "lpd_pass": true,
  "eui_kwh_m2": 105.0,
  "framework": "mock",
  "program_id": "bca-green-mark-2021-v1-mock",
  "proof_verified": true,
  "attested_at_ms": 1778000000000,
  "record_hash": "3f2a1b...",
  "verify_url": "https://clarus.edgesentry.io/api/verify?site=MCH-OUTLET-042"
}
```

## OpenAPI spec

The full OpenAPI 3.1 spec is available at [`/openapi.json`](https://clarus.edgesentry.io/openapi.json).

## Schema contract

Type definitions for `ZkProof` and `GreenMarkAttestation` are maintained in
[`schemas/zk-bca-greenmark.json`](https://github.com/edgesentry/clarus/blob/main/schemas/zk-bca-greenmark.json).
documaris CI validates against this schema to prevent type divergence.
