# AGENTS

Tauri GUI application layer for edgesentry-rs. The engine, CLI, and all pipeline crates live in edgesentry-rs — no pipeline logic belongs here.

## Checkout requirement

Both repos must be siblings:
```
edgesentry/
  edgesentry-rs/   ← Rust engine + eds CLI
  clarus/          ← this repo (GUI)
```

`ui/src-tauri/Cargo.toml` uses `path = "../../../edgesentry-rs/crates/..."`.

## Directory map

| Path | Purpose |
|---|---|
| `ui/src/` | Vite/React frontend |
| `ui/src-tauri/src/` | Tauri commands (`report.rs`, `evaluate.rs`, `explain.rs`, `replay.rs`, `audit.rs`) |
| `ui/src-tauri/Cargo.toml` | Path deps → edgesentry-rs crates |
| `profiles/demo/` | OSS demo profile (generic rule citations, no real regulations) |
| `profiles/sg-port-safety/` | MPA Port Safety Circulars + MOM WSH |
| `profiles/sg-maritime-security/` | AIS gap + restricted zone (SOLAS V/19, IPA §18) |
| `profiles/sg-port-compliance/` | FAL / BWM compliance rules |
| `fixtures/` | CSV fixtures for demo scenarios |
| `scripts/run_local_demo.sh` | Full 14-stage pipeline demo |
| `scripts/run_llama.sh` | Start local LLM server for explain step |

## Key design decisions

| Decision | Detail |
|---|---|
| Path deps to edgesentry-rs | Both repos must be siblings. |
| Profiles at runtime | No commercial content compiled into binary. `--profile <path>` is a runtime argument. |
| OSS boundary | `clarus` and `edgesentry-rs` contain no commercial regulatory content. |
| Tauri calls crates directly | Tauri backend links edgesentry-rs crates via Cargo — not via the `eds` CLI binary. |

## Coding conventions

- Rust: same as edgesentry-rs (`thiserror`, no `unwrap`, Rust 2021)
- Frontend: TypeScript strict mode

## Commit convention

Conventional Commits (`fix:`, `feat:`, `feat!:`)

## Docs

- Audit chain design: `docs/ref-audit-chain.md`
- R2 data layout: `docs/ref-r2-data-layout.md`
- User personas: `docs/ui-personas.md`
- Roadmap: `docs/roadmap/index.md`

## Agent Skills

```bash
npx skills add edgesentry/clarus
```

| Skill | Trigger |
|---|---|
| `/clarus-setup` | Onboarding a new machine; build environment broken |
| `/clarus-run-gui` | Developing or testing the Tauri GUI |
| `/clarus-run-demo` | Running the 14-stage demo or TC1/TC2 doc compliance verification |
| `/clarus-llm-setup` | Dispatch Brief generation failing; explain step needed |
