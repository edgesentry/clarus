/// OT/IT Cybersecurity Integrity — ZKP computation layer.
///
/// Addresses PIER71-02: "Managing Cybersecurity Risks and Incidences"
/// (IACS UR E26/27, IMO MSC-FAL.1/Circ.3).
///
/// An OT device (PLC, navigation system, engine control unit) measures the
/// SHA-256 hash of every running binary and configuration file, then proves
/// that all measured hashes appear in a pre-approved allowlist — without
/// revealing *which* specific software is running (competitive sensitivity).
///
/// # What is proved (public)
///
/// - `device_id`: which OT device was attested
/// - `all_authorized`: true iff every measured component is on the allowlist
/// - `unauthorized_count`: number of components NOT on the allowlist (0 = clean)
/// - `component_count`: total number of components measured
/// - `allowlist_version`: version/hash of the approved allowlist used
/// - `attested_at_ms`: attestation timestamp
///
/// # What stays private
///
/// - The individual component hashes (reveals software stack to competitors)
/// - The full allowlist contents (internal IP)
///
/// # Regulatory alignment
///
/// - IACS UR E26: "software integrity verification for OT systems"
/// - IACS UR E27: "cyber-resilient systems — authorised software control"
/// - IMO MSC-FAL.1/Circ.3: "verify integrity of operational technology"

use serde::{Deserialize, Serialize};

use edgesentry_zkp::{ZkError, ZkFramework, ZkProof, ZkProgram};

// ── Input / output types ───────────────────────────────────────────────────────

/// Private inputs — the raw measurements from the OT device.
/// Never written to WORM or R2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtIntegrityInputs {
    pub device_id: String,
    /// SHA-256 hashes (hex) of every running binary and config file.
    pub component_hashes: Vec<String>,
    /// SHA-256 hashes (hex) on the approved allowlist for this device class.
    pub allowlist_hashes: Vec<String>,
    /// Semantic version or content-hash of the allowlist (goes public).
    pub allowlist_version: String,
    pub attested_at_ms: u64,
}

/// Public attestation committed by the ZK program — stored in WORM chain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OtIntegrityAttestation {
    pub device_id: String,
    /// True iff every measured component hash is in the allowlist.
    pub all_authorized: bool,
    /// Number of components NOT on the allowlist (0 = fully compliant).
    pub unauthorized_count: usize,
    /// Total components measured.
    pub component_count: usize,
    /// Allowlist version used for this attestation.
    pub allowlist_version: String,
    /// Attestation timestamp.
    pub attested_at_ms: u64,
    /// Overall compliance status string for operator dashboards.
    pub status: ComplianceStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceStatus {
    /// All components authorized — IACS E26/E27 compliant.
    Compliant,
    /// One or more unauthorized components detected.
    Violation,
    /// No components were measured (device may be offline or misconfigured).
    NoData,
}

// ── Core calculation (pure, no ZKP dependency) ─────────────────────────────────

/// Evaluate OT software integrity against the allowlist.
///
/// This function is the canonical domain logic that will be compiled into
/// the SP1 guest program.  It is kept pure and `pub` for testability.
pub fn evaluate(inputs: &OtIntegrityInputs) -> OtIntegrityAttestation {
    if inputs.component_hashes.is_empty() {
        return OtIntegrityAttestation {
            device_id: inputs.device_id.clone(),
            all_authorized: false,
            unauthorized_count: 0,
            component_count: 0,
            allowlist_version: inputs.allowlist_version.clone(),
            attested_at_ms: inputs.attested_at_ms,
            status: ComplianceStatus::NoData,
        };
    }

    let allowlist: std::collections::HashSet<&str> =
        inputs.allowlist_hashes.iter().map(String::as_str).collect();

    let unauthorized: Vec<&str> = inputs
        .component_hashes
        .iter()
        .map(String::as_str)
        .filter(|h| !allowlist.contains(h))
        .collect();

    let unauthorized_count = unauthorized.len();
    let all_authorized = unauthorized_count == 0;

    OtIntegrityAttestation {
        device_id: inputs.device_id.clone(),
        all_authorized,
        unauthorized_count,
        component_count: inputs.component_hashes.len(),
        allowlist_version: inputs.allowlist_version.clone(),
        attested_at_ms: inputs.attested_at_ms,
        status: if all_authorized {
            ComplianceStatus::Compliant
        } else {
            ComplianceStatus::Violation
        },
    }
}

