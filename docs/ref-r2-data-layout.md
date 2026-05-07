# R2 Bucket Naming Convention

- **Date:** 2026-05-02
- **Status:** Baseline

---

## Format

```
{product}-{env}-{access}-{role}
```

| Segment | Values | Notes |
|---------|--------|-------|
| `{product}` | `clarus` `maridb` `arktrace` `documaris` | Lowercase, matches repo name |
| `{env}` | `dev` `prd` | Mandatory — no bucket without an env suffix |
| `{access}` | `public` `private` | Access control level |
| `{role}` | `raw` `audit` `analytics` | Data purpose |

### Access

| Value | Who can read | Who can write |
|-------|-------------|---------------|
| `public` | Anyone — no auth required (via Cloudflare Pages Function) | Authorized only — wrangler login or R2 API key |
| `private` | Authenticated requests only | Authorized only — wrangler login or R2 API key |

> Read and write are always separate concerns. "public" means **read is open**; it does not weaken write protection. All writes require Cloudflare account credentials regardless of bucket access level.

### Role

| Value | Contents | Written by | Read by |
|-------|----------|------------|---------|
| `raw` | Raw device output — heartbeats, alerts, EntityStream | Edge daemon | `/admin/live` Operations Monitor |
| `audit` | Signed AuditRecord chain (tamper-evident) | Edge daemon | Auditors, insurers, `/admin/audit` |
| `analytics` | Post-processed data — vessel features, risk scores | maridb / indago pipelines | `/maritime/analytics/`, `/bca/analytics/` |

---

## Current buckets (dev / PoC)

| Bucket | Access | Role | Object Lock | Contents | Status |
|--------|--------|------|-------------|----------|--------|
| `clarus-dev-public-raw` | Public | raw | — | Heartbeats, alerts Parquet from edge daemon | ✅ Active |
| `clarus-dev-public-audit` | Public | audit | ✅ Indefinite (Standard) | Signed AuditRecord chain (BLAKE3 + Ed25519) | ✅ Active |
| `clarus-dev-public-analytics` | Public | analytics | — | vessel_features.parquet, risk scores | ✅ Active |

> **PoC note:** audit is public to simplify demo access. Object Lock (Standard mode) is enabled — records cannot be deleted or overwritten. In production, switch to `clarus-prd-private-audit` with private access and Compliance mode Object Lock — see production checklist below. See `audit-chain.md` for full PoC vs production design decisions.

---

## Production buckets (future)

| Bucket | Access | Role | Notes |
|--------|--------|------|-------|
| `clarus-prd-private-raw` | Private | raw | Anonymise entity_ids (MMSI → internal ID) before writing |
| `clarus-prd-private-audit` | Private | audit | Enable Object Lock in **Compliance mode** — required for legal admissibility |
| `clarus-prd-private-analytics` | Private | analytics | Add auth token check in Pages Function |

**Migration trigger:** Before any real site_id, MMSI, or operational timestamp enters a bucket.

---

## App ↔ bucket mapping

### Analytics app (Cloudflare Pages)

URL structure: use-case analytics under `/<usecase>/analytics/`; profile-agnostic pipeline monitoring under `/admin/`.

| Page | Bucket | Binding |
|------|--------|---------|
| `/admin/live` Operations Monitor | `clarus-dev-public-raw` | `CLARUS_DEV_PUBLIC_RAW` |
| `/admin/audit` Audit Chain | `clarus-dev-public-audit` | `CLARUS_DEV_PUBLIC_AUDIT` |
| `/admin/status` Upload Status | both raw + audit | `CLARUS_DEV_PUBLIC_RAW`, `CLARUS_DEV_PUBLIC_AUDIT` |
| `/maritime/analytics/` Risk Intelligence | `clarus-dev-public-analytics` | `CLARUS_DEV_PUBLIC_ANALYTICS` |

### WORM audit key format

```
chains/{site_id}/{run_id}/{sequence:020}.json
```

`run_id` is the epoch-ms timestamp at daemon startup. Each restart generates a new prefix, so the Object Lock policy never blocks an upload by trying to overwrite a locked key from a previous run. The sequence counter resets to 0 on each restart but lives under a unique run namespace.

### Edge daemon

| Data | Bucket | Config key |
|------|--------|------------|
| Heartbeats + alerts | `clarus-dev-public-raw` | `RAW_BUCKET` |
| Signed AuditRecords | `clarus-dev-private-audit` | `AUDIT_BUCKET` |

---

## PoC → Production migration checklist

- [ ] Create 3 `prd` buckets (raw, audit, analytics)
- [ ] Enable Object Lock on `clarus-prd-private-audit`
- [ ] Edge daemon: update `RAW_BUCKET` and `AUDIT_BUCKET` to prd buckets
- [ ] Pages Function: add auth token verification for private buckets
- [ ] Anonymise entity_ids (MMSI → internal ID) before writing to raw bucket
- [ ] Stop writing to dev buckets
