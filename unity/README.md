# clarus Unity Scene — Setup Guide

Minimal Unity scene that streams entity positions to clarus via UDP at 10 Hz.

**Unity version:** 2023 LTS (2023.2.x or later)  
**No additional packages required** — uses only the Unity standard library (UdpClient is in `System.Net.Sockets`).

---

## Quick scene setup (5 minutes)

### 1. Create a new Unity project

- New project → 3D (Core) template
- Name: `clarus-terminal-yard`

### 2. Copy the C# scripts

Copy the three scripts from `unity/Scripts/` into `Assets/Scripts/` in your Unity project:

```
Assets/
  Scripts/
    ClarusEntity.cs
    ClarusUdpExporter.cs
    ForkliftPath.cs
```

### 3. Build the scene

**Ground plane**
- Hierarchy → right-click → 3D Object → Plane
- Scale: (5, 1, 5) — gives a 50 m × 50 m yard in world units
- Position: (0, 0, 0)

**Forklift (FL-01)**
- Hierarchy → right-click → 3D Object → Cube
- Name: `Forklift_FL01`
- Scale: (1.5, 1, 2.5) — approximate forklift footprint in metres
- Position: (0, 0.5, 0)
- Add component → `ClarusEntity`: set `entityId = "FL-01"`, `entityClass = Forklift`
- Add component → `ForkliftPath`: leave defaults (start -1 m, end 4 m, speed 1.4 m/s)

**Worker (W-03)**
- Hierarchy → right-click → 3D Object → Capsule
- Name: `Worker_W03`
- Scale: (0.5, 0.9, 0.5)
- Position: (3.2, 0.9, 0)  ← 3.2 m ahead of forklift start on x-axis
- Add component → `ClarusEntity`: set `entityId = "W-03"`, `entityClass = Person`

**Exporter manager**
- Hierarchy → right-click → Create Empty
- Name: `ClarusManager`
- Add component → `ClarusUdpExporter`
  - `Target Host`: `127.0.0.1`
  - `Target Port`: `9000`
  - `Tick Hz`: `10`
  - `Log Packets`: enable during initial testing

### 4. Run with clarus

Open a terminal in the `clarus` repo root and start the listener **before** pressing Play in Unity:

```bash
cargo run --bin clarus -- \
  --input udp://127.0.0.1:9000 \
  --profile profiles/sg-port-safety
```

Press **Play** in the Unity Editor. You should immediately see risk events in the terminal:

```
Listening on udp://127.0.0.1:9000 …
[t=1714209600123ms] RISK High  rule=MPA_CLEARANCE_5M  entities=["FL-01","W-03"]  value=3.20  threshold=5.00
[t=1714209600223ms] RISK High  rule=TTC_CRITICAL_3S   entities=["FL-01","W-03"]  value=2.29  threshold=3.00
```

---

## Coordinate mapping

Unity uses a left-handed Y-up coordinate system; clarus uses a flat 2D plane (x, y).

| Unity | clarus | Notes |
|---|---|---|
| `transform.position.x` | `x` | East–West axis |
| `transform.position.z` | `y` | North–South axis |
| `transform.position.y` | discarded | Vertical — not used |

`ClarusUdpExporter` handles this mapping automatically.

---

## Scripts reference

### `ClarusEntity.cs`

Attach to every GameObject that should appear in the entity stream.

| Field | Type | Description |
|---|---|---|
| `entityId` | string | Unique ID sent in every packet (`"FL-01"`, `"W-03"`) |
| `entityClass` | EntityClass | Must match an `EntityClass` variant in `clarus-engine` |

### `ClarusUdpExporter.cs`

Attach to one manager GameObject. Discovers all `ClarusEntity` instances automatically.

| Field | Default | Description |
|---|---|---|
| `targetHost` | `127.0.0.1` | IP of the machine running `clarus` |
| `targetPort` | `9000` | UDP port — must match `--input udp://HOST:PORT` |
| `tickHz` | `10` | Packets per second |
| `logPackets` | false | Log each packet to the Unity Console |

### `ForkliftPath.cs`

Attach to the forklift alongside `ClarusEntity`. Drives a looping straight-line path.

| Field | Default | Description |
|---|---|---|
| `startPosition` | (-1, 0, 0) | World-space start |
| `endPosition` | (4, 0, 0) | World-space end |
| `speed` | 1.4 m/s | Matches MPA scenario in `fixtures/forklift_approach.csv` |
| `pauseAtEnd` | 2 s | Pause before looping back to start |

---

## Acceptance test

The scene meets the issue #6 acceptance criteria when:

1. Unity Play mode starts and the exporter logs `Streaming to udp://127.0.0.1:9000 at 10 Hz`
2. `clarus` prints `MPA_CLEARANCE_5M` (distance < 5 m) within the first packet
3. `TTC_CRITICAL_3S` fires with a value below 3.0 s as FL-01 accelerates toward W-03
4. After the forklift reaches the end position and pauses, no TTC event fires (approach rate = 0)

Run the automated end-to-end test to confirm:

```bash
# Terminal 1 — start Unity scene in Play mode first
# Terminal 2
./scripts/test-e2e.sh --no-explain   # stage 5 uses UDP; confirm events printed
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No packets received by clarus | Ensure Unity is in Play mode and `ClarusManager` has the exporter component |
| `Port already in use` | Change `targetPort` in the exporter and `--input udp://127.0.0.1:<port>` in clarus |
| Velocity always 0 | Check that `tickHz` in the exporter matches the actual tick rate; verify `ForkliftPath` is moving the transform |
| Wrong entity class | `EntityClass` enum in `ClarusEntity.cs` must match the variants in `crates/engine/src/entity.rs` exactly |
