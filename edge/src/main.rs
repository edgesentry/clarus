/// clarus-edge — EdgeSentry edge daemon.
///
/// Pipeline per cycle:
///   1. Sim generates 10 EntityFrames (CV dummy stream with confidence)
///   2. Evaluate rules → Vec<RiskEvent> (with EvidenceQuality)
///   3. Sign each event → AuditRecord (BLAKE3 + Ed25519, hash-chained)
///   4. Write to local DuckDB (operational cache + full audit log)
///   5. Upload AuditRecord to WORM bucket immediately (disaster recovery)
///   6. Every HEARTBEAT_INTERVAL s: export heartbeats.parquet → raw bucket
///   7. On any RiskEvent: export alerts.parquet → raw bucket immediately
use std::time::{Duration, Instant};

use anyhow::Result;
use clap::Parser;
use tokio::time::sleep;
use tracing::{info, warn};

mod config;
mod db;
mod sim;
mod storage;

use config::Config;
use edgesentry_audit::{generate_keypair, inspect_key, sign_record, AuditRecord};
use edgesentry_evaluate::{evaluate, EvidenceQuality, RiskEvent};
use edgesentry_profile::load_profile;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "clarus_edge=info".into()),
        )
        .init();

    let config = Config::parse();

    // ── Load profile ──────────────────────────────────────────────────────
    let profile_path =
        std::path::PathBuf::from(&config.profiles_dir).join(&config.profile);
    let rules = load_profile(&profile_path).map_err(|e| {
        anyhow::anyhow!("Failed to load profile '{}': {}", config.profile, e)
    })?;
    info!(
        profile = %config.profile,
        rules = rules.len(),
        "Rules loaded"
    );

    // ── Local DuckDB ──────────────────────────────────────────────────────
    let conn = db::init(&config.db_path)?;
    info!(path = %config.db_path, "DuckDB initialized");

    // ── S3-compatible storage ─────────────────────────────────────────────
    let storage = storage::Storage::new(&config)?;
    info!(backend = %config.storage_backend, "Storage backend ready");

    // ── Signing key ───────────────────────────────────────────────────────
    let keypair = if config.private_key_hex.is_empty() {
        let kp = generate_keypair();
        warn!(
            "PRIVATE_KEY_HEX not set — generated ephemeral key. \
             Set PRIVATE_KEY_HEX={} in config.env to persist across restarts.",
            kp.private_key_hex
        );
        kp
    } else {
        inspect_key(&config.private_key_hex)?
    };
    info!(public_key = %keypair.public_key_hex, site = %config.site_id, "Identity ready");

    // ── Pipeline state ────────────────────────────────────────────────────
    let scenario = sim::Scenario::from_profile(&config.profile);
    let cycle_dur = Duration::from_secs(config.cycle_interval_secs);
    let hb_interval = Duration::from_secs(config.heartbeat_interval_secs);

    let mut sequence: u64 = 0;
    let mut prev_hash: [u8; 32] = AuditRecord::zero_hash();
    let mut cycle: u64 = 0;
    // Trigger heartbeat upload on first cycle
    let mut last_hb_upload = Instant::now()
        .checked_sub(hb_interval)
        .unwrap_or_else(Instant::now);

    info!(scenario = ?scenario, "Pipeline started");

    loop {
        let cycle_start = Instant::now();
        let now_ms = now_millis();

        // ── 1. Generate frames ────────────────────────────────────────────
        let frames = sim::generate_frames(&scenario, cycle, now_ms);

        // ── 2. Evaluate rules ─────────────────────────────────────────────
        let mut cycle_events: Vec<RiskEvent> = Vec::new();
        for frame in &frames {
            cycle_events.extend(evaluate(&rules, &frame.entities, frame.timestamp_ms));
        }

        // ── 3. Sign → DuckDB → WORM upload ───────────────────────────────
        for event in &cycle_events {
            let payload = serde_json::to_vec(event)?;
            let record = sign_record(
                config.site_id.clone(),
                sequence,
                event.timestamp_ms,
                payload,
                prev_hash,
                format!("risk-event:{}", event.rule_id),
                &keypair.private_key_hex,
            )?;

            let record_hash = record.hash();
            prev_hash = record_hash;
            db::insert_audit_record(&conn, &record, event)?;

            let envelope = build_audit_envelope(&record, record_hash, event);
            let worm_key = format!("chains/{}/{:020}.json", config.site_id, sequence);
            match storage.put_audit(&worm_key, serde_json::to_vec(&envelope)?.into()).await {
                Ok(()) => {}
                Err(e) => warn!("WORM upload failed (retried next cycle): {e}"),
            }

            sequence += 1;
        }

        // ── 4. Heartbeat ──────────────────────────────────────────────────
        let drift = sim::drift_score(cycle);
        let cal = calibration_status(drift);
        let (cert, deg, rej) = quality_counts(&cycle_events);

        let hb = db::Heartbeat {
            timestamp_ms: now_ms,
            site_id: config.site_id.clone(),
            drift_score: drift,
            calibration_status: cal.to_string(),
            certified_count: cert,
            degraded_count: deg,
            rejected_count: rej,
            total_events: cycle_events.len() as u32,
            chain_tip_hash: hex::encode(prev_hash),
        };
        db::insert_heartbeat(&conn, &hb)?;

        info!(
            cycle,
            drift = format_args!("{drift:.3}m"),
            cal,
            events = cycle_events.len(),
            certified = cert,
            degraded = deg,
            rejected = rej,
            "Cycle complete"
        );

        // ── 5. Periodic heartbeat upload ──────────────────────────────────
        if last_hb_upload.elapsed() >= hb_interval {
            sync_table(&conn, &storage, "heartbeats", &config.site_id, now_ms).await;
            last_hb_upload = Instant::now();
        }

        // ── 6. Alert upload (immediate on events) ─────────────────────────
        if !cycle_events.is_empty() {
            sync_table(&conn, &storage, "audit_chain", &config.site_id, now_ms).await;
        }

        cycle += 1;
        let elapsed = cycle_start.elapsed();
        if elapsed < cycle_dur {
            sleep(cycle_dur - elapsed).await;
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn sync_table(
    conn: &duckdb::Connection,
    storage: &storage::Storage,
    table: &str,
    site_id: &str,
    now_ms: u64,
) {
    match db::export_parquet(conn, table, site_id) {
        Ok(Some(bytes)) => {
            let key = format!("live/{site_id}/{table}/{now_ms}.parquet");
            match storage.put_raw(&key, bytes.into()).await {
                Ok(()) => {
                    if let Err(e) = db::mark_synced(conn, table) {
                        warn!("mark_synced({table}) failed: {e}");
                    } else {
                        info!(key, "Synced to raw bucket");
                    }
                }
                Err(e) => warn!("Analytics upload({table}) failed: {e}"),
            }
        }
        Ok(None) => {}
        Err(e) => warn!("export_parquet({table}) failed: {e}"),
    }
}

fn calibration_status(drift: f32) -> &'static str {
    if drift < 0.3 {
        "VALID"
    } else if drift < 0.6 {
        "DEGRADED"
    } else {
        "UNCALIBRATED"
    }
}

fn quality_counts(events: &[RiskEvent]) -> (u32, u32, u32) {
    events.iter().fold((0, 0, 0), |(c, d, r), e| match e.evidence_quality {
        EvidenceQuality::Certified => (c + 1, d, r),
        EvidenceQuality::Degraded  => (c, d + 1, r),
        EvidenceQuality::Rejected  => (c, d, r + 1),
    })
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Build the browser-friendly JSON envelope for a WORM audit upload.
/// Pre-computes hex fields so browsers can verify the hash chain with a
/// simple string comparison — no postcard or BLAKE3 needed in the browser.
fn build_audit_envelope(
    record: &AuditRecord,
    record_hash: [u8; 32],
    event: &RiskEvent,
) -> serde_json::Value {
    serde_json::json!({
        "device_id":             record.device_id,
        "sequence":              record.sequence,
        "timestamp_ms":          record.timestamp_ms,
        "object_ref":            record.object_ref,
        "payload_hash_hex":      hex::encode(record.payload_hash),
        "prev_record_hash_hex":  hex::encode(record.prev_record_hash),
        "signature_hex":         hex::encode(record.signature),
        "record_hash_hex":       hex::encode(record_hash),
        "rule_id":               event.rule_id,
        "severity":              format!("{:?}", event.severity),
        "evidence_quality":      format!("{:?}", event.evidence_quality),
        "confidence_cv":         event.confidence_cv,
        "entity_ids":            event.entity_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use edgesentry_audit::{generate_keypair, sign_record, AuditRecord};
    use edgesentry_evaluate::{EvidenceQuality, RiskEvent, Severity};

    fn make_event() -> RiskEvent {
        RiskEvent {
            rule_id: "RESTRICTED_ZONE_APPROACH".into(),
            severity: Severity::High,
            regulation: "COLREGs Rule 8".into(),
            entity_ids: vec!["V-001".into()],
            measured_value: 0.3,
            threshold: 0.5,
            timestamp_ms: 1_000,
            confidence_cv: 0.92,
            evidence_quality: EvidenceQuality::Certified,
        }
    }

    fn make_record(seq: u64, prev: [u8; 32]) -> (AuditRecord, [u8; 32]) {
        let kp = generate_keypair();
        let event = make_event();
        let payload = serde_json::to_vec(&event).unwrap();
        let record = sign_record(
            "site_test".into(), seq, 1_000, payload,
            prev, "risk-event:RESTRICTED_ZONE_APPROACH".into(),
            &kp.private_key_hex,
        ).unwrap();
        let hash = record.hash();
        (record, hash)
    }

    #[test]
    fn envelope_has_all_required_hex_fields() {
        let (record, hash) = make_record(0, AuditRecord::zero_hash());
        let event = make_event();
        let env = build_audit_envelope(&record, hash, &event);

        for field in ["record_hash_hex", "prev_record_hash_hex", "payload_hash_hex", "signature_hex"] {
            let val = env[field].as_str().expect(field);
            assert!(!val.is_empty(), "{field} must not be empty");
            assert!(val.chars().all(|c| c.is_ascii_hexdigit()), "{field} must be hex");
        }
        assert_eq!(env["record_hash_hex"].as_str().unwrap().len(), 64);
        assert_eq!(env["prev_record_hash_hex"].as_str().unwrap().len(), 64);
        assert_eq!(env["payload_hash_hex"].as_str().unwrap().len(), 64);
        assert_eq!(env["signature_hex"].as_str().unwrap().len(), 128);
    }

    #[test]
    fn chain_links_via_record_hash_hex() {
        // Simulates the browser verification:
        // records[N].prev_record_hash_hex === records[N-1].record_hash_hex
        let zero = AuditRecord::zero_hash();
        let event = make_event();

        let (r0, h0) = make_record(0, zero);
        let (r1, h1) = make_record(1, h0);
        let (r2, _)  = make_record(2, h1);

        let e0 = build_audit_envelope(&r0, h0, &event);
        let e1 = build_audit_envelope(&r1, h1, &event);
        let e2 = build_audit_envelope(&r2, [0u8; 32], &event); // hash not needed here

        // genesis: prev_record_hash of record 0 is all zeros
        assert_eq!(e0["prev_record_hash_hex"].as_str().unwrap(), "0".repeat(64));

        // chain link: record 1's prev_hash === record 0's record_hash
        assert_eq!(
            e1["prev_record_hash_hex"].as_str().unwrap(),
            e0["record_hash_hex"].as_str().unwrap(),
        );
        assert_eq!(
            e2["prev_record_hash_hex"].as_str().unwrap(),
            e1["record_hash_hex"].as_str().unwrap(),
        );
    }

    #[test]
    fn envelope_event_fields_match_risk_event() {
        let (record, hash) = make_record(42, AuditRecord::zero_hash());
        let event = make_event();
        let env = build_audit_envelope(&record, hash, &event);

        assert_eq!(env["rule_id"].as_str().unwrap(), "RESTRICTED_ZONE_APPROACH");
        assert_eq!(env["sequence"].as_u64().unwrap(), 42);
        assert_eq!(env["device_id"].as_str().unwrap(), "site_test");
        assert!((env["confidence_cv"].as_f64().unwrap() - 0.92).abs() < 1e-5);
        assert_eq!(env["entity_ids"][0].as_str().unwrap(), "V-001");
    }
}
