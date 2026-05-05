---
name: clarus-setup
description: Set up clarus development environment — Rust toolchain, Node.js, Tauri CLI, and edgesentry-rs sibling checkout. Use when onboarding a new machine or when the build environment is broken.
license: Apache-2.0
compatibility: Requires macOS or Linux, curl, brew (macOS)
metadata:
  repo: clarus
---

## Prerequisites

Both repos must be siblings:
```
edgesentry/
  edgesentry-rs/   ← must exist at this path
  clarus/          ← this repo
```

## 1. Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 2. Node.js ≥ 18

```bash
# macOS
brew install node
# or: mise install node
```

## 3. Tauri CLI

```bash
cargo install tauri-cli --version "^2"
```

## 4. Build eds CLI (from edgesentry-rs)

```bash
cd ../edgesentry-rs && cargo build -p eds
```

## 5. Install frontend deps

```bash
cd ui && npm install
```
