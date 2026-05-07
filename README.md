# clarus

Tauri GUI application for the [edgesentry-rs](https://github.com/edgesentry/edgesentry-rs) safety and compliance toolkit.

## What's in this repo

| Path | Purpose |
|---|---|
| `ui/` | Tauri desktop app (Vite frontend + Rust Tauri backend) |
| `profiles/` | Demo regulatory profile (OSS, generic citations) |
| `fixtures/` | CSV fixtures for demo scenarios |
| `scripts/` | Local dev and e2e test scripts |

## Architecture

```
edgesentry-rs (engine + CLI)        clarus (this repo — app layer)
────────────────────────────        ──────────────────────────────
eds ingest / compute / evaluate     ui/  ← Tauri GUI
eds assess / explain / report           renders reports, verifies
eds audit sign / verify                 audit chains, manages profiles
```

The Tauri backend calls edgesentry-rs crates via Cargo path dependencies — no separate process needed.

## Platform

clarus and [documaris](https://github.com/edgesentry/documaris) form the EdgeSentry platform — both operate on the same vessel entity (MMSI):

```
clarus (physical port safety)          documaris (port call documentation)
─────────────────────────────          ───────────────────────────────────
Near-miss detection · Physics alerts   FAL Form 1 · BWM certificate check
Tamper-proof audit records             Compliance alerts · Audit record
https://clarus.edgesentry.io/live      https://documaris.edgesentry.io/analysis/
         │                                       │
         └──────────── same vessel (MMSI) ───────┘
```

Both apps accept `?mmsi=<mmsi>` for deep-linking. The clarus operations monitor links forward to the vessel's port call documents in documaris, and vice versa.

## Quick start

```bash
# 1. Build eds engine (sibling checkout required)
cd ../edgesentry-rs && cargo build -p eds

# 2. Run GUI
cd ../clarus/ui && npm install && npm run tauri dev
```

## Agent Skills

```bash
npx skills add https://github.com/edgesentry/clarus
```

## Scope

Commercial regulatory profiles are supplied externally via `--profile <path>`. This repo contains only the OSS demo profile.

## License

Apache-2.0 OR MIT
