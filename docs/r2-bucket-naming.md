# R2 Bucket Naming Convention

- **Date:** 2026-05-02
- **Status:** Baseline

---

## Format

```
{product}-{access}[-{env}]
```

| Segment | Values | Notes |
|---------|--------|-------|
| `{product}` | `clarus` `maridb` `arktrace` `documaris` | lowercase, matches repo name |
| `{access}` | `public` `audit` `private` | see definitions below |
| `[-{env}]` | *(none)* = PoC &nbsp;·&nbsp; `-prod` = production | omit suffix for PoC |

### Access types

| Access | Read | Write | Use case |
|--------|------|-------|----------|
| `public` | Anyone | Edge daemon only | Analytics summaries — heartbeats, alerts, vessel features. PoC: publicly readable. |
| `audit` | Private | Edge daemon only | Full signed AuditRecord chain. Always private. Future: WORM / Object Lock. |
| `private` | Authenticated | Authenticated | Production analytics. Private equivalent of `public` once real data flows. |

---

## PoC buckets (current)

| Bucket | Access | Contents | Status |
|--------|--------|----------|--------|
| `clarus-public` | Public | Heartbeats, alerts, vessel features Parquet | ✅ Active |
| `clarus-audit` | Private | Signed AuditRecord chain | ✅ Active |
| `maridb-public` | Public | AIS features, sanctions data | ✅ Active |
| `arktrace-public` | Public | Arktrace analytics exports | ✅ Active |
| `documaris-public` | Public | Documaris analytics exports | ✅ Active |

---

## Production buckets (future — when real data flows)

| Bucket | Access | Migration from |
|--------|--------|----------------|
| `clarus-prod-private` | Private + auth | `clarus-public` |
| `clarus-prod-audit` | Private + WORM | `clarus-audit` |
| `maridb-prod-private` | Private + auth | `maridb-public` |

**Migration trigger:** Before any real site_id, MMSI, or operational timestamp enters a bucket.

---

## PoC → Production migration checklist

- [ ] Create `clarus-prod-private` with private access
- [ ] Create `clarus-prod-audit` with Object Lock (WORM) enabled
- [ ] Edge daemon: add `STORAGE_BACKEND` env pointing to prod buckets
- [ ] Analytics app Pages Function: add auth token verification before R2 reads
- [ ] entity_ids: replace MMSI with anonymised internal IDs before writing to analytics bucket
- [ ] Deprecate `clarus-public` writes (keep bucket for read-back compatibility during transition)

---

## Notes on existing exceptions

- `arktrace-private-capvista` — ad-hoc private bucket created for CAP Vista submission materials.
  Does not follow the standard pattern. Treat as one-off; rename to `arktrace-private` if reused.
- `arktrace-data` — legacy bucket predating this convention. Contents TBD.
