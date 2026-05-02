# R2 Bucket Naming Convention

- **Date:** 2026-05-02
- **Status:** Baseline

---

## Format

```
{product}-{env}-{access}
```

| Segment | Values | Notes |
|---------|--------|-------|
| `{product}` | `clarus` `maridb` `arktrace` `documaris` | lowercase, matches repo name |
| `{env}` | `dev` `prd` | mandatory — no suffix allowed |
| `{access}` | `public` `private` `audit` | see definitions below |

### Access types

| Access | Read | Write | Use case |
|--------|------|-------|----------|
| `public` | Anyone | Edge daemon only | Analytics summaries (heartbeats, alerts, vessel features). No real PII or operational data. |
| `private` | Authenticated | Authenticated | Production analytics — same data as `public` but access-controlled once real data flows. |
| `audit` | Private only | Edge daemon only | Full signed AuditRecord chain. Always private. Future: WORM / Object Lock. |

---

## Current buckets

| Bucket | Env | Access | Contents | Status |
|--------|-----|--------|----------|--------|
| `clarus-dev-public` | dev | Public | Heartbeats, alerts, vessel features Parquet | ✅ Active |
| `clarus-dev-audit` | dev | Private | Signed AuditRecord chain | ✅ Active |
| `maridb-public` | — | Public | AIS features, sanctions data | ✅ Active (pre-convention) |
| `arktrace-public` | — | Public | Arktrace analytics exports | ✅ Active (pre-convention) |
| `documaris-public` | — | Public | Documaris analytics exports | ✅ Active (pre-convention) |

> `maridb-public`, `arktrace-public`, `documaris-public` は命名規則制定前に作成。
> 次回リネームの際に `maridb-dev-public` 等に統一する。

---

## Production buckets (future — when real data flows)

| Bucket | Env | Access | Migration from |
|--------|-----|--------|----------------|
| `clarus-prd-private` | prd | Private + auth | `clarus-dev-public` |
| `clarus-prd-audit` | prd | Private + WORM | `clarus-dev-audit` |

---

## PoC → Production migration checklist

- [ ] Create `clarus-prd-private` with private access
- [ ] Create `clarus-prd-audit` with Object Lock (WORM) enabled
- [ ] Edge daemon: `ANALYTICS_BUCKET=clarus-prd-private`, `AUDIT_BUCKET=clarus-prd-audit`
- [ ] Analytics app Pages Function: add auth token verification before R2 reads
- [ ] entity_ids: anonymise MMSI → internal ID before writing to analytics bucket
- [ ] Stop writing to `clarus-dev-public`

**Migration trigger:** 実際の site_id・MMSI・運用タイムスタンプがバケットに入る前に実施。

---

## Exceptions

- `arktrace-data` — 命名規則制定前の legacy バケット。内容確認後に整理。
- `arktrace-private-capvista` — CAP Vista 提出物用に作成した一時バケット。`arktrace-dev-private` にリネーム予定。
