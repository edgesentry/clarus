# clarus

**clarus is the GUI application layer for the [edgesentry-rs](https://github.com/edgesentry/edgesentry-rs) safety and compliance toolkit.**

The Rust engine, CLI, and all pipeline crates live in **[edgesentry/edgesentry-rs](https://github.com/edgesentry/edgesentry-rs)**. This repository contains:

- `ui/` — Tauri desktop application (browser demo, report viewer, audit chain verifier)
- `unity/` — Unity C# UDP exporter scripts for simulation input
- `scripts/` — local development and e2e test scripts
- `profiles/` — demo regulatory profile (reference copy; commercial profiles in `clarus-commercial`)
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

## Open / commercial boundary

| What | Repo | License |
|---|---|---|
| Physics engine, CLI, audit crate, report crate | `edgesentry/edgesentry-rs` | Apache-2.0 / MIT |
| Tauri GUI, Unity scripts, demo fixtures | `edgesentry/clarus` (this repo) | Apache-2.0 / MIT |
| Demo profile (`profiles/demo/`) — generic citations | `edgesentry/clarus` (this repo) | Apache-2.0 / MIT |
| Production profiles (`sg-port-safety`, `sg-maritime-security`, …) | `edgesentry/clarus-commercial` | Commercial |
| Regulatory knowledge bases (MPA, MOM, COLREGs KB text) | `edgesentry/clarus-commercial` | Commercial |
| Submission documents (PIER71, CAP Vista) | `edgesentry/clarus-commercial` | Confidential |

**Rule:** anything a PoC or demo needs to run end-to-end belongs in this repo.
Anything that encodes jurisdiction-specific regulatory expertise — and would be worth
paying for as a standalone deliverable — belongs in `clarus-commercial`.

The demo profile (`profiles/demo/`) uses generic rule citations ("Site Safety Procedure §N.N").
Production deployments use commercial profiles with jurisdiction-specific regulation citations.
The engine and GUI are identical in both cases.

## License

Engine: [Apache-2.0](https://github.com/edgesentry/edgesentry-rs/blob/main/LICENSE-APACHE) / [MIT](https://github.com/edgesentry/edgesentry-rs/blob/main/LICENSE-MIT) — see edgesentry-rs.

Profiles: commercial license — see `clarus-commercial`.
