# Architecture Reference

- **Date:** 2026-05-05
- **Status:** Baseline

---

## Overview

clarus has two delivery surfaces:

| Surface | URL | Runtime |
|---------|-----|---------|
| Analytics web app | [clarus.edgesentry.io](https://clarus.edgesentry.io/) | Browser (Cloudflare Pages) |
| Desktop demo app | Local only | Tauri (native binary) |

---

## Web app (Cloudflare Pages)

### Hosting

Deployed to **Cloudflare Pages** (project: `clarus`, domain: `clarus.edgesentry.io`).  
CI deploys from `main` on any change under `analytics/` via `.github/workflows/deploy-app.yml`.

Pages includes **Cloudflare Pages Functions** (`analytics/functions/`) — edge workers that proxy R2 bucket access. The browser never holds R2 credentials.

### Pages

| Path | Entry point | Purpose |
|------|-------------|---------|
| `/` | `index.html` / `app.ts` | Risk Intelligence — vessel scores + alerts |
| `/live` | `live.html` / `live.ts` | Operations Monitor — live heartbeats |
| `/audit` | `audit.html` | Audit chain verification |
| `/analysis/` | `analysis/index.html` | Deep-dive analysis |

### Data flow

```
R2 bucket
   └─ Cloudflare Pages Function  (auth proxy, no credentials in browser)
         └─ fetch() in browser
               └─ DuckDB WASM  (SQL over Parquet in-browser)
                     └─ Observable Plot  (charts)
```

1. Browser calls `/data/raw/{key}`, `/data/analytics/{key}`, or `/data/audit/{key}`.
2. Pages Function reads the corresponding R2 bucket and streams the response.
3. Browser loads the Parquet bytes into DuckDB WASM via `db.registerFileBuffer()`.
4. DuckDB runs SQL aggregations entirely in the browser — no server-side query engine.
5. Observable Plot renders the results.

---

## Browser storage

### DuckDB WASM

`@duckdb/duckdb-wasm` v1.29.0 — initialised from jsDelivr bundles, runs in a Web Worker.

```typescript
await db.open({ path: "opfs://clarus-analytics.db" });
```

- Opens against **Origin Private File System (OPFS)** when available — DuckDB database persists across page reloads.
- Falls back to `:memory:` if OPFS is unavailable (e.g., cross-origin iframe, older Safari).
- LLM-generated alert explanations are cached in a DuckDB table (`alert_explanations`) rather than localStorage.

### Other storage

No IndexedDB or localStorage is used. All application state is derived from R2 data at load time.

---

## R2 data storage

Three public Cloudflare R2 buckets (see [ref-r2-data-layout.md](ref-r2-data-layout.md) for naming convention and migration plan):

| Bucket | Binding | Written by | Read by |
|--------|---------|-----------|---------|
| `clarus-dev-public-raw` | `CLARUS_DEV_PUBLIC_RAW` | Edge daemon | `/live` Operations Monitor |
| `clarus-dev-public-analytics` | `CLARUS_DEV_PUBLIC_ANALYTICS` | maridb pipelines | `/` Risk Intelligence |
| `clarus-dev-public-audit` | `CLARUS_DEV_PUBLIC_AUDIT` | Edge daemon | `/audit` chain verification |

Object format: **Parquet** (raw + analytics), **JSONL** (audit chain).  
Object Lock (Standard mode) is enabled on the audit bucket — records are immutable.

---

## Tauri desktop app

The `ui/` directory is a separate **Tauri 2** application — not deployed to the web. It links edgesentry-rs crates directly via Cargo path dependencies and is used for the local 14-stage demo.

See [AGENTS.md](../AGENTS.md) for checkout requirements and Tauri command list.

---

## Build

```
analytics/
  vite.config.ts     multi-page Vite build
  wrangler.toml      R2 bindings + Pages project name
  functions/         Pages Functions (R2 proxy)
  dist/              build output → deployed to Cloudflare Pages
```

Local dev: `cd analytics && npm run dev` — Wrangler local emulation with `--local` R2.
