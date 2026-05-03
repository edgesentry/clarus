/// CV dummy stream — generates synthetic EntityFrames for two scenarios.
///
/// Confidence values are deterministic functions of (cycle, frame, entity_index)
/// so the demo is reproducible without randomness.
use edgesentry_types::{Entity, EntityClass, SensorReading, Vec2};

#[derive(Debug, Clone)]
pub struct Frame {
    pub timestamp_ms: u64,
    pub entities: Vec<Entity>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Scenario {
    /// Forklift approaches worker — PROXIMITY_ALERT + TTC_ALERT
    PortSafety,
    /// Vessel enters restricted zone — RESTRICTED_ZONE_APPROACH
    Maritime,
}

impl Scenario {
    pub fn from_profile(profile: &str) -> Self {
        if profile.contains("maritime") {
            Scenario::Maritime
        } else {
            Scenario::PortSafety
        }
    }
}

/// Generate 10 frames for one cycle of the given scenario.
pub fn generate_frames(scenario: &Scenario, cycle: u64, base_ms: u64) -> Vec<Frame> {
    (0..10)
        .map(|f| match scenario {
            Scenario::PortSafety => port_safety_frame(cycle, f, base_ms + f * 500),
            Scenario::Maritime   => maritime_frame(cycle, f, base_ms + f * 500),
        })
        .collect()
}

/// Simulate anchor drift score in metres. Mostly stable with occasional spikes.
///
/// VALID        drift < 0.3 m
/// DEGRADED     0.3 ≤ drift < 0.6 m   (every 8 cycles)
/// UNCALIBRATED drift ≥ 0.6 m          (every 12 cycles)
pub fn drift_score(cycle: u64) -> f32 {
    let base = 0.02 + 0.01 * ((cycle as f32 * 0.3).sin());
    let spike = if cycle % 12 == 11 {
        0.65  // UNCALIBRATED
    } else if cycle % 8 >= 6 {
        0.38  // DEGRADED
    } else {
        0.0
    };
    (base + spike).min(1.0)
}

// ── Port safety ───────────────────────────────────────────────────────────────

fn port_safety_frame(cycle: u64, frame: u64, timestamp_ms: u64) -> Frame {
    let step = 11.0_f32 / 14.0;
    // Forklift x oscillates: closes from 12m, then resets
    let raw = 12.0 - ((cycle * 10 + frame) % 15) as f32 * step * 0.8;
    let fl_x = raw.max(0.5);

    Frame {
        timestamp_ms,
        entities: vec![
            Entity {
                id: "FL-01".into(),
                class: EntityClass::Forklift,
                position: Vec2::new(fl_x, 0.0),
                velocity: Vec2::new(-step * 0.8, 0.0),
                timestamp_ms,
                sensor: Some(SensorReading::simulation()),
            },
            Entity {
                id: "W-03".into(),
                class: EntityClass::Person,
                position: Vec2::new(12.0, 0.0),
                velocity: Vec2::new(0.0, 0.0),
                timestamp_ms,
                sensor: Some(SensorReading::simulation()),
            },
        ],
    }
}

// ── Maritime ──────────────────────────────────────────────────────────────────

fn maritime_frame(cycle: u64, frame: u64, timestamp_ms: u64) -> Frame {
    // Vessel x: 0 → 700, loops every 35 cycles × 10 frames = 350 frames
    let pos = ((cycle * 10 + frame) % 350) as f32 * 2.0;

    Frame {
        timestamp_ms,
        entities: vec![
            Entity {
                id: "V-001".into(),
                class: EntityClass::Vessel,
                position: Vec2::new(pos, 350.0),
                velocity: Vec2::new(2.0, 0.0),
                timestamp_ms,
                sensor: Some(SensorReading::simulation()),
            },
        ],
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_safety_generates_10_frames() {
        let frames = generate_frames(&Scenario::PortSafety, 0, 0);
        assert_eq!(frames.len(), 10);
        assert_eq!(frames[0].entities.len(), 2);
    }

    #[test]
    fn maritime_generates_10_frames() {
        let frames = generate_frames(&Scenario::Maritime, 0, 0);
        assert_eq!(frames.len(), 10);
        assert_eq!(frames[0].entities[0].id, "V-001");
    }

    #[test]
    fn drift_score_uncalibrated_at_cycle11() {
        assert!(drift_score(11) >= 0.6, "cycle 11 should be UNCALIBRATED");
    }

    #[test]
    fn drift_score_valid_at_cycle0() {
        assert!(drift_score(0) < 0.3, "cycle 0 should be VALID");
    }
}
