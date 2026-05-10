pub mod green_mark;
pub mod ot_integrity;

pub use green_mark::{GreenMarkAttestation, GreenMarkInputs, evaluate as evaluate_green_mark};
#[allow(unused_imports)]
pub use green_mark::GreenMarkProgram; // retained for tests and future SP1 integration
pub use ot_integrity::{OtIntegrityProgram, sim_inputs as ot_sim_inputs};
