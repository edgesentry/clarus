#!/usr/bin/env python3
"""
Simulates a Unity simulation sending entity packets to clarus via UDP.

Replays a forklift (FL-01) approaching a stationary worker (W-03) at 1.4 m/s.
Each packet is a JSON object matching the UnityPacket schema that clarus expects.

Usage:
  python3 scripts/sim-unity-udp.py                         # defaults
  python3 scripts/sim-unity-udp.py --addr 127.0.0.1:9000   # target port
  python3 scripts/sim-unity-udp.py --count 20 --interval 0.1
  python3 scripts/sim-unity-udp.py --scenario exclusion     # zone breach scenario
"""

import argparse
import json
import socket
import time
import sys

# ── scenarios ─────────────────────────────────────────────────────────────────

def frames_forklift_approach(count: int):
    """FL-01 moves at 1.4 m/s toward W-03 at (3.2, 0). TTC breaches ~2.3 s from t=0."""
    frames = []
    x = 0.0
    for i in range(count):
        ts = 1000 + i * 100
        frames.append({
            "entities": [
                {"id": "FL-01", "class": "Forklift",
                 "x": round(x, 3), "y": 0.0, "vx": 1.4, "vy": 0.0,
                 "timestamp_ms": ts},
                {"id": "W-03", "class": "Person",
                 "x": 3.2, "y": 0.0, "vx": 0.0, "vy": 0.0,
                 "timestamp_ms": ts},
            ]
        })
        x += 0.14  # 1.4 m/s × 0.1 s
    return frames

def frames_exclusion_zone(count: int):
    """FL-01 moves into the [0,10]×[0,10] exclusion zone defined in rules.json."""
    frames = []
    for i in range(count):
        ts = 1000 + i * 100
        inside = i >= count // 3  # enters zone after 1/3 of frames
        x = 11.0 - (i * 0.4) if inside else 12.0  # approach from outside
        frames.append({
            "entities": [
                {"id": "FL-01", "class": "Forklift",
                 "x": round(x, 3), "y": 5.0, "vx": -1.4, "vy": 0.0,
                 "timestamp_ms": ts},
            ]
        })
    return frames

def frames_safe_pass(count: int):
    """FL-01 passes W-03 with >5 m lateral clearance — no rules should fire."""
    frames = []
    x = 0.0
    for i in range(count):
        ts = 1000 + i * 100
        frames.append({
            "entities": [
                {"id": "FL-01", "class": "Forklift",
                 "x": round(x, 3), "y": 6.0,  # 6 m lateral separation
                 "vx": 1.4, "vy": 0.0, "timestamp_ms": ts},
                {"id": "W-03", "class": "Person",
                 "x": 3.2, "y": 0.0, "vx": 0.0, "vy": 0.0,
                 "timestamp_ms": ts},
            ]
        })
        x += 0.14
    return frames

SCENARIOS = {
    "approach":  frames_forklift_approach,
    "exclusion": frames_exclusion_zone,
    "safe":      frames_safe_pass,
}

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Simulate Unity UDP output for clarus")
    parser.add_argument("--addr",     default="127.0.0.1:9000",
                        help="HOST:PORT of the clarus UDP listener (default: 127.0.0.1:9000)")
    parser.add_argument("--count",    type=int, default=15,
                        help="Number of frames to send (default: 15)")
    parser.add_argument("--interval", type=float, default=0.1,
                        help="Seconds between frames — simulates Unity tick rate (default: 0.1 = 10 Hz)")
    parser.add_argument("--scenario", choices=list(SCENARIOS.keys()), default="approach",
                        help="Which scenario to replay (default: approach)")
    args = parser.parse_args()

    host, port_str = args.addr.rsplit(":", 1)
    port = int(port_str)

    frames = SCENARIOS[args.scenario](args.count)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"Sending {len(frames)} '{args.scenario}' frames to udp://{host}:{port} "
          f"at {1/args.interval:.0f} Hz …", flush=True)

    for i, frame in enumerate(frames):
        payload = json.dumps(frame).encode()
        sock.sendto(payload, (host, port))
        ts = frame["entities"][0]["timestamp_ms"]
        n  = len(frame["entities"])
        print(f"  [{i+1:>3}/{len(frames)}] t={ts}ms  {n} entit{'y' if n==1 else 'ies'}  "
              f"{len(payload)} bytes", flush=True)
        if i < len(frames) - 1:
            time.sleep(args.interval)

    sock.close()
    print("Done.", flush=True)


if __name__ == "__main__":
    main()
