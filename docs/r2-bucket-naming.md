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

| Value | Who can read |
|-------|-------------|
| `public` | Anyone (no auth required) |
| `private` | Authenticated requests only |

### Role

| Value | Contents | Written by | Read by |
|-------|----------|------------|---------|
| `raw` | Raw device output — heartbeats, alerts, EntityStream | Edge daemon | `/live` Operations Monitor |
| `audit` | Signed AuditRecord chain (tamper-evident) | Edge daemon | Auditors, insurers |
| `analytics` | Post-processed data — vessel features, risk scores | maridb pipelines | `/` Risk Intelligence |

---

## Current buckets (dev)

| Bucket | Access | Role | Contents | Status |
|--------|--------|------|----------|--------|
| `clarus-dev-public-raw` | Public | raw | Heartbeats, alerts Parquet from edge daemon | ✅ Active |
| `clarus-dev-private-audit` | Private | audit | Signed AuditRecord chain | ✅ Active |
| `clarus-dev-public-analytics` | Public | analytics | vessel_features.parquet, risk scores | ✅ Active |

---

## Production buckets (future)

| Bucket | Access | Role | Notes |
|--------|--------|------|-------|
| `clarus-prd-private-raw` | Private | raw | Anonymise entity_ids (MMSI → internal ID) before writing |
| `clarus-prd-private-audit` | Private | audit | Enable Object Lock (WORM) |
| `clarus-prd-private-analytics` | Private | analytics | Add auth token check in Pages Function |

**Migration trigger:** Before any real site_id, MMSI, or operational timestamp enters a bucket.

---

## App ↔ bucket mapping

### Analytics app (Cloudflare Pages)

| Page | Bucket | Binding |
|------|--------|---------|
| `/live` Operations Monitor | `clarus-dev-public-raw` | `CLARUS_DEV_PUBLIC_RAW` |
| `/` Risk Intelligence | `clarus-dev-public-analytics` | `CLARUS_DEV_PUBLIC_ANALYTICS` |

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
