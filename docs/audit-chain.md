# Audit Chain — Design and Operations

- **Updated:** 2026-05-02
- **Status:** PoC active

---

## What the audit chain is

Every `RiskEvent` produced by the Rust engine is sealed into an `AuditRecord` before it leaves the edge device:

```
RiskEvent
  → BLAKE3(payload)           payload_hash
  → Ed25519(payload_hash)     signature
  → BLAKE3(postcard(record))  record_hash  ← next record's prev_record_hash
```

Records are chained: each record embeds the hash of the previous one. Removing or modifying any record breaks the chain from that point forward.

**What this proves:**
- A record existed at the claimed timestamp (signature)
- No record has been inserted, deleted, or modified after the fact (hash chain)
- The signing key belongs to a known device identity (public key registration — see production section)

---

## Storage

Records are uploaded to R2 immediately after signing, one file per record:

```
chains/{site_id}/{sequence:020}.json
```

Example: `chains/site_sgp_001/00000000000000000042.json`

The zero-padded sequence ensures lexicographic ordering matches logical ordering — bucket listing returns records in chain order without sorting.

### JSON format

```json
{
  "device_id": "site_sgp_001",
  "sequence": 42,
  "timestamp_ms": 1746163200000,
  "payload_hash": [12, 34, ...],
  "signature": [56, 78, ...],
  "prev_record_hash": [90, 12, ...],
  "object_ref": "risk-event:RESTRICTED_ZONE_APPROACH",
  "record_hash_hex": "a3f1c2..."
}
```

`record_hash_hex` is pre-computed by the edge daemon (BLAKE3 of `postcard::to_allocvec(record)`) and stored alongside the record so that browsers and external tools can verify the chain without implementing postcard serialization.

---

## PoC decisions

### Public bucket with Object Lock

| Decision | Value |
|---|---|
| Bucket | `clarus-dev-public-audit` |
| Access | Public read — no auth required |
| Object Lock | ✅ Enabled, indefinite retention (`audit-worm` rule) |
| Write | Authorized only — wrangler auth or R2 API key |

**Why public:** simplifies demo access — insurers and auditors can read records without credentials. Object Lock ensures records cannot be deleted or overwritten even by the bucket owner.

**Why Object Lock even in PoC:** without it, a compromised wrangler token could delete records and break the chain. Object Lock makes deletion impossible at the storage layer regardless of credentials.

### Ephemeral signing key

The edge daemon generates a fresh Ed25519 keypair on each start if `PRIVATE_KEY_HEX` is not set. For the PoC this is acceptable — the chain is internally consistent, but an external verifier cannot confirm the key belongs to a specific device without a key registry.

**Mitigation:** set `PRIVATE_KEY_HEX` in `config.env` to persist the key across restarts. Document the public key in the PoC handover package.

### No entity anonymization

MMSI, entity IDs, and site IDs are written as-is. Acceptable for demo data; not acceptable for real operational data.

---

## Production requirements

### Storage

| Requirement | PoC | Production |
|---|---|---|
| Bucket | `clarus-dev-public-audit` (public) | `clarus-prd-private-audit` (private) |
| Object Lock | ✅ Indefinite | ✅ Indefinite + Compliance mode |
| Access | Public read | Authenticated (auditors, insurers) only |
| Replication | None | Cross-region replication for disaster recovery |

Compliance mode Object Lock prevents even the account owner from disabling the lock. Standard mode (current PoC) prevents deletion but allows the lock itself to be removed by an admin.

### Key management

| Requirement | PoC | Production |
|---|---|---|
| Key storage | `PRIVATE_KEY_HEX` env var | HSM or Secure Enclave |
| Key rotation | Manual | Policy-driven, logged |
| Public key registration | None | Registered with insurer and/or notary before deployment |

The public key registration step is what makes the chain legally attributable — an insurer can verify "this signature was made by device X, whose key was registered on date Y."

### Entity anonymization

Before any real operational data enters the audit bucket:

- Replace MMSI and entity IDs with internal IDs
- Maintain a mapping table in a separate private store
- Mapping table access restricted to authorized personnel

**Migration trigger:** before any real site_id, MMSI, or operational timestamp enters any bucket. See `r2-bucket-naming.md` — Production checklist.

---

## Chain verification

### Browser (demo)

```js
// records: array of AuditRecord JSON, ordered by sequence
let intact = true;
for (let i = 1; i < records.length; i++) {
  const prevHashHex = buf2hex(records[i].prev_record_hash);
  if (prevHashHex !== records[i - 1].record_hash_hex) {
    intact = false;
    break;
  }
}
```

This works because `record_hash_hex` is pre-computed and stored in each JSON file. No BLAKE3 implementation is needed in the browser.

### CLI

```bash
# Verify the full chain from local DuckDB
edgesentry-audit verify-chain ./clarus_edge.db

# Verify against R2 (future)
edgesentry-audit verify-chain r2://clarus-prd-private-audit/chains/site_sgp_001/
```

### What verification proves

| Check | What it means |
|---|---|
| Sequence contiguous (0, 1, 2, …) | No records were deleted |
| `prev_record_hash[N]` matches `record_hash[N-1]` | No record was modified or inserted |
| Ed25519 signature valid | Record was created by the device holding the registered private key |

The first two checks can be done by anyone with read access. The third requires the device's public key.

---

## Open gaps (PoC → production)

| Gap | Impact | Resolution |
|---|---|---|
| No public key registry | Third parties cannot attribute records to a specific device | Register public key with insurer before PoC site goes live |
| Object Lock in Standard mode | Account admin can disable the lock | Switch to Compliance mode in production |
| No entity anonymization | Real MMSI/entity data must not enter the bucket | Implement before any real data is written |
| No cross-region replication | Bucket loss = chain loss | Add replication in production bucket config |
