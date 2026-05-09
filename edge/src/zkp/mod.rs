pub mod green_mark;
pub mod ot_integrity;

pub use green_mark::{GreenMarkProgram, GreenMarkInputs, GreenMarkAttestation, decode_attestation};
pub use ot_integrity::{OtIntegrityProgram, OtIntegrityAttestation, sim_inputs as ot_sim_inputs};
