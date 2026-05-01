use edgesentry_compute::euclidean_distance;
use edgesentry_evaluate::{evaluate, load_rules};
use edgesentry_ingest::csv_replay::FileReplayAdapter;
use edgesentry_profile::load_profile;

#[derive(serde::Serialize)]
pub struct EntitySnapshot {
    pub id: String,
    pub class: String,
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
}

#[derive(serde::Serialize)]
pub struct RiskEventSnapshot {
    pub rule_id: String,
    pub severity: String,
    pub entity_ids: Vec<String>,
    pub measured_value: f32,
    pub threshold: f32,
    pub regulation: String,
    pub timestamp_ms: u64,
}

#[derive(serde::Serialize)]
pub struct FrameResult {
    pub timestamp_ms: u64,
    pub entities: Vec<EntitySnapshot>,
    pub generic_events: Vec<RiskEventSnapshot>,
    pub physics_events: Vec<RiskEventSnapshot>,
}

#[derive(serde::Serialize)]
pub struct ReplayResult {
    pub frames: Vec<FrameResult>,
    pub total_generic_alerts: usize,
    pub total_physics_alerts: usize,
}

fn severity_string(sev: &edgesentry_evaluate::Severity) -> String {
    let v = serde_json::to_value(sev).unwrap_or(serde_json::Value::String("LOW".to_string()));
    match v {
        serde_json::Value::String(s) => s,
        _ => "LOW".to_string(),
    }
}

fn class_string(class: &edgesentry_ingest::entity::EntityClass) -> String {
    let v = serde_json::to_value(class).unwrap_or(serde_json::Value::String("Unknown".to_string()));
    match v {
        serde_json::Value::String(s) => s,
        _ => "Unknown".to_string(),
    }
}

// ── Shared evaluation core ────────────────────────────────────────────────────

fn run_core(
    csv_content: &str,
    rules: Vec<edgesentry_evaluate::Rule>,
) -> Result<ReplayResult, String> {
    let adapter = FileReplayAdapter::from_csv(csv_content)
        .map_err(|e| format!("CSV parse error: {e}"))?;
    let all_frames = adapter.frames();

    const GENERIC_THRESHOLD: f32 = 8.0;
    let mut frames = Vec::with_capacity(all_frames.len());
    let mut total_generic_alerts = 0usize;
    let mut total_physics_alerts = 0usize;

    for ef in all_frames {
        let ts = ef.timestamp_ms;
        let entities = &ef.entities;

        let entity_snaps: Vec<EntitySnapshot> = entities
            .iter()
            .map(|e| EntitySnapshot {
                id: e.id.clone(),
                class: class_string(&e.class),
                x: e.position.x,
                y: e.position.y,
                vx: e.velocity.x,
                vy: e.velocity.y,
            })
            .collect();

        let mut generic_events: Vec<RiskEventSnapshot> = Vec::new();
        for i in 0..entities.len() {
            for j in (i + 1)..entities.len() {
                let dist = euclidean_distance(&entities[i], &entities[j]);
                if dist < GENERIC_THRESHOLD {
                    generic_events.push(RiskEventSnapshot {
                        rule_id: "GENERIC_PROXIMITY".to_string(),
                        severity: "HIGH".to_string(),
                        entity_ids: vec![entities[i].id.clone(), entities[j].id.clone()],
                        measured_value: dist,
                        threshold: GENERIC_THRESHOLD,
                        regulation: "Generic 8m proximity rule".to_string(),
                        timestamp_ms: ts,
                    });
                }
            }
        }

        let physics_events: Vec<RiskEventSnapshot> = if rules.is_empty() {
            vec![]
        } else {
            evaluate(&rules, entities, ts)
                .iter()
                .map(|e| RiskEventSnapshot {
                    rule_id: e.rule_id.clone(),
                    severity: severity_string(&e.severity),
                    entity_ids: e.entity_ids.clone(),
                    measured_value: e.measured_value,
                    threshold: e.threshold,
                    regulation: e.regulation.clone(),
                    timestamp_ms: e.timestamp_ms,
                })
                .collect()
        };

        total_generic_alerts += generic_events.len();
        total_physics_alerts += physics_events.len();

        frames.push(FrameResult { timestamp_ms: ts, entities: entity_snaps, generic_events, physics_events });
    }

    Ok(ReplayResult { frames, total_generic_alerts, total_physics_alerts })
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn run_replay(csv_path: String, profile_dir: String) -> Result<ReplayResult, String> {
    let content = std::fs::read_to_string(&csv_path)
        .map_err(|e| format!("Cannot read CSV '{}': {e}", csv_path))?;

    let rules: Vec<edgesentry_evaluate::Rule> = if profile_dir.is_empty() {
        vec![]
    } else {
        load_profile(std::path::Path::new(&profile_dir)).unwrap_or_default()
    };

    run_core(&content, rules)
}

/// Run replay with rules supplied as a JSON string — used by the threshold slider demo.
#[tauri::command]
pub fn run_replay_with_rules(csv_path: String, rules_json: String) -> Result<ReplayResult, String> {
    let content = std::fs::read_to_string(&csv_path)
        .map_err(|e| format!("Cannot read CSV '{}': {e}", csv_path))?;

    let rules = load_rules(&rules_json)
        .map_err(|e| format!("rules_json parse error: {e}"))?;

    run_core(&content, rules)
}

