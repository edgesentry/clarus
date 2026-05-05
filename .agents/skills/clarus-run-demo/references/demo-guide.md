# clarus — Demo Guide

Two independent demo paths depending on the audience:

| Path | What it shows | URL |
|---|---|---|
| **Web demo** (CAP Vista / PIER71) | Flow 1 (live alerts) → Flow 2 (vessel scorecard) → audit chain | `clarus-analytics.pages.dev` |
| **CLI demo** (technical deep-dive) | Rust rule engine, physics vs generic AI, LLM explanation | local terminal |

---

## Web Demo — CAP Vista / PIER71

### Architecture

```
Edge daemon (local)
  clarus/edge/   →  clarus-dev-public-raw     →  /live  Operations Monitor
                 →  clarus-dev-public-audit   →  /audit (coming: #55)

Synthetic data
  generate_synthetic.py  →  clarus-dev-public-analytics  →  /  Risk Intelligence
```

### Prerequisites

| Tool | Required for | Install |
|---|---|---|
| Rust / Cargo | Edge daemon | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| wrangler | R2 uploads | `npm i -g wrangler && wrangler login` |
| Python 3 + pandas + pyarrow | Synthetic data generation | `pip install pandas pyarrow numpy` |
| llama.cpp + Caddy | LLM alert explanations (optional) | `brew install llama.cpp caddy` |

### Step 1 — Start the edge daemon

```bash
cd clarus/edge
./run.sh
```

`config.env` is loaded automatically. Key settings:

```bash
SITE_ID=site_sgp_001
PROFILE=sg-maritime-security   # maritime scenario — generates V-001 vessel alerts
STORAGE_BACKEND=wrangler       # uses existing wrangler login, no extra credentials
HEARTBEAT_INTERVAL=30          # heartbeat upload every 30 s
```

The daemon runs a loop: generate CV frames → evaluate rules → sign AuditRecord → upload to R2.

To persist the signing key across restarts (recommended for demo):

```bash
# Generate a key once and add to config.env
cargo run -- --private-key-hex "" 2>&1 | grep PRIVATE_KEY_HEX
# → WARN PRIVATE_KEY_HEX not set — generated ephemeral key. Set PRIVATE_KEY_HEX=<hex>
echo "PRIVATE_KEY_HEX=<hex from above>" >> config.env
```

### Step 2 — Generate synthetic vessel data (Flow 2)

```bash
cd clarus/analytics
source /path/to/.venv/bin/activate   # virtualenv with pandas + pyarrow
python scripts/generate_synthetic.py
```

Generates 500 synthetic vessels including demo spotlight MV Fortune Star (MMSI 563012345) and uploads to `clarus-dev-public-analytics`.

To regenerate live demo data (Flow 1):

```bash
python scripts/generate_live_demo.py
```

### Step 3 — Start local LLM (optional)

Enables AI-generated alert explanations in `/live`.

```bash
cd clarus
./scripts/run_llama.sh
```

Starts llama-server on `:8080` + Caddy HTTPS proxy on `:8443`. The analytics app calls `https://localhost:8443/v1/chat/completions`.

### Step 4 — Open the web app

| Page | URL | What to show |
|---|---|---|
| Operations Monitor | https://feat-analytics-scorecard.clarus-analytics.pages.dev/live | Flow 1 |
| Risk Intelligence | https://feat-analytics-scorecard.clarus-analytics.pages.dev/ | Flow 2 |

### Demo flow (5–7 min)

**Flow 1 — Operations Monitor** (`/live`)

1. **Site Status cards** — `site_sgp_001` with VALID / DEGRADED / UNCALIBRATED states
2. **Calibration Drift chart** — periodic spikes when drift > 0.3 m (DEGRADED) or > 0.6 m (UNCALIBRATED)
3. **Evidence Quality chart** — Rejected count rises when calibration degrades
4. **Recent Alerts** — filter to `RESTRICTED_ZONE_APPROACH`, click a **Certified** row
5. LLM explanation expands with evidence quality sentence injected deterministically
6. Click **"View V-001 vessel risk profile →"**

**Flow 2 — Risk Intelligence** (`/`)

7. MV Fortune Star auto-selected (same vessel as V-001)
8. Behavioral score **74.3 / 100**, HIGH RISK
9. **Premium Impact** section:
   - Traditional underwriting (flag/age/type only): **$180,000**
   - EdgeSentry signals: AIS gaps 14 ⚠, STS 3 ⚠, Sanctions proximity 2 hops ⚠
   - With EdgeSentry: **$340,000 (+89%)**
10. Actuarial Data Availability table — Layer A (incident outcome data) is the remaining gap

**Closing line**

> "Flow 1 collects tamper-evident evidence from the edge. Flow 2 turns that evidence into actuarially justifiable premium pricing. EdgeSentry closes the underwriting blind spot."

---

## CLI Demo — Technical Deep-dive

### Prerequisites

| Tool | Required for | Install |
|---|---|---|
| Rust / Cargo | All stages | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Python 3 | Live UDP simulation | pre-installed on macOS |
| Ollama | LLM explanation stage | `brew install ollama && ollama pull llama3.2` |

### Stage 1 — Rule engine with CSV fixture

```bash
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo
```

FL-01 (forklift) closes on W-03 (worker) over 15 frames. Expected output:

```
[t=1000ms] RISK High  rule=PROXIMITY_ALERT  value=3.20  threshold=5.00
[t=1000ms] RISK High  rule=TTC_ALERT        value=2.29  threshold=3.00
...
[t=2400ms] RISK High  rule=TTC_ALERT        value=0.89  threshold=3.00
```

### Stage 2 — LLM explanation

```bash
ollama serve
cargo run --bin clarus -- \
  --input file://fixtures/forklift_approach.csv \
  --profile profiles/demo \
  --explain
```

Each event gets a grounded plain-language explanation. `✓` = regulation clause verified against KB. `⚠ ungrounded` = LLM hallucinated a clause.

### Stage 3 — Live UDP

**Terminal 1:**
```bash
cargo run --bin clarus -- --input udp://127.0.0.1:9000 --profile profiles/demo
```

**Terminal 2:**
```bash
python3 scripts/sim-unity-udp.py                   # forklift approach
python3 scripts/sim-unity-udp.py --scenario safe   # safe pass — no alerts
```

### Simulator scenarios

| Scenario | Rules expected |
|---|---|
| `approach` (default) | `PROXIMITY_ALERT`, `TTC_ALERT` |
| `exclusion` | `EXCLUSION_ZONE_BREACH` |
| `safe` | none |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/live` shows "No live data yet" | Edge daemon not running or no data uploaded | Run `./edge/run.sh` and wait 30 s |
| LLM explanation shows "LLM offline" | llama.cpp not running | `./scripts/run_llama.sh` |
| R2 upload failed | wrangler not logged in | `wrangler login` |
| `clarus-dev-public-audit` upload fails | Object Lock — delete attempted | Object Lock is working correctly; writes still succeed |
| Port 8443 already in use | Previous Caddy instance | `pkill caddy && ./scripts/run_llama.sh` |
