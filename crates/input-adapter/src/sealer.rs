use clarus_engine::rules::RiskEvent;
use clarus_explanation::Explanation;
use edgesentry_audit::{sign_record, AuditRecord, Hash32};
use serde::Serialize;

/// JSON payload stored inside each AuditRecord.
#[derive(Serialize)]
struct SealPayload<'a> {
    rule_id: &'a str,
    severity: &'a str,
    regulation: &'a str,
    entity_ids: &'a [String],
    measured_value: f32,
    threshold: f32,
    timestamp_ms: u64,
    explanation: Option<ExplanationPayload<'a>>,
}

#[derive(Serialize)]
struct ExplanationPayload<'a> {
    text: &'a str,
    grounded: bool,
}

/// Builds a tamper-proof AuditRecord chain from RiskEvents + optional explanations.
pub struct ClarusSealer {
    device_id: String,
    private_key_hex: String,
    prev_hash: Hash32,
    sequence: u64,
}

impl ClarusSealer {
    pub fn new(device_id: String, private_key_hex: String) -> Self {
        Self {
            device_id,
            private_key_hex,
            prev_hash: AuditRecord::zero_hash(),
            sequence: 0,
        }
    }

    /// Seal a RiskEvent (and optional Explanation) into an AuditRecord, advancing the chain.
    pub fn seal(
        &mut self,
        event: &RiskEvent,
        explanation: Option<&Explanation>,
    ) -> Result<AuditRecord, String> {
        self.sequence += 1;

        let severity = format!("{:?}", event.severity);
        let payload_struct = SealPayload {
            rule_id: &event.rule_id,
            severity: &severity,
            regulation: &event.regulation,
            entity_ids: &event.entity_ids,
            measured_value: event.measured_value,
            threshold: event.threshold,
            timestamp_ms: event.timestamp_ms,
            explanation: explanation.map(|e| ExplanationPayload {
                text: &e.text,
                grounded: e.grounded,
            }),
        };
        let payload = serde_json::to_vec(&payload_struct)
            .map_err(|e| format!("payload serialization failed: {e}"))?;

        let object_ref = format!("clarus/{}/{}", event.rule_id, event.timestamp_ms);

        let record = sign_record(
            self.device_id.clone(),
            self.sequence,
            event.timestamp_ms,
            payload,
            self.prev_hash,
            object_ref,
            &self.private_key_hex,
        )
        .map_err(|e| e.to_string())?;

        self.prev_hash = record.hash();
        Ok(record)
    }

    #[allow(dead_code)]
    pub fn prev_hash(&self) -> &Hash32 {
        &self.prev_hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clarus_engine::rules::{RiskEvent, Severity};
    use edgesentry_audit::{generate_keypair, verify_chain_records, verify_record};

    fn sample_event(rule_id: &str, ts: u64) -> RiskEvent {
        RiskEvent {
            rule_id: rule_id.to_string(),
            severity: Severity::High,
            regulation: "MPA §3.1".to_string(),
            entity_ids: vec!["FL-01".to_string(), "W-03".to_string()],
            measured_value: 3.2,
            threshold: 5.0,
            timestamp_ms: ts,
        }
    }

    #[test]
    fn seal_produces_verifiable_record() {
        let kp = generate_keypair();
        let mut sealer = ClarusSealer::new("clarus-test".to_string(), kp.private_key_hex.clone());
        let event = sample_event("MPA_CLEARANCE_5M", 1000);
        let record = sealer.seal(&event, None).expect("seal should succeed");
        let valid = edgesentry_audit::verify_record(&record, &kp.public_key_hex)
            .expect("verify should run");
        assert!(valid, "sealed record must verify with matching public key");
    }

    #[test]
    fn seal_with_explanation_produces_verifiable_record() {
        let kp = generate_keypair();
        let mut sealer = ClarusSealer::new("clarus-test".to_string(), kp.private_key_hex.clone());
        let event = sample_event("MPA_CLEARANCE_5M", 1000);
        let explanation = Explanation {
            rule_id: event.rule_id.clone(),
            kb_snippet: "Minimum 5 m clearance required.".to_string(),
            text: "Clearance of 3.20 m breached §3.1 threshold of 5.00 m.".to_string(),
            grounded: true,
        };
        let record = sealer
            .seal(&event, Some(&explanation))
            .expect("seal should succeed");
        let valid = verify_record(&record, &kp.public_key_hex).expect("verify should run");
        assert!(valid);
    }

    #[test]
    fn multiple_seals_form_valid_chain() {
        let kp = generate_keypair();
        let mut sealer = ClarusSealer::new("clarus-test".to_string(), kp.private_key_hex.clone());
        let events = [
            sample_event("MPA_CLEARANCE_5M", 1000),
            sample_event("TTC_CRITICAL_3S", 2000),
            sample_event("MPA_CLEARANCE_5M", 3000),
        ];
        let records: Vec<AuditRecord> = events
            .iter()
            .map(|e| sealer.seal(e, None).expect("seal should succeed"))
            .collect();
        verify_chain_records(&records).expect("chain must be valid");
    }

    #[test]
    fn sequence_increments_per_seal() {
        let kp = generate_keypair();
        let mut sealer = ClarusSealer::new("clarus-test".to_string(), kp.private_key_hex);
        let e1 = sealer.seal(&sample_event("R1", 1000), None).unwrap();
        let e2 = sealer.seal(&sample_event("R2", 2000), None).unwrap();
        assert_eq!(e1.sequence, 1);
        assert_eq!(e2.sequence, 2);
    }

    #[test]
    fn wrong_key_does_not_verify() {
        let kp = generate_keypair();
        let wrong = generate_keypair();
        let mut sealer = ClarusSealer::new("clarus-test".to_string(), kp.private_key_hex);
        let record = sealer.seal(&sample_event("R", 1000), None).unwrap();
        let valid = verify_record(&record, &wrong.public_key_hex).unwrap();
        assert!(!valid);
    }
}
