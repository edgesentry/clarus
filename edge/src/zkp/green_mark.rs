//! BCA Green Mark 2021 — ZKP computation layer.
//!
//! This module implements [`edgesentry_zkp::ZkProgram`] for the BCA Green Mark
//! energy compliance calculation.  The prover takes raw sensor readings as
//! private input and commits only the pass/fail result and the computed score —
//! raw energy, occupancy, and area data never leave the edge device.
//!
//! # Certification levels (Section 4 — Existing Buildings)
//!
//! | Level    | EUI threshold (kWh/m²/year) |
//! |----------|-----------------------------|
//! | Certified | ≤ 135                      |
//! | Gold      | ≤ 115                      |
//! | GoldPlus  | ≤  95                      |
//! | Platinum  | ≤  75                      |
//!
//! References: BCA Green Mark 2021, SS 553:2016, BCA Energy Efficiency Act 2012.

use serde::{Deserialize, Serialize};

use edgesentry_zkp::{ZkError, ZkFramework, ZkProof, ZkProgram};

// ── Thresholds ─────────────────────────────────────────────────────────────────

/// EUI thresholds in kWh/m²/year (BCA Green Mark 2021, existing buildings).
pub const EUI_CERTIFIED: f32 = 135.0;
pub const EUI_GOLD: f32 = 115.0;
pub const EUI_GOLD_PLUS: f32 = 95.0;
pub const EUI_PLATINUM: f32 = 75.0;

/// Minimum acceptable Chiller COP (SS 553:2016 Table 1).
pub const COP_MIN: f32 = 0.65;

/// Maximum Lighting Power Density (BCA Green Mark 2021, W/m²).
pub const LPD_MAX: f32 = 15.0;

// ── Input / output types ───────────────────────────────────────────────────────

/// Private sensor readings — never serialised to WORM or R2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GreenMarkInputs {
    pub site_id: String,
    /// Annual energy use intensity (kWh/m²/year).
    pub eui_kwh_m2: f32,
    /// Chiller coefficient of performance.
    pub chiller_cop: f32,
    /// Lighting power density (W/m²).
    pub lpd_w_m2: f32,
    pub period_start_ms: u64,
    pub period_end_ms: u64,
}

/// Public attestation committed by the guest program — stored in WORM chain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GreenMarkAttestation {
    pub site_id: String,
    pub eui_kwh_m2: f32,
    pub cert_level: CertLevel,
    /// True when all three BCA criteria pass (EUI, COP, LPD).
    pub all_criteria_pass: bool,
    pub cop_pass: bool,
    pub lpd_pass: bool,
    pub period_start_ms: u64,
    pub period_end_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CertLevel {
    /// EUI > 135 — does not meet BCA Green Mark Certified.
    NotCertified,
    Certified,
    Gold,
    GoldPlus,
    Platinum,
}

// ── Core calculation (pure, no ZKP dependency) ─────────────────────────────────

/// Derive the BCA Green Mark certification level from an EUI reading.
pub fn cert_level(eui: f32) -> CertLevel {
    if eui <= EUI_PLATINUM {
        CertLevel::Platinum
    } else if eui <= EUI_GOLD_PLUS {
        CertLevel::GoldPlus
    } else if eui <= EUI_GOLD {
        CertLevel::Gold
    } else if eui <= EUI_CERTIFIED {
        CertLevel::Certified
    } else {
        CertLevel::NotCertified
    }
}

/// Evaluate all BCA Green Mark criteria and return an attestation.
///
/// This function contains the domain logic that will be compiled into the
/// SP1 guest program.  It is kept `pub` and pure so it can be tested
/// independently and later ported to the zkVM guest binary.
pub fn evaluate(inputs: &GreenMarkInputs) -> GreenMarkAttestation {
    let level = cert_level(inputs.eui_kwh_m2);
    let cop_pass = inputs.chiller_cop >= COP_MIN;
    let lpd_pass = inputs.lpd_w_m2 <= LPD_MAX;
    let all_pass = level != CertLevel::NotCertified && cop_pass && lpd_pass;

    GreenMarkAttestation {
        site_id: inputs.site_id.clone(),
        eui_kwh_m2: inputs.eui_kwh_m2,
        cert_level: level,
        all_criteria_pass: all_pass,
        cop_pass,
        lpd_pass,
        period_start_ms: inputs.period_start_ms,
        period_end_ms: inputs.period_end_ms,
    }
}

// ── ZkProgram implementation ───────────────────────────────────────────────────

/// Implements [`ZkProgram`] for BCA Green Mark 2021.
///
/// # Current implementation (Mock)
///
/// Uses `ZkFramework::Mock` until the SP1 guest ELF is compiled and the
/// `sp1-sdk` dependency is added to this crate.  The `evaluate()` function
/// above is the canonical computation that will be ported to the SP1 guest
/// binary — the proof structure and public values format are already final.
///
/// # Upgrade path
///
/// 1. Add `sp1-sdk` to `Cargo.toml` (with `sp1` feature gate)
/// 2. Compile `guest/green_mark.rs` with `cargo prove build`
/// 3. Replace `ZkFramework::Mock` with `ZkFramework::Sp1`
/// 4. Replace the mock proof bytes with the real SP1 prover call
// Retained for the SP1 upgrade path (edgesentry-rs#387); not used in the BCA default path.
#[allow(dead_code)]
pub struct GreenMarkProgram;

/// Stable identifier for the BCA Green Mark 2021 guest program.
/// Will be replaced by the SP1 vkey hash once the ELF is compiled.
#[allow(dead_code)]
pub const PROGRAM_ID: &str = "bca-green-mark-2021-v1-mock";

