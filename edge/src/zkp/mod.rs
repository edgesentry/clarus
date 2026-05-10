pub mod green_mark;
pub mod ot_integrity;

pub use green_mark::{GreenMarkAttestation, GreenMarkInputs, evaluate as evaluate_green_mark};
pub use ot_integrity::{OtIntegrityProgram, sim_inputs as ot_sim_inputs};
