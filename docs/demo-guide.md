# clarus — Interactive Demo Guide

How to run the full end-to-end pipeline on a development machine: no Unity licence required, no cloud API.

---

## Prerequisites

| Tool | Required for | Install |
|---|---|---|
| Rust / Cargo | All stages | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Python 3 | Live UDP simulation | pre-installed on macOS |
| Ollama | LLM explanation stage | `brew install ollama` |
| llama3.2 model | LLM explanation stage | `ollama pull llama3.2` |

All stages except the LLM explanation work offline with no additional dependencies.

---

## Quick start — automated test

Run all five stages in one command from the repo root:

```bash
./scripts/test-e2e.sh
```

Skip stages you don't need:

```bash
./scripts/test-e2e.sh --no-explain          # skip Ollama (no LLM required)
./scripts/test-e2e.sh --no-udp              # skip live UDP
./scripts/test-e2e.sh --no-explain --no-udp # rule engine only
./scripts/test-e2e.sh --model mistral       # use a different local model
```

The script exits 0 on success and prints a coloured pass/fail summary.

---

## Stage-by-stage walkthrough

### Stage 1 — Rule engine with CSV fixture (no Ollama)

Replays `fixtures/forklift_approach.csv`: FL-01 (forklift at 1.4 m/s) closes on W-03 (stationary worker) over 15 frames. All computation is deterministic Rust — no LLM involved.

```bash
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo
```

Expected output (first and last frames):

```
Loaded 3 rules from profiles/demo/rules.json
Replaying 15 frames from fixtures/forklift_approach.csv
[t=1000ms] RISK High  rule=PROXIMITY_ALERT  entities=["FL-01","W-03"]  value=3.20  threshold=5.00  reg=Site Safety Procedure §3.1
[t=1000ms] RISK High  rule=TTC_ALERT   entities=["FL-01","W-03"]  value=2.29  threshold=3.00  reg=Site Safety Procedure §3.1
...
[t=2400ms] RISK High  rule=TTC_ALERT   entities=["FL-01","W-03"]  value=0.89  threshold=3.00  ...
Replay complete.
```

What to look for:
- `PROXIMITY_ALERT` fires every frame (distance stays below 5 m throughout)
- `TTC_ALERT` fires with decreasing value (2.29 s → 0.89 s) as FL-01 closes in
- `EXCLUSION_ZONE_BREACH` fires because both entities start inside the seed zone polygon

---

### Stage 2 — Rule engine with LLM explanation

Requires Ollama running locally. Start it first:

```bash
ollama serve          # starts the Ollama daemon (separate terminal or background)
ollama pull llama3.2  # one-time download ~2 GB
```

Then run clarus with the `--explain` flag:

```bash
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo \
  --explain
```

Each RiskEvent now gets a plain-language explanation line:

```
[t=1000ms] RISK High  rule=PROXIMITY_ALERT  entities=["FL-01","W-03"]  value=3.20  threshold=5.00  ...
  [EXPLANATION ✓] Forklift FL-01 is 3.20 m from worker W-03, which is below the 5-metre minimum
  clearance required by Site Safety Procedure §3.1. The vehicle operator must
  stop immediately or a banksman must be appointed before movement resumes.
```

The `✓` means the explanation is grounded — every regulation clause it cites (`§3.1`) was present in the retrieved KB snippet. An `⚠ ungrounded` marker means the LLM hallucinated a clause; that response is flagged but still printed so the operator can see it.

**Model options:**

```bash
# Use Mistral instead of Llama 3.2
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo \
  --explain \
  --model mistral

# Point to Ollama on another machine
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo \
  --explain \
  --ollama-url http://192.168.1.10:11434
```

---

### Stage 3 — Live UDP (two terminals)

Simulates Unity sending entity data in real time. Open two terminal windows in the repo root.

**Terminal 1 — start the listener:**

```bash
cargo run --bin clarus -- \
  --input udp://127.0.0.1:9000 \
  --profile profiles/demo
```

Output: `Listening on udp://127.0.0.1:9000 …`  (blocks, waiting for packets)

**Terminal 2 — send packets:**

```bash
# Default: forklift approach scenario, 15 frames at 10 Hz
python3 scripts/sim-unity-udp.py

# Zone breach scenario
python3 scripts/sim-unity-udp.py --scenario exclusion

# Safe pass — no rules should fire
python3 scripts/sim-unity-udp.py --scenario safe

# Custom parameters
python3 scripts/sim-unity-udp.py --addr 127.0.0.1:9000 --count 30 --interval 0.1
```

Simulator output:

```
Sending 15 'approach' frames to udp://127.0.0.1:9000 at 10 Hz …
  [  1/15] t=1000ms  2 entities  134 bytes
  [  2/15] t=1100ms  2 entities  136 bytes
  ...
Done.
```

Terminal 1 will print RiskEvents in real time as each packet arrives.

**With explanation (requires Ollama):**

```bash
# Terminal 1
cargo run --bin clarus -- \
  --input udp://127.0.0.1:9000 \
  --profile profiles/demo \
  --explain

# Terminal 2
python3 scripts/sim-unity-udp.py --interval 0.5  # slower, easier to read
```

---

## Simulator scenarios

| Scenario | Command | Rules expected to fire |
|---|---|---|
| `approach` | `--scenario approach` | `PROXIMITY_ALERT`, `TTC_ALERT` |
| `exclusion` | `--scenario exclusion` | `EXCLUSION_ZONE_BREACH` |
| `safe` | `--scenario safe` | none |

---

## Profile structure

The `--profile` flag points to a directory containing:

```
profiles/demo/
  rules.json        ← rule definitions (condition, severity, regulation citation)
  kb/
    PROXIMITY_ALERT.txt      ← regulation text retrieved for LLM prompt
    TTC_ALERT.txt
    EXCLUSION_ZONE_BREACH.txt
```

To test a different rule set, create a new profile directory with its own `rules.json` and `kb/` files and pass `--profile profiles/<your-profile>`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot bind UDP socket` | Port already in use | Change port: `--input udp://127.0.0.1:9001` and `--addr 127.0.0.1:9001` |
| `[EXPLANATION ERROR] Ollama request failed` | Ollama not running | `ollama serve` in a separate terminal |
| `Model 'llama3.2' not found` | Model not pulled | `ollama pull llama3.2` |
| No events printed during UDP test | Packets sent before listener ready | Wait for `Listening on udp://…` before sending |
| `Cannot read profiles/demo/rules.json` | Run from wrong directory | Run commands from repo root, not from `crates/` |