// ── ZkProgram implementation ───────────────────────────────────────────────────

/// Implements [`ZkProgram`] for OT/IT cybersecurity integrity attestation.
///
/// Proves that all measured component hashes are on the approved allowlist
/// without revealing which specific software is running on the device.
///
/// # Upgrade path (same as GreenMarkProgram)
///
/// Currently uses `ZkFramework::Mock`.  Once the SP1 guest ELF is compiled:
/// 1. Add `sp1-sdk` to `Cargo.toml`
/// 2. Replace `ZkFramework::Mock` → `ZkFramework::Sp1`
/// 3. `program_id` becomes the SP1 vkey hash
pub struct OtIntegrityProgram;

pub const PROGRAM_ID: &str = "ot-integrity-iacs-e26-v1-mock";

impl ZkProgram for OtIntegrityProgram {
    fn program_id(&self) -> &str {
        PROGRAM_ID
    }

    fn prove(&self, private_inputs: &[u8]) -> Result<ZkProof, ZkError> {
        let inputs: OtIntegrityInputs = serde_json::from_slice(private_inputs)
            .map_err(|e| ZkError::Serialise(e.to_string()))?;

        let attestation = evaluate(&inputs);

        let public_values = serde_json::to_vec(&attestation)
            .map_err(|e| ZkError::Serialise(e.to_string()))?;

        Ok(ZkProof {
            framework: ZkFramework::Mock,
            program_id: PROGRAM_ID.to_string(),
            proof_bytes: ZkProof::encode(blake3::hash(&public_values).as_bytes()),
            public_values: ZkProof::encode(&public_values),
        })
    }
}

