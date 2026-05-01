use edgesentry_audit::{sign_record, verify_chain_records, AuditRecord};
use edgesentry_evaluate::RiskEvent;

#[derive(serde::Serialize)]
pub struct VerifyResult {
    pub valid: bool,
    pub record_count: usize,
    pub error: Option<String>,
}

#[tauri::command]
pub fn verify_chain(chain_json: String) -> VerifyResult {
    let records: Vec<AuditRecord> = match serde_json::from_str(&chain_json) {
        Ok(r) => r,
        Err(e) => {
            return VerifyResult {
                valid: false,
                record_count: 0,
                error: Some(format!("JSON parse: {e}")),
            }
        }
    };
    let count = records.len();
    match verify_chain_records(&records) {
        Ok(()) => VerifyResult {
            valid: true,
            record_count: count,
            error: None,
        },
        Err(e) => VerifyResult {
            valid: false,
            record_count: count,
            error: Some(e.to_string()),
        },
    }
}

#[derive(serde::Serialize)]
pub struct SealedChain {
    pub chain_json: String,
    pub records: Vec<SealedRecord>,
}

#[derive(serde::Serialize)]
pub struct SealedRecord {
    pub seq: u64,
    pub timestamp_ms: u64,
    pub rule_id: String,
    pub measured_value: f32,
    pub threshold: f32,
    pub regulation: String,
    pub hash_hex: String,
}

/// Seal a Vec<RiskEventSnapshot> (from run_replay) into a BLAKE3+Ed25519 audit chain.
/// Uses a fixed demo key — in production this would be the device's HSM-backed key.
#[tauri::command]
pub fn seal_events(events_json: String) -> Result<SealedChain, String> {
    const DEMO_KEY: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    let events: Vec<RiskEvent> = serde_json::from_str(&events_json)
        .map_err(|e| format!("parse events: {e}"))?;

    let mut prev_hash = [0u8; 32];
    let mut records_raw: Vec<AuditRecord> = Vec::new();
    let mut records_out: Vec<SealedRecord> = Vec::new();

    for (i, ev) in events.iter().enumerate() {
        let seq = (i + 1) as u64;
        let payload = serde_json::to_vec(ev).map_err(|e| e.to_string())?;
        let record = sign_record(
            "clarus-demo".to_string(),
            seq,
            ev.timestamp_ms,
            payload,
            prev_hash,
            format!("clarus://demo/event-{seq}"),
            DEMO_KEY,
        ).map_err(|e| e.to_string())?;

        let hash = record.hash();
        let hash_hex = hex::encode(&hash[..8]); // truncate for display

        records_out.push(SealedRecord {
            seq,
            timestamp_ms: ev.timestamp_ms,
            rule_id: ev.rule_id.clone(),
            measured_value: ev.measured_value,
            threshold: ev.threshold,
            regulation: ev.regulation.clone(),
            hash_hex,
        });

        prev_hash = hash;
        records_raw.push(record);
    }

    let chain_json = serde_json::to_string(&records_raw).map_err(|e| e.to_string())?;
    Ok(SealedChain { chain_json, records: records_out })
}
