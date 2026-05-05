---
name: clarus-run-gui
description: Run the clarus Tauri desktop application locally. Use when developing or testing the GUI.
license: Apache-2.0
compatibility: Requires Rust toolchain, Node.js ≥ 18, Tauri CLI, edgesentry-rs sibling checkout
metadata:
  repo: clarus
---

## Step 1 — Build the engine (if not already built)

```bash
cd ../edgesentry-rs && cargo build -p eds
```

## Step 2 — Run the Tauri app

```bash
cd ui && npm run tauri dev
```

Opens the desktop app with Vite hot-reload. The Tauri backend links directly to edgesentry-rs crates via Cargo path dependencies.

## Point at a profile

```bash
# OSS demo profile
--profile ../clarus/profiles/demo

# Commercial profile (external)
--profile /path/to/commercial-profiles/sg-port-safety
```
