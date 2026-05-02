# clarus Unity Scene — Setup Guide

Two scenes for the PIER71 / CAP Vista demo video.

| Scene | Description | Profile |
|-------|-------------|---------|
| **Scene 1** — Port Safety | Forklift approaches pedestrian in terminal yard | `profiles/demo` |
| **Scene 2** — Maritime Security | Vessel approaches Singapore restricted zone | `profiles/sg-maritime-security` |

**Unity version:** 2023 LTS (2023.2.x or later)  
**No additional packages required** — uses only the Unity standard library (`UdpClient` is in `System.Net.Sockets`).

## Scripts

| Script | Attach to | Purpose |
|--------|-----------|---------|
| `ClarusEntity.cs` | Every tracked GameObject | Marks entity with ID + class |
| `ClarusUdpExporter.cs` | One empty manager object | Broadcasts all entities via UDP |
| `ForkliftPath.cs` | Forklift object (Scene 1) | Straight-line approach path |
| `VesselPath.cs` | Vessel object (Scene 2) | East-bound approach to zone |
| `ZoneBoundary.cs` | Empty zone object (Scene 2) | Draws restricted zone rectangle |

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
  --profile profiles/demo
```

Press **Play** in the Unity Editor. You should immediately see risk events in the terminal:

```
Listening on udp://127.0.0.1:9000 …
[t=1714209600123ms] RISK High  rule=PROXIMITY_ALERT  entities=["FL-01","W-03"]  value=3.20  threshold=5.00
[t=1714209600223ms] RISK High  rule=TTC_ALERT   entities=["FL-01","W-03"]  value=2.29  threshold=3.00
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
2. `clarus` prints `PROXIMITY_ALERT` (distance < 5 m) within the first packet
3. `TTC_ALERT` fires with a value below 3.0 s as FL-01 accelerates toward W-03
4. After the forklift reaches the end position and pauses, no TTC event fires (approach rate = 0)

Run the automated end-to-end test to confirm:

```bash
# Terminal 1 — start Unity scene in Play mode first
# Terminal 2
./scripts/test-e2e.sh --no-explain   # stage 5 uses UDP; confirm events printed
```

---

---

## Scene 2 — Maritime Security (CAP Vista Tier-2)

Vessel V-001 approaches Singapore restricted zone at 2 m/s. Zone entry fires `RESTRICTED_ZONE_APPROACH HIGH` at x = 300 m (≈ t = 150 s).

### Build the scene

**Ground/water plane**
- 3D Object → Plane, scale (70, 1, 70) — covers 700 × 700 m
- Set material to a blue water shader or flat blue colour

**Vessel (V-001)**
- 3D Object → Cube, scale (20, 5, 8) — rough vessel silhouette
- Name: `Vessel_V001`
- Position: (0, 2.5, 350) — starts at world (0, 350), centre of zone y-range
- Add `ClarusEntity`: `entityId = "V-001"`, `entityClass = Vessel`
- Add `VesselPath`: leave defaults (start 0 m, end 700 m, speed 2 m/s)

**Restricted zone**
- Hierarchy → Create Empty, name `RestrictedZone`
- Add `ZoneBoundary`: xMin=300, xMax=600, zMin=200, zMax=500
- The zone outline and label appear automatically in Play mode

**Camera**
- Position: (350, 600, 350) — top-down, looking straight down
- Rotation: (90, 0, 0)
- Orthographic size: 380 — frames the 700 m world

**Manager**
- Create Empty → `ClarusManager`
- Add `ClarusUdpExporter`: targetPort=9000, tickHz=10

### Run with clarus

```bash
# Terminal 1 — start eds UDP listener
eds ingest stream \
  --source udp://127.0.0.1:9000 \
  --profile profiles/sg-maritime-security \
  --out /tmp/vessel-events.jsonl

# Press Play in Unity — vessel moves east at 2 m/s
# At t ≈ 150 s, clarus prints:
# [HIGH] RESTRICTED_ZONE_APPROACH — entities: ["V-001"] — value: 1.0 (zone member)
```

### Acceptance criteria

1. Vessel starts at x = 0, moves east at 2 m/s
2. At x = 300 m: `RESTRICTED_ZONE_APPROACH HIGH` fires in clarus
3. Zone boundary turns red (`ZoneBoundary.OnAlert(true)`)
4. Event shows: `regulation = "Singapore Infrastructure Protection Act (Cap. 136A) §18"`

---

## Demo video script (5 min, 1080p)

| Time | Content |
|------|---------|
| 0:00–0:20 | Scene 1 overview — terminal yard, forklift + worker visible |
| 0:20–1:30 | Forklift approaches slowly → no alert. Accelerates → `MPA_CLEARANCE_5M HIGH` fires |
| 1:30–2:00 | TTC drops → `TTC_CRITICAL_3S HIGH` fires, regulation citation shown |
| 2:00–2:45 | Click event → LLM explanation panel opens |
| 2:45–3:30 | "Generate PDF Report" → report opens, audit chain → ✓ verified |
| 3:30–3:45 | Switch to Scene 2 (maritime) |
| 3:45–5:00 | Vessel approaches from west → crosses zone boundary → `RESTRICTED_ZONE_APPROACH HIGH` |

Export as `demo-edgesentry-2026.mp4` at 1080p 30fps.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No packets received by clarus | Ensure Unity is in Play mode and `ClarusManager` has the exporter component |
| `Port already in use` | Change `targetPort` in the exporter and `--input udp://127.0.0.1:<port>` in clarus |
| Velocity always 0 | Check that `tickHz` in the exporter matches the actual tick rate; verify `ForkliftPath` is moving the transform |
| Wrong entity class | `EntityClass` enum in `ClarusEntity.cs` must match the variants in `crates/engine/src/entity.rs` exactly |
| Vessel at wrong position | Check `VesselPath.startPosition` — Unity z = world y, so z should be 350 for centre of zone |
| Zone not visible | Ensure `ZoneBoundary` script is on an active GameObject; `LineRenderer` requires a scene with a camera |
| Alert fires too early / late | Confirm `zoneEntryX = 300` in `VesselPath` and zone polygon in `sg-maritime-security/rules.json` matches |
