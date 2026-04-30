use base64::Engine as _;
use edgesentry_assess::assess;
use edgesentry_evaluate::RiskEvent;
use edgesentry_report::{generate_report, render_pdf, ReportConfig};

/// Generate a MOM-format PDF safety report.
///
/// Takes only `events_json` (serialised `Vec<RiskEvent>`) and `site_name`.
/// Assessment is computed internally so the caller does not need to pass a
/// pre-built Assessment struct — avoids JS/Rust enum serialisation mismatches.
#[tauri::command]
pub fn generate_pdf_report(
    events_json: String,
    site_name: String,
) -> Result<String, String> {
    let events: Vec<RiskEvent> = serde_json::from_str(&events_json)
        .map_err(|e| format!("parse events: {e}"))?;

    let assessment = assess(&events, None);

    let period = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // Format as "Month YYYY" approximation from unix seconds
        let days = secs / 86400;
        let year = 1970 + days / 365;
        let month_idx = (days % 365) * 12 / 365;
        let months = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
        format!("{} {}", months[month_idx as usize % 12], year)
    };

    let config = ReportConfig {
        site_name: if site_name.is_empty() { None } else { Some(site_name) },
        report_period: Some(period),
        chain_valid: None,
    };

    let report = generate_report(&events, &assessment, config);
    let pdf_bytes = render_pdf(&report);

    Ok(base64::engine::general_purpose::STANDARD.encode(&pdf_bytes))
}
