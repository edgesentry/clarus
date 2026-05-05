# clarus

**clarus is the GUI application layer for the [edgesentry-rs](https://github.com/edgesentry/edgesentry-rs) safety and compliance toolkit.**

The Rust engine, CLI, and all pipeline crates live in **[edgesentry/edgesentry-rs](https://github.com/edgesentry/edgesentry-rs)**. This repository contains:

- `ui/` — Tauri desktop application (browser demo, report viewer, audit chain verifier)
- `unity/` — Unity C# UDP exporter scripts for simulation input
- `scripts/` — local development and e2e test scripts
- `profiles/` — demo regulatory profile (generic rule citations for OSS demo)
- `fixtures/` — test CSV fixtures for the demo scenario

---

## Architecture

```
edgesentry-rs (engine + CLI)        clarus (this repo — app layer)
────────────────────────────        ──────────────────────────────
eds ingest replay/stream            ui/  ← Tauri GUI
eds compute run                         displays reports, verifies
eds evaluate run                        audit chains, manages profiles
eds assess run
eds explain run
eds report generate
eds audit sign / verify
```

The `eds` CLI is the integration point. The GUI calls `eds` subcommands and renders their JSONL output.

---

## Run the pipeline (CLI)

```bash
# 1. Build eds from edgesentry-rs
cd ../edgesentry-rs && cargo build -p eds

# 2. Run the full demo (14 stages)
bash scripts/run_local_demo.sh --no-pause

# 3. Or run the e2e test
cd ../clarus && bash scripts/test-e2e.sh --no-pause --no-explain
```

---

## Demo flow (safety monitoring)

```bash
eds ingest replay --source fixtures/forklift_approach.csv \
  --profile profiles/demo --out frames.jsonl
eds evaluate run --input frames.jsonl --profile profiles/demo --out events.jsonl
eds explain run --input events.jsonl --llm-url http://localhost:8080 \
  --profile profiles/demo --n 2 --out explanations.jsonl
eds report generate --events events.jsonl --assessment assessment.jsonl \
  --site-name "Demo Site" --out report.md
```

---

## Platform integration

clarus is one of two products in the EdgeSentry platform. Both operate on the **same vessel entity**.

```
clarus (vessel risk intelligence)          documaris (port call documentation)
─────────────────────────────────          ───────────────────────────────────
AIS gaps · STS transfers                   FAL Form 1 · BWM certificate check
Behavioural risk score                     Compliance alerts · Audit record
https://clarus-d5d.pages.dev               https://documaris.pages.dev
         │                                          │
         └──────────── same vessel (MMSI) ──────────┘
```

### Analytics app (`analytics/`)

In addition to the Tauri desktop app, this repo contains a Cloudflare Pages web app at `analytics/` — the live vessel risk scorecard at **[clarus-d5d.pages.dev](https://clarus-d5d.pages.dev)**. Built with TypeScript + Vite, querying vessel Parquet data from R2 via DuckDB-WASM in the browser.

### Cross-link deep-link API

The analytics app accepts `?mmsi=<mmsi>` to auto-select a vessel:

```
https://clarus-d5d.pages.dev?mmsi=563012345
```

When a vessel is selected, the scorecard header shows **"View port call documents in documaris →"** linking to `https://documaris.pages.dev?mmsi=<mmsi>`. documaris accepts the same param and runs the FAL Form 1 pipeline for that vessel immediately.

See [`edgesentry-commercial/docs/strategy/platform-story.md`](https://github.com/edgesentry/edgesentry-commercial) for the full platform narrative.

---

## Open / commercial boundary

| What | Repo | License |
|---|---|---|
| Physics engine, CLI, audit crate, report crate | `edgesentry/edgesentry-rs` | Apache-2.0 / MIT |
| Tauri GUI, Unity scripts, demo fixtures | `edgesentry/clarus` (this repo) | Apache-2.0 / MIT |
| Demo profile (`profiles/demo/`) — generic citations | `edgesentry/clarus` (this repo) | Apache-2.0 / MIT |
| Production profiles with jurisdiction-specific regulatory citations | separate commercial repo | Commercial |

**Rule:** anything a PoC or demo needs to run end-to-end belongs in this repo.
The demo profile (`profiles/demo/`) uses generic rule citations ("Site Safety Procedure §N.N").
Production deployments supply a commercial profile via `--profile <path>`.
The engine and GUI are identical in both cases — profiles are loaded at runtime.

## License

Engine: [Apache-2.0](https://github.com/edgesentry/edgesentry-rs/blob/main/LICENSE-APACHE) / [MIT](https://github.com/edgesentry/edgesentry-rs/blob/main/LICENSE-MIT) — see edgesentry-rs.

Profiles: the demo profile in this repo is Apache-2.0 / MIT. Production profiles with
jurisdiction-specific regulatory content are distributed separately under a commercial license.
