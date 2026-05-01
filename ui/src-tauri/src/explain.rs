use edgesentry_explain::{Explainer, KnowledgeBase, LlmClient};

#[derive(serde::Serialize)]
pub struct ExplanationResult {
    pub text: String,
    pub grounded: bool,
    pub rule_id: String,
}

#[tauri::command]
pub fn explain_event(
    risk_event_json: String,
    profile_dir: String,
    llm_url: String,
) -> Result<ExplanationResult, String> {
    use edgesentry_evaluate::RiskEvent;

    let event: RiskEvent = serde_json::from_str(&risk_event_json)
        .map_err(|e| format!("parse event: {e}"))?;

    let kb = KnowledgeBase::load(&profile_dir)
        .unwrap_or_else(|_| KnowledgeBase::from_map(std::collections::HashMap::new()));

    let llm = LlmClient::new_autodiscover(if llm_url.is_empty() {
        "http://localhost:8080".to_string()
    } else {
        llm_url
    });

    let explainer = Explainer::new(kb, llm);

    let explanation = explainer.explain(&event)?;

    Ok(ExplanationResult {
        text: explanation.text,
        grounded: explanation.grounded,
        rule_id: event.rule_id.clone(),
    })
}

/// Generate one Executive Summary paragraph from all events + assessment.
/// Called once after demo run — single LLM inference with full context.
#[tauri::command]
pub fn generate_executive_summary(
    events_json: String,
    profile_dir: String,
    llm_url: String,
) -> Result<String, String> {
    use edgesentry_assess::assess;
    use edgesentry_evaluate::RiskEvent;

    let events: Vec<RiskEvent> = serde_json::from_str(&events_json)
        .map_err(|e| format!("parse events: {e}"))?;

    if events.is_empty() {
        return Ok(String::new());
    }

    let assessment = assess(&events, None);

    // Build a compact event table for the prompt
    let event_lines: Vec<String> = events.iter().map(|ev| {
        format!(
            "  - {rule} ({sev}) at t={ts}ms: measured={val:.2} threshold={thr:.1} [{reg}]",
            rule = ev.rule_id,
            sev  = format!("{:?}", ev.severity),
            ts   = ev.timestamp_ms,
            val  = ev.measured_value,
            thr  = ev.threshold,
            reg  = ev.regulation,
        )
    }).collect();

    let trend = format!("{:?}", assessment.trend);
    let total = events.len();

    let prompt = format!(
        "You are writing an Executive Summary for a formal port safety compliance report. \
        The following safety rule violations were recorded by an automated monitoring system.\n\n\
        Events ({total} total, trend={trend}):\n{events}\n\n\
        Write a 3-4 sentence Executive Summary suitable for a safety manager or insurer. \
        State what entities were involved, the most severe measurement recorded, \
        the regulatory implication, and the overall risk trend. \
        Be concise and factual. Do not use bullet points or headers.",
        total  = total,
        trend  = trend,
        events = event_lines.join("\n"),
    );

    let llm = LlmClient::new_autodiscover(if llm_url.is_empty() {
        "http://localhost:8080".to_string()
    } else {
        llm_url
    });

    llm.generate(&prompt).map_err(|e| e.to_string())
}
