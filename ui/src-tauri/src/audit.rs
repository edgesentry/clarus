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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_events_json(n: usize) -> String {
        let events: Vec<serde_json::Value> = (1..=n).map(|i| serde_json::json!({
            "rule_id": format!("RULE_{i}"),
            "severity": "HIGH",
            "regulation": format!("Reg §{i}"),
            "entity_ids": ["FL-01", "W-03"],
            "measured_value": i as f64 * 1.5,
            "threshold": 5.0,
            "timestamp_ms": i as u64 * 1000,
        })).collect();
        serde_json::to_string(&events).unwrap()
    }

    #[test]
    fn seal_and_verify_roundtrip() {
        let chain = seal_events(make_events_json(3)).unwrap();
        assert_eq!(chain.records.len(), 3);
        let result = verify_chain(chain.chain_json);
        assert!(result.valid, "sealed chain must verify as valid");
        assert_eq!(result.record_count, 3);
        assert!(result.error.is_none());
    }

    #[test]
    fn seal_empty_events_returns_empty_chain() {
        let chain = seal_events("[]".to_string()).unwrap();
        assert!(chain.records.is_empty());
        assert_eq!(chain.chain_json, "[]");
    }

    #[test]
    fn seal_invalid_json_returns_err() {
        assert!(seal_events("not json".to_string()).is_err());
    }

    #[test]
    fn seal_records_have_sequential_seq_numbers() {
        let chain = seal_events(make_events_json(4)).unwrap();
        for (i, r) in chain.records.iter().enumerate() {
            assert_eq!(r.seq, (i + 1) as u64);
        }
    }

    #[test]
    fn seal_records_carry_event_fields() {
        let chain = seal_events(make_events_json(1)).unwrap();
        let r = &chain.records[0];
        assert_eq!(r.rule_id, "RULE_1");
        assert_eq!(r.timestamp_ms, 1000);
        assert!((r.measured_value - 1.5).abs() < 0.001);
        assert_eq!(r.threshold, 5.0);
        assert!(!r.hash_hex.is_empty());
    }

    #[test]
    fn verify_chain_invalid_json_returns_false() {
        let result = verify_chain("not json".to_string());
        assert!(!result.valid);
        assert!(result.error.is_some());
        assert_eq!(result.record_count, 0);
    }

    #[test]
    fn verify_chain_empty_array_is_valid() {
        let result = verify_chain("[]".to_string());
        assert!(result.valid);
        assert_eq!(result.record_count, 0);
    }

    #[test]
    fn verify_chain_detects_tampered_payload_hash() {
        let chain = seal_events(make_events_json(2)).unwrap();
        // Flip one byte in the first record's payload_hash
        let mut records: Vec<serde_json::Value> =
            serde_json::from_str(&chain.chain_json).unwrap();
        let hash = records[0]["payload_hash"].as_array_mut().unwrap();
        let first = hash[0].as_u64().unwrap();
        hash[0] = serde_json::json!((first + 1) % 256);
        let tampered = serde_json::to_string(&records).unwrap();
        let result = verify_chain(tampered);
        assert!(!result.valid, "tampered chain must fail verification");
    }
}
