use edgesentry_assess::assess;
use edgesentry_evaluate::RiskEvent;
use edgesentry_report::{generate_report, render_pdf, ExplanationEntry, ReportConfig};
use serde::Deserialize;

#[derive(Deserialize)]
struct ExplanationResult {
    rule_id: String,
    text: String,
}

/// Match each explanation to its event's timestamp by rule_id.
/// Falls back to timestamp_ms = 0 when no matching event is found.
fn map_explanations(raw: Vec<ExplanationResult>, events: &[RiskEvent]) -> Vec<ExplanationEntry> {
    raw.into_iter().map(|e| {
        let ts = events.iter()
            .find(|ev| ev.rule_id == e.rule_id)
            .map(|ev| ev.timestamp_ms)
            .unwrap_or(0);
        ExplanationEntry { rule_id: e.rule_id, timestamp_ms: ts, text: e.text }
    }).collect()
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
    executive_summary: String,
) -> Result<String, String> {
    let events: Vec<RiskEvent> = serde_json::from_str(&events_json)
        .map_err(|e| format!("parse events: {e}"))?;

    // Map ExplanationResult[] → ExplanationEntry[]; pair each with its event timestamp
    let raw_expl: Vec<ExplanationResult> =
        serde_json::from_str(&explanations_json).unwrap_or_default();
    let explanations: Vec<ExplanationEntry> =
        map_explanations(raw_expl, &events);

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
        executive_summary: if executive_summary.is_empty() { None } else { Some(executive_summary) },
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

#[cfg(test)]
mod tests {
    use super::*;
    use edgesentry_evaluate::Severity;

    fn make_event(rule_id: &str, ts: u64) -> RiskEvent {
        RiskEvent {
            rule_id: rule_id.to_string(),
            severity: Severity::High,
            regulation: "Test §1".to_string(),
            entity_ids: vec!["FL-01".to_string()],
            measured_value: 3.0,
            threshold: 5.0,
            timestamp_ms: ts,
        }
    }

    #[test]
    fn map_explanations_matches_timestamp_by_rule_id() {
        let events = vec![
            make_event("PROXIMITY_ALERT", 5000),
            make_event("TTC_ALERT", 8000),
        ];
        let raw = vec![
            ExplanationResult { rule_id: "TTC_ALERT".to_string(), text: "TTC explanation".to_string() },
            ExplanationResult { rule_id: "PROXIMITY_ALERT".to_string(), text: "Proximity explanation".to_string() },
        ];
        let entries = map_explanations(raw, &events);
        assert_eq!(entries.len(), 2);
        let ttc = entries.iter().find(|e| e.rule_id == "TTC_ALERT").unwrap();
        assert_eq!(ttc.timestamp_ms, 8000);
        let prox = entries.iter().find(|e| e.rule_id == "PROXIMITY_ALERT").unwrap();
        assert_eq!(prox.timestamp_ms, 5000);
    }

    #[test]
    fn map_explanations_unknown_rule_gets_zero_timestamp() {
        let events = vec![make_event("RULE_A", 3000)];
        let raw = vec![
            ExplanationResult { rule_id: "UNKNOWN_RULE".to_string(), text: "text".to_string() },
        ];
        let entries = map_explanations(raw, &events);
        assert_eq!(entries[0].timestamp_ms, 0);
    }

    #[test]
    fn map_explanations_empty_input_returns_empty() {
        let entries = map_explanations(vec![], &[make_event("R", 1000)]);
        assert!(entries.is_empty());
    }
}