impl ZkProgram for GreenMarkProgram {
    fn program_id(&self) -> &str {
        PROGRAM_ID
    }

    fn prove(&self, private_inputs: &[u8]) -> Result<ZkProof, ZkError> {
        let inputs: GreenMarkInputs = serde_json::from_slice(private_inputs)
            .map_err(|e| ZkError::Serialise(e.to_string()))?;

        let attestation = evaluate(&inputs);

        let public_values = serde_json::to_vec(&attestation)
            .map_err(|e| ZkError::Serialise(e.to_string()))?;

        Ok(ZkProof {
            framework: ZkFramework::Mock,
            program_id: PROGRAM_ID.to_string(),
            // Mock proof: BLAKE3 of public_values — trivially verifiable,
            // not zero-knowledge.  Replace with sp1_sdk::ProverClient::prove()
            // once the SP1 guest ELF is available.
            proof_bytes: ZkProof::encode(
                blake3::hash(&public_values).as_bytes()
            ),
            public_values: ZkProof::encode(&public_values),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_attestation(proof: &ZkProof) -> Result<GreenMarkAttestation, ZkError> {
        let bytes = proof
            .decode_public_values()
            .map_err(|e| ZkError::InvalidProof(e.to_string()))?;
        serde_json::from_slice(&bytes).map_err(|e| ZkError::InvalidProof(e.to_string()))
    }

    fn inputs(eui: f32, cop: f32, lpd: f32) -> GreenMarkInputs {
        GreenMarkInputs {
            site_id: "MCH-OUTLET-042".into(),
            eui_kwh_m2: eui,
            chiller_cop: cop,
            lpd_w_m2: lpd,
            period_start_ms: 1_000_000,
            period_end_ms: 2_000_000,
        }
    }

    // ── cert_level ─────────────────────────────────────────────────────────────

    #[test]
    fn platinum_at_or_below_75() {
        assert_eq!(cert_level(75.0), CertLevel::Platinum);
        assert_eq!(cert_level(60.0), CertLevel::Platinum);
    }

    #[test]
    fn gold_plus_between_75_and_95() {
        assert_eq!(cert_level(95.0), CertLevel::GoldPlus);
        assert_eq!(cert_level(80.0), CertLevel::GoldPlus);
    }

    #[test]
    fn gold_between_95_and_115() {
        assert_eq!(cert_level(115.0), CertLevel::Gold);
        assert_eq!(cert_level(100.0), CertLevel::Gold);
    }

    #[test]
    fn certified_between_115_and_135() {
        assert_eq!(cert_level(135.0), CertLevel::Certified);
        assert_eq!(cert_level(120.0), CertLevel::Certified);
    }

    #[test]
    fn not_certified_above_135() {
        assert_eq!(cert_level(136.0), CertLevel::NotCertified);
        assert_eq!(cert_level(200.0), CertLevel::NotCertified);
    }

    // ── evaluate ───────────────────────────────────────────────────────────────

    #[test]
    fn all_criteria_pass_gold() {
        let att = evaluate(&inputs(105.0, 0.70, 13.0));
        assert_eq!(att.cert_level, CertLevel::Gold);
        assert!(att.cop_pass);
        assert!(att.lpd_pass);
        assert!(att.all_criteria_pass);
    }

    #[test]
    fn cop_fail_blocks_all_criteria() {
        let att = evaluate(&inputs(105.0, 0.60, 13.0)); // COP below 0.65
        assert!(!att.cop_pass);
        assert!(!att.all_criteria_pass);
    }

    #[test]
    fn lpd_fail_blocks_all_criteria() {
        let att = evaluate(&inputs(105.0, 0.70, 16.0)); // LPD above 15
        assert!(!att.lpd_pass);
        assert!(!att.all_criteria_pass);
    }

    #[test]
    fn eui_above_135_not_certified_blocks_all() {
        let att = evaluate(&inputs(140.0, 0.70, 13.0));
        assert_eq!(att.cert_level, CertLevel::NotCertified);
        assert!(!att.all_criteria_pass);
    }

    // ── ZkProgram prove / decode ────────────────────────────────────────────────

    #[test]
    fn prove_returns_proof_with_correct_program_id() {
        let program = GreenMarkProgram;
        let inp = inputs(105.0, 0.70, 13.0);
        let raw = serde_json::to_vec(&inp).unwrap();

        let proof = program.prove(&raw).expect("prove must succeed");
        assert_eq!(proof.program_id, PROGRAM_ID);
    }

    #[test]
    fn prove_public_values_decode_to_attestation() {
        let program = GreenMarkProgram;
        let inp = inputs(105.0, 0.70, 13.0);
        let raw = serde_json::to_vec(&inp).unwrap();

        let proof = program.prove(&raw).unwrap();
        let att = decode_attestation(&proof).expect("decode must succeed");

        assert_eq!(att.cert_level, CertLevel::Gold);
        assert!(att.all_criteria_pass);
        assert_eq!(att.site_id, "MCH-OUTLET-042");
    }

    #[test]
    fn prove_is_deterministic() {
        let program = GreenMarkProgram;
        let inp = inputs(90.0, 0.70, 12.0);
        let raw = serde_json::to_vec(&inp).unwrap();

        let p1 = program.prove(&raw).unwrap();
        let p2 = program.prove(&raw).unwrap();
        assert_eq!(p1.public_values, p2.public_values);
        assert_eq!(p1.proof_bytes, p2.proof_bytes);
    }

    #[test]
    fn prove_invalid_input_returns_error() {
        let program = GreenMarkProgram;
        let result = program.prove(b"not-valid-json");
        assert!(result.is_err());
    }
}
