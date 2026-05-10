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
    /// BCA Green Mark energy sensor monitoring — EUI / COP / LPD thresholds
    BcaGreenMark,
    /// OT/IT cybersecurity integrity — IACS UR E26/E27 software attestation
    OtCybersecurity,
}

impl Scenario {
    pub fn from_profile(profile: &str) -> Self {
        if profile.contains("bca-greenmark") || profile.contains("bca_greenmark") {
            Scenario::BcaGreenMark
        } else if profile.contains("ot-cyber") || profile.contains("ot_cyber") || profile.contains("cybersecurity") {
            Scenario::OtCybersecurity
        } else if profile.contains("maritime") {
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
            Scenario::PortSafety     => port_safety_frame(cycle, f, base_ms + f * 500),
            Scenario::Maritime       => maritime_frame(cycle, f, base_ms + f * 500),
            Scenario::BcaGreenMark   => bca_greenmark_frame(cycle, f, base_ms + f * 500),
            Scenario::OtCybersecurity => ot_cybersecurity_frame(cycle, f, base_ms + f * 500),
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
                position_z: None, velocity_z: None, computed_confidence: None, sensor_values: None,
            },
            Entity {
                id: "W-03".into(),
                class: EntityClass::Person,
                position: Vec2::new(12.0, 0.0),
                velocity: Vec2::new(0.0, 0.0),
                timestamp_ms,
                sensor: Some(SensorReading::simulation()),
                position_z: None, velocity_z: None, computed_confidence: None, sensor_values: None,
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
                position_z: None, velocity_z: None, computed_confidence: None, sensor_values: None,
            },
        ],
    }
}

// ── BCA Green Mark ────────────────────────────────────────────────────────────

fn bca_greenmark_frame(cycle: u64, _frame: u64, timestamp_ms: u64) -> Frame {
    // If BCA_EUI_FIXED / BCA_COP_FIXED / BCA_LPD_FIXED are set, use those values
    // directly instead of oscillating — enables deterministic E2E test scenarios.
    // Otherwise sensor values oscillate deterministically to cross thresholds:
    // eui_kwh_m2: base 105.0 + 15.0 * sin(cycle * 0.15) → oscillates 90–120 (threshold 115)
    // chiller_cop: base 0.60 + 0.08 * sin(cycle * 0.20) → oscillates 0.52–0.68 (threshold 0.65)
    // lpd_w_m2:   base 13.5 + 2.5  * sin(cycle * 0.10) → oscillates 11–16    (threshold 15)
    let fixed = |var: &str, default: f32| -> f32 {
        std::env::var(var).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(default)
    };
    let eui = fixed("BCA_EUI_FIXED", 105.0_f32 + 15.0 * (cycle as f32 * 0.15).sin());
    let cop = fixed("BCA_COP_FIXED", 0.60_f32  + 0.08 * (cycle as f32 * 0.20).sin());
    let lpd = fixed("BCA_LPD_FIXED", 13.5_f32  + 2.5  * (cycle as f32 * 0.10).sin());

    // Round to 1 decimal place for readability
    let round1 = |v: f32| -> f64 { (v * 10.0).round() as f64 / 10.0 };

    let mut sensor_values = std::collections::HashMap::new();
    sensor_values.insert("eui_kwh_m2".to_string(),  round1(eui));
    sensor_values.insert("chiller_cop".to_string(),  round1(cop));
    sensor_values.insert("lpd_w_m2".to_string(),     round1(lpd));

    Frame {
        timestamp_ms,
        entities: vec![
            Entity {
                id: "OUTLET-SENSORS".into(),
                class: EntityClass::Person,
                position: Vec2::new(0.0, 0.0),
                velocity: Vec2::new(0.0, 0.0),
                timestamp_ms,
                sensor: Some(SensorReading::simulation()),
                position_z: None, velocity_z: None, computed_confidence: None,
                sensor_values: Some(sensor_values),
            },
        ],
    }
}

// ── OT Cybersecurity ──────────────────────────────────────────────────────────

/// Simulate an OT device scan cycle.
///
/// The frame carries a `sensor_values` map with a single key:
/// - `unauthorized_components`: 0.0 (clean) or N > 0 (violation detected)
///
/// The ZKP prover (`OtIntegrityProgram`) generates the actual attestation
/// proof separately using `ot_integrity::sim_inputs()`.  The frame is used
/// by the rules engine to fire `OT_UNAUTHORIZED_SOFTWARE` when > 0.
fn ot_cybersecurity_frame(cycle: u64, _frame: u64, timestamp_ms: u64) -> Frame {
    // Every 7th cycle simulate a violation (matches sim_inputs logic)
    let unauthorized = if cycle % 7 == 6 { 1.0_f64 } else { 0.0_f64 };

    let mut sensor_values = std::collections::HashMap::new();
    sensor_values.insert("unauthorized_components".to_string(), unauthorized);
    sensor_values.insert("component_count".to_string(), 8.0_f64);

    Frame {
        timestamp_ms,
        entities: vec![Entity {
            id: "OT-DEVICE-NAV".into(),
            class: EntityClass::Person,
            position: Vec2::new(0.0, 0.0),
            velocity: Vec2::new(0.0, 0.0),
            timestamp_ms,
            sensor: Some(SensorReading::simulation()),
            position_z: None,
            velocity_z: None,
            computed_confidence: None,
            sensor_values: Some(sensor_values),
        }],
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

    // ── BCA Green Mark tests ──────────────────────────────────────────────────

    #[test]
    fn bca_greenmark_generates_10_frames() {
        let frames = generate_frames(&Scenario::BcaGreenMark, 0, 0);
        assert_eq!(frames.len(), 10);
        assert_eq!(frames[0].entities.len(), 1);
        assert_eq!(frames[0].entities[0].id, "OUTLET-SENSORS");
    }

    #[test]
    fn bca_greenmark_frame_has_sensor_values() {
        let frames = generate_frames(&Scenario::BcaGreenMark, 0, 0);
        let sv = frames[0].entities[0].sensor_values.as_ref()
            .expect("OUTLET-SENSORS must have sensor_values");
        assert!(sv.contains_key("eui_kwh_m2"), "must have eui_kwh_m2");
        assert!(sv.contains_key("chiller_cop"), "must have chiller_cop");
        assert!(sv.contains_key("lpd_w_m2"), "must have lpd_w_m2");
    }

    #[test]
    fn bca_greenmark_eui_oscillates_across_threshold() {
        // Over 100 cycles, EUI must both exceed and stay below 115 kWh/m²/year
        let mut above = false;
        let mut below = false;
        for cycle in 0..100_u64 {
            let frames = generate_frames(&Scenario::BcaGreenMark, cycle, 0);
            let sv = frames[0].entities[0].sensor_values.as_ref().unwrap();
            let eui = sv["eui_kwh_m2"];
            if eui > 115.0 { above = true; }
            if eui < 115.0 { below = true; }
            if above && below { break; }
        }
        assert!(above, "EUI must exceed 115 in at least one of 100 cycles");
        assert!(below, "EUI must be below 115 in at least one of 100 cycles");
    }

    #[test]
    fn scenario_from_profile_bca_greenmark() {
        assert_eq!(Scenario::from_profile("sg-bca-greenmark"), Scenario::BcaGreenMark);
        assert_eq!(Scenario::from_profile("bca_greenmark"), Scenario::BcaGreenMark);
        assert_eq!(Scenario::from_profile("sg-maritime-security"), Scenario::Maritime);
        assert_eq!(Scenario::from_profile("sg-port-safety"), Scenario::PortSafety);
    }
}
