use edgesentry_audit::{verify_chain_records, AuditRecord};

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
