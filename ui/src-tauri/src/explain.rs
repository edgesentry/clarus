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
