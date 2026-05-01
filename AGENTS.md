# AGENTS.md — clarus

Runbook for AI agents working in this repository.

---

## Repository roles

```
edgesentry-rs/          OSS — Rust crates + eds CLI (no deps on other repos)
clarus/                 OSS — Tauri GUI app (depends on edgesentry-rs via path)
```

The binary is profile-agnostic. Commercial profiles with jurisdiction-specific regulatory
content are loaded at **runtime** via `--profile <path>` and are not part of this repo.

---

## Checkout layout required

Both repos must be checked out as siblings:

```
edgesentry/
  edgesentry-rs/        ← Rust engine + eds CLI
  clarus/               ← this repo (GUI)
```

The Tauri backend uses `path = "../../../edgesentry-rs/crates/..."` — this resolves
only when the two repos are siblings at the same directory level.

---

## Build and run

### Prerequisites (one-time)

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node.js ≥ 18 (for Tauri frontend)
# macOS:
brew install node
# or use mise: mise install node

# Tauri CLI
cargo install tauri-cli --version "^2"

# LLM server (for explain step — optional)
brew install llama.cpp   # macOS
# or download from https://github.com/ggml-org/llama.cpp/releases
```

### Step 1 — Build the eds CLI (edgesentry-rs)

```bash
cd ../edgesentry-rs
cargo build -p eds
# binary: ../edgesentry-rs/target/debug/eds
```

### Step 2 — Run the GUI app (Tauri)

```bash
cd ui
npm install
npm run tauri dev
```

This starts the Vite dev server and opens the desktop app. The Tauri backend
links directly to edgesentry-rs crates via Cargo path dependencies.

### Step 3 — Point at a profile

The GUI and CLI use `--profile <dir>` to select the regulatory profile:

```bash
# OSS demo (generic rules, no real regulation citations)
--profile ../clarus/profiles/demo

# Commercial profiles are supplied separately and passed via --profile <path>
--profile /path/to/commercial-profiles/sg-port-safety
```

---

## Run the CLI pipeline manually

```bash
# From edgesentry-rs/
PROFILE=../clarus/profiles/demo   # use your own profile path for production

# 1. Ingest
./target/debug/eds ingest replay \
  --source ../clarus/fixtures/forklift_approach.csv \
  --profile $PROFILE \
  --out /tmp/frames.jsonl

# 2. Evaluate
./target/debug/eds evaluate run \
  --input /tmp/frames.jsonl \
  --profile $PROFILE \
  --out /tmp/events.jsonl

# 3. Assess
./target/debug/eds assess run \
  --input /tmp/events.jsonl \
  --out /tmp/assessment.jsonl

# 4. Explain (requires LLM server — run scripts/run_llama.sh first)
./target/debug/eds explain run \
  --input /tmp/events.jsonl \
  --llm-url http://localhost:8080 \
  --profile $PROFILE \
  --n 3 \
  --out /tmp/explanations.jsonl

# 5. Report
./target/debug/eds report generate \
  --events /tmp/events.jsonl \
  --assessment /tmp/assessment.jsonl \
  --site-name "Demo Site" \
  --out /tmp/report.md
```

---

## Run document compliance demo (documaris)

```bash
# From edgesentry-rs/
PROFILE=/path/to/port-compliance-profile   # supply a profile with document compliance rules

# TC1 — compliant
./target/debug/eds parse maritime \
  --source crates/edgesentry-document/fixtures/voyage_V001_compliant.csv \
  --out /tmp/entity.jsonl
./target/debug/eds document fill --input /tmp/entity.jsonl --template fal-form-1 --out /tmp/filled.jsonl
./target/debug/eds document check --input /tmp/filled.jsonl --profile $PROFILE --out /tmp/alerts.jsonl

# TC2 — BWM expired (expect HIGH alert)
./target/debug/eds parse maritime \
  --source crates/edgesentry-document/fixtures/voyage_V002_bwm_expired.csv \
  --out /tmp/entity2.jsonl
./target/debug/eds document fill --input /tmp/entity2.jsonl --template fal-form-1 --out /tmp/filled2.jsonl
./target/debug/eds document check --input /tmp/filled2.jsonl --profile $PROFILE --out /tmp/alerts2.jsonl
```

---

## Run maritime security demo (PIER71-07)

```bash
# From edgesentry-rs/
PROFILE=/path/to/maritime-security-profile   # supply a profile with zone_member rules

./target/debug/eds ingest replay \
  --source crates/edgesentry-ingest/fixtures/vessel_zone_approach.csv \
  --profile $PROFILE \
  --out /tmp/vessel_frames.jsonl

./target/debug/eds evaluate run \
  --input /tmp/vessel_frames.jsonl \
  --profile $PROFILE \
  --out /tmp/vessel_alerts.jsonl

# Expected: RESTRICTED_ZONE_APPROACH HIGH fires at t=152500ms
```

---

## LLM server (optional — for explain step)

```bash
cd scripts
./run_llama.sh
# starts llama-server at http://localhost:8080
# default model: bartowski/Llama-3.2-3B-Instruct-GGUF
```

---

## Directory structure

```
clarus/
  ui/                       Tauri desktop application
    src/                    JavaScript frontend (Vite)
    src-tauri/              Rust Tauri backend
      src/                  Tauri commands (report, evaluate, etc.)
      Cargo.toml            Path deps → ../../../edgesentry-rs/crates/...
      tauri.conf.json       App config
  fixtures/                 CSV fixtures for demo scenarios
  profiles/
    demo/                   Generic demo profile (OSS, no real reg citations)
  scripts/
    run_llama.sh            Start local LLM server
    test-e2e.sh             End-to-end test script
    sim-unity-udp.py        Unity UDP simulation helper
  unity/                    Unity C# scripts for simulation input
```

---

## Key design decisions

| Decision | Detail |
|---|---|
| Path deps to edgesentry-rs | `clarus/ui/src-tauri/Cargo.toml` uses `path = "../../../edgesentry-rs/crates/..."`. Both repos must be siblings. |
| Profiles loaded at runtime | No commercial content is compiled into the binary. `--profile <path>` is a runtime argument. |
| OSS boundary | `clarus` and `edgesentry-rs` contain no commercial regulatory content. The binary is profile-agnostic. |
| GUI calls eds via Tauri commands | The Tauri backend calls edgesentry-rs crates directly (not the CLI binary). |
