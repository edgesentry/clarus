use base64::Engine as _;
use edgesentry_assess::Assessment;
use edgesentry_evaluate::RiskEvent;
use edgesentry_report::{generate_report, render_pdf, ReportConfig};

#[tauri::command]
pub fn generate_pdf_report(
    events_json: String,
    assessment_json: String,
    site_name: String,
) -> Result<String, String> {
    let events: Vec<RiskEvent> = serde_json::from_str(&events_json)
        .map_err(|e| format!("parse events: {e}"))?;

    let assessment: Assessment = serde_json::from_str(&assessment_json)
        .map_err(|e| format!("parse assessment: {e}"))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let config = ReportConfig {
        site_name: if site_name.is_empty() { None } else { Some(site_name) },
        report_period: Some(format!("ts:{ts}")),
        chain_valid: None,
    };

    let report = generate_report(&events, &assessment, config);
    let pdf_bytes = render_pdf(&report);

    Ok(base64::engine::general_purpose::STANDARD.encode(&pdf_bytes))
}