/// Decode the public attestation from a proof's `public_values` field.
pub fn decode_attestation(proof: &ZkProof) -> Result<OtIntegrityAttestation, ZkError> {
    let bytes = proof
        .decode_public_values()
        .map_err(|e| ZkError::InvalidProof(e.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|e| ZkError::InvalidProof(e.to_string()))
}

// ── Simulation helper ──────────────────────────────────────────────────────────

/// Generate deterministic OT integrity inputs for the demo/simulation scenario.
///
/// Cycle parity controls whether the scan comes back clean:
/// - Even cycles: all components authorized (normal operation)
/// - Every 7th cycle: one unauthorized component detected (simulates intrusion)
pub fn sim_inputs(device_id: &str, cycle: u64, now_ms: u64) -> OtIntegrityInputs {
    let allowlist: Vec<String> = (0..8u8)
        .map(|i| format!("{:064x}", i as u64 * 0x1111_1111_1111_1111u64))
        .collect();

    let mut components = allowlist.clone();

    // Every 7th cycle inject an unauthorized hash to simulate a cyber incident
    if cycle % 7 == 6 {
        components.push("deadbeef".repeat(8)); // unauthorized component
    }

    OtIntegrityInputs {
        device_id: device_id.to_string(),
        component_hashes: components,
        allowlist_hashes: allowlist,
        allowlist_version: "iacs-e26-allowlist-v2.1.0".to_string(),
        attested_at_ms: now_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs_clean(device: &str) -> OtIntegrityInputs {
        let hashes: Vec<String> = (0..5u8)
            .map(|i| format!("{:064x}", i as u64 * 0x1111_1111_1111_1111u64))
            .collect();
        OtIntegrityInputs {
            device_id: device.to_string(),
            component_hashes: hashes.clone(),
            allowlist_hashes: hashes,
            allowlist_version: "v1.0".to_string(),
            attested_at_ms: 1_000_000,
        }
    }

    fn inputs_with_violation(device: &str) -> OtIntegrityInputs {
        let allowlist: Vec<String> = (0..5u8)
            .map(|i| format!("{:064x}", i as u64 * 0x1111_1111_1111_1111u64))
            .collect();
        let mut components = allowlist.clone();
        components.push("deadbeef".repeat(8)); // unauthorized
        components.push("cafebabe".repeat(8)); // unauthorized
        OtIntegrityInputs {
            device_id: device.to_string(),
            component_hashes: components,
            allowlist_hashes: allowlist,
            allowlist_version: "v1.0".to_string(),
            attested_at_ms: 1_000_000,
        }
    }

    // ── evaluate ───────────────────────────────────────────────────────────────

    #[test]
    fn clean_scan_is_compliant() {
        let att = evaluate(&inputs_clean("NAV-SYS-01"));
        assert_eq!(att.status, ComplianceStatus::Compliant);
        assert!(att.all_authorized);
        assert_eq!(att.unauthorized_count, 0);
        assert_eq!(att.component_count, 5);
    }

    #[test]
    fn unauthorized_components_detected() {
        let att = evaluate(&inputs_with_violation("ENG-CTRL-02"));
        assert_eq!(att.status, ComplianceStatus::Violation);
        assert!(!att.all_authorized);
        assert_eq!(att.unauthorized_count, 2);
        assert_eq!(att.component_count, 7);
    }

    #[test]
    fn empty_component_list_gives_no_data() {
        let mut inp = inputs_clean("NAV-SYS-01");
        inp.component_hashes.clear();
        let att = evaluate(&inp);
        assert_eq!(att.status, ComplianceStatus::NoData);
        assert!(!att.all_authorized);
    }

    #[test]
    fn device_id_preserved_in_attestation() {
        let att = evaluate(&inputs_clean("GPS-CTRL-07"));
        assert_eq!(att.device_id, "GPS-CTRL-07");
    }

    #[test]
    fn allowlist_version_preserved() {
        let mut inp = inputs_clean("NAV-SYS-01");
        inp.allowlist_version = "iacs-e26-allowlist-v2.1.0".to_string();
        let att = evaluate(&inp);
        assert_eq!(att.allowlist_version, "iacs-e26-allowlist-v2.1.0");
    }

    // ── ZkProgram prove / decode ────────────────────────────────────────────────

    #[test]
    fn prove_clean_scan_returns_compliant_attestation() {
        let program = OtIntegrityProgram;
        let raw = serde_json::to_vec(&inputs_clean("NAV-SYS-01")).unwrap();
        let proof = program.prove(&raw).expect("prove must succeed");
        let att = decode_attestation(&proof).expect("decode must succeed");
        assert_eq!(att.status, ComplianceStatus::Compliant);
        assert!(att.all_authorized);
    }

    #[test]
    fn prove_violation_surfaces_in_public_values() {
        let program = OtIntegrityProgram;
        let raw = serde_json::to_vec(&inputs_with_violation("ENG-CTRL-02")).unwrap();
        let proof = program.prove(&raw).unwrap();
        let att = decode_attestation(&proof).unwrap();
        assert_eq!(att.status, ComplianceStatus::Violation);
        assert_eq!(att.unauthorized_count, 2);
    }

    #[test]
    fn prove_has_correct_program_id() {
        let program = OtIntegrityProgram;
        let raw = serde_json::to_vec(&inputs_clean("NAV-SYS-01")).unwrap();
        let proof = program.prove(&raw).unwrap();
        assert_eq!(proof.program_id, PROGRAM_ID);
    }

    #[test]
    fn prove_is_deterministic() {
        let program = OtIntegrityProgram;
        let raw = serde_json::to_vec(&inputs_clean("NAV-SYS-01")).unwrap();
        let p1 = program.prove(&raw).unwrap();
        let p2 = program.prove(&raw).unwrap();
        assert_eq!(p1.public_values, p2.public_values);
        assert_eq!(p1.proof_bytes, p2.proof_bytes);
    }

    #[test]
    fn prove_invalid_json_returns_error() {
        let program = OtIntegrityProgram;
        assert!(program.prove(b"not-json").is_err());
    }

    // ── sim_inputs ─────────────────────────────────────────────────────────────

    #[test]
    fn sim_inputs_clean_on_even_cycles() {
        for cycle in [0u64, 1, 2, 3, 4, 5] {
            let inp = sim_inputs("NAV-SYS-01", cycle, 0);
            let att = evaluate(&inp);
            assert_eq!(
                att.status, ComplianceStatus::Compliant,
                "cycle {cycle} should be clean"
            );
        }
    }

    #[test]
    fn sim_inputs_violation_on_cycle_6() {
        let inp = sim_inputs("NAV-SYS-01", 6, 0);
        let att = evaluate(&inp);
        assert_eq!(att.status, ComplianceStatus::Violation);
        assert_eq!(att.unauthorized_count, 1);
    }
}
