use edgesentry_assess::assess;
use edgesentry_evaluate::RiskEvent;
use edgesentry_report::{generate_report, render_pdf, ExplanationEntry, ReportConfig};
use serde::Deserialize;

#[derive(Deserialize)]
struct ExplanationResult {
    rule_id: String,
    text: String,
}

/// Generate a MOM-format PDF, write it to a temp file, open with the OS
/// default PDF viewer, and return the file path for display.
///
/// Tauri WebView intercepts target="_blank" links so blob URLs cannot open
/// in an external browser. Writing to disk and calling the OS open command
/// is the correct cross-platform approach.
#[tauri::command]
pub fn generate_pdf_report(
    events_json: String,
    site_name: String,
    explanations_json: String,
) -> Result<String, String> {
    let events: Vec<RiskEvent> = serde_json::from_str(&events_json)
        .map_err(|e| format!("parse events: {e}"))?;

    // Map ExplanationResult[] → ExplanationEntry[]; pair each with its event timestamp
    let raw_expl: Vec<ExplanationResult> =
        serde_json::from_str(&explanations_json).unwrap_or_default();
    let explanations: Vec<ExplanationEntry> = raw_expl.into_iter().map(|e| {
        let ts = events.iter()
            .find(|ev| ev.rule_id == e.rule_id)
            .map(|ev| ev.timestamp_ms)
            .unwrap_or(0);
        ExplanationEntry { rule_id: e.rule_id, timestamp_ms: ts, text: e.text }
    }).collect();

    let assessment = assess(&events, None);

    let period = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
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
        explanations,
    };

    let report    = generate_report(&events, &assessment, config);
    let pdf_bytes = render_pdf(&report);

    // Write to temp file
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let pdf_path = std::env::temp_dir().join(format!("clarus-report-{ts}.pdf"));
    std::fs::write(&pdf_path, &pdf_bytes)
        .map_err(|e| format!("write PDF: {e}"))?;

    // Open with OS default PDF viewer
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&pdf_path).spawn().ok();
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/c", "start", "", &pdf_path.to_string_lossy().to_string()])
        .spawn().ok();
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&pdf_path).spawn().ok();

    Ok(pdf_path.to_string_lossy().to_string())
}
