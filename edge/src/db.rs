/// Local DuckDB operations — audit chain cache + heartbeats + alerts.
///
/// DuckDB is the operational store on the edge device. It holds the full
/// signed audit chain locally. Heartbeats and alert summaries are exported
/// as Parquet and synced to S3. If the device is destroyed, the audit chain
/// can be reconstructed from the WORM S3 bucket.
use anyhow::Result;
use duckdb::{params, Connection};
use edgesentry_audit::AuditRecord;
use edgesentry_evaluate::RiskEvent;
use hex;
use serde::{Deserialize, Serialize};

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS audit_chain (
    sequence          UBIGINT  PRIMARY KEY,
    site_id           VARCHAR  NOT NULL,
    timestamp_ms      UBIGINT  NOT NULL,
    rule_id           VARCHAR,
    severity          VARCHAR,
    evidence_quality  VARCHAR,
    confidence_cv     FLOAT,
    measured_value    FLOAT,
    threshold         FLOAT,
    entity_ids        VARCHAR,
    payload_hash_hex  VARCHAR  NOT NULL,
    signature_hex     VARCHAR  NOT NULL,
    prev_hash_hex     VARCHAR  NOT NULL,
    synced            BOOLEAN  DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS heartbeats (
    id                UBIGINT  PRIMARY KEY,
    timestamp_ms      UBIGINT  NOT NULL,
    site_id           VARCHAR  NOT NULL,
    drift_score       FLOAT    NOT NULL,
    calibration_status VARCHAR NOT NULL,
    certified_count   UINTEGER DEFAULT 0,
    degraded_count    UINTEGER DEFAULT 0,
    rejected_count    UINTEGER DEFAULT 0,
    total_events      UINTEGER DEFAULT 0,
    chain_tip_hash    VARCHAR,
    synced            BOOLEAN  DEFAULT FALSE
);

CREATE SEQUENCE IF NOT EXISTS heartbeat_seq;
";

pub fn init(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

// ── Audit chain ───────────────────────────────────────────────────────────────

pub fn insert_audit_record(conn: &Connection, record: &AuditRecord, event: &RiskEvent) -> Result<()> {
    let entity_ids = serde_json::to_string(&event.entity_ids)?;
    conn.execute(
        "INSERT OR IGNORE INTO audit_chain VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, false
        )",
        params![
            record.sequence,
            record.device_id,
            record.timestamp_ms,
            event.rule_id,
            format!("{:?}", event.severity),
            format!("{:?}", event.evidence_quality),
            event.confidence_cv,
            event.measured_value,
            event.threshold,
            entity_ids,
            hex::encode(record.payload_hash),
            hex::encode(record.signature),
            hex::encode(record.prev_record_hash),
        ],
    )?;
    Ok(())
}

// ── Heartbeats ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Heartbeat {
    pub timestamp_ms: u64,
    pub site_id: String,
    pub drift_score: f32,
    pub calibration_status: String,
    pub certified_count: u32,
    pub degraded_count: u32,
    pub rejected_count: u32,
    pub total_events: u32,
    pub chain_tip_hash: String,
}

pub fn insert_heartbeat(conn: &Connection, hb: &Heartbeat) -> Result<()> {
    conn.execute(
        "INSERT INTO heartbeats VALUES (
            nextval('heartbeat_seq'), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, false
        )",
        params![
            hb.timestamp_ms,
            hb.site_id,
            hb.drift_score,
            hb.calibration_status,
            hb.certified_count,
            hb.degraded_count,
            hb.rejected_count,
            hb.total_events,
            hb.chain_tip_hash,
        ],
    )?;
    Ok(())
}

// ── Parquet export ────────────────────────────────────────────────────────────

/// Export unsynced rows from `table` to Parquet bytes.
/// Returns None if there are no unsynced rows.
pub fn export_parquet(conn: &Connection, table: &str, site_id: &str) -> Result<Option<Vec<u8>>> {
    let count: u64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE synced = FALSE"),
        [],
        |row| row.get(0),
    )?;

    if count == 0 {
        return Ok(None);
    }

    let tmp = std::env::temp_dir().join(format!("clarus_{table}_{site_id}.parquet"));
    conn.execute_batch(&format!(
        "COPY (SELECT * FROM {table} WHERE synced = FALSE ORDER BY timestamp_ms)
         TO '{}' (FORMAT PARQUET)",
        tmp.display()
    ))?;

    let bytes = std::fs::read(&tmp)?;
    std::fs::remove_file(&tmp)?;
    Ok(Some(bytes))
}

pub fn mark_synced(conn: &Connection, table: &str) -> Result<()> {
    conn.execute(
        &format!("UPDATE {table} SET synced = TRUE WHERE synced = FALSE"),
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use edgesentry_audit::{generate_keypair, sign_record, AuditRecord};
    use edgesentry_evaluate::EvidenceQuality;

    fn make_event() -> RiskEvent {
        RiskEvent {
            rule_id: "TEST_RULE".into(),
            severity: edgesentry_evaluate::Severity::High,
            regulation: "Test §1".into(),
            entity_ids: vec!["A".into()],
            measured_value: 3.0,
            threshold: 5.0,
            timestamp_ms: 1000,
            confidence_cv: 0.92,
            evidence_quality: EvidenceQuality::Certified,
        }
    }

    #[test]
    fn init_and_insert_audit_record() {
        let conn = init(":memory:").unwrap();
        let kp = generate_keypair();
        let event = make_event();
        let payload = serde_json::to_vec(&event).unwrap();
        let record = sign_record(
            "site_test".into(), 0, 1000, payload,
            AuditRecord::zero_hash(), "risk-event:TEST".into(),
            &kp.private_key_hex,
        ).unwrap();

        insert_audit_record(&conn, &record, &event).unwrap();

        let count: u64 = conn.query_row(
            "SELECT COUNT(*) FROM audit_chain", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn heartbeat_insert_and_export() {
        let conn = init(":memory:").unwrap();
        let hb = Heartbeat {
            timestamp_ms: 2000,
            site_id: "site_test".into(),
            drift_score: 0.05,
            calibration_status: "VALID".into(),
            certified_count: 3,
            degraded_count: 0,
            rejected_count: 0,
            total_events: 3,
            chain_tip_hash: "abc".into(),
        };
        insert_heartbeat(&conn, &hb).unwrap();

        let parquet = export_parquet(&conn, "heartbeats", "site_test").unwrap();
        assert!(parquet.is_some());
        assert!(!parquet.unwrap().is_empty());
    }

    #[test]
    fn export_returns_none_when_all_synced() {
        let conn = init(":memory:").unwrap();
        // No rows → None
        assert!(export_parquet(&conn, "heartbeats", "site_test").unwrap().is_none());
    }
}
