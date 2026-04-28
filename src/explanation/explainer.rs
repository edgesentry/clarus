use crate::engine::rules::RiskEvent;

use crate::explanation::kb::KnowledgeBase;
use crate::explanation::llm::OllamaClient;

/// The explanation produced for a single RiskEvent.
#[derive(Debug, Clone)]
pub struct Explanation {
    pub rule_id: String,
    pub kb_snippet: String,
    pub text: String,
    /// False if the LLM output cited a regulation clause absent from `kb_snippet`.
    pub grounded: bool,
}

pub struct Explainer {
    kb: KnowledgeBase,
    llm: OllamaClient,
}

impl Explainer {
    pub fn new(kb: KnowledgeBase, llm: OllamaClient) -> Self {
        Self { kb, llm }
    }

    /// Generate a plain-language explanation for a RiskEvent.
    ///
    /// If the KB has no entry for the rule, returns an explanation with the snippet set to
    /// "No KB entry" and grounded=false.
    /// If Ollama is unavailable, returns Err with the connection error.
    pub fn explain(&self, event: &RiskEvent) -> Result<Explanation, String> {
        let kb_snippet = match self.kb.get(&event.rule_id) {
            Some(s) => s.to_string(),
            None => {
                return Ok(Explanation {
                    rule_id: event.rule_id.clone(),
                    kb_snippet: "No KB entry".to_string(),
                    text: format!(
                        "Rule {} fired (measured {:.2}, threshold {:.2}). No regulatory KB entry found.",
                        event.rule_id, event.measured_value, event.threshold
                    ),
                    grounded: false,
                });
            }
        };

        let entity_desc = match event.entity_ids.as_slice() {
            [a, b] => format!("{a} and {b}"),
            [a] => a.clone(),
            ids => ids.join(", "),
        };

        let prompt = build_prompt(event, &entity_desc, &kb_snippet);
        let raw = self.llm.generate(&prompt)?;
        let text = raw.trim().to_string();
        let grounded = is_grounded(&text, &kb_snippet);

        Ok(Explanation {
            rule_id: event.rule_id.clone(),
            kb_snippet,
            text,
            grounded,
        })
    }
}

fn build_prompt(event: &RiskEvent, entity_desc: &str, kb_snippet: &str) -> String {
    format!(
        "Event: {rule_id} fired. Measured: {value:.2}. Threshold: {threshold:.2}.\n\
         Entities involved: {entities}.\n\
         Regulation: {snippet}\n\n\
         Generate a one-paragraph plain-language alert for a safety officer. \
         Only cite regulation text provided above. Do not add any regulation references \
         not present in the text above.",
        rule_id = event.rule_id,
        value = event.measured_value,
        threshold = event.threshold,
        entities = entity_desc,
        snippet = kb_snippet,
    )
}

/// Heuristic grounding check: confirm the LLM output doesn't reference regulation
/// section numbers (§X.X) that are absent from the KB snippet.
fn is_grounded(text: &str, kb_snippet: &str) -> bool {
    // Extract all §N.N style references from LLM output
    let llm_refs = extract_section_refs(text);
    let kb_refs = extract_section_refs(kb_snippet);
    // All refs in LLM output must appear in KB snippet
    llm_refs.iter().all(|r| kb_refs.contains(r))
}

fn extract_section_refs(text: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '§' {
            let mut s = String::new();
            for nc in chars.by_ref() {
                if nc.is_ascii_digit() || nc == '.' {
                    s.push(nc);
                } else {
                    break;
                }
            }
            if !s.is_empty() {
                refs.push(s);
            }
        }
    }
    refs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_refs_finds_section_numbers() {
        let refs = extract_section_refs("See §3.1 and §4.2 for details.");
        assert_eq!(refs, vec!["3.1", "4.2"]);
    }

    #[test]
    fn extract_refs_empty_when_none() {
        assert!(extract_section_refs("No refs here.").is_empty());
    }

    #[test]
    fn grounded_when_all_refs_in_kb() {
        let kb = "Site Safety §3.1 requires 5 m clearance.";
        let llm = "According to §3.1, clearance was breached.";
        assert!(is_grounded(llm, kb));
    }

    #[test]
    fn not_grounded_when_extra_ref_hallucinated() {
        let kb = "Site Safety §3.1 requires 5 m clearance.";
        let llm = "According to §3.1 and §7.4, clearance was breached.";
        assert!(!is_grounded(llm, kb));
    }

    #[test]
    fn grounded_when_no_refs_in_output() {
        let kb = "Site Safety §3.1 requires 5 m clearance.";
        let llm = "The clearance was breached. Immediate action required.";
        assert!(is_grounded(llm, kb));
    }

    #[test]
    fn build_prompt_contains_key_fields() {
        use crate::engine::rules::{RiskEvent, Severity};
        let event = RiskEvent {
            rule_id: "PROXIMITY_ALERT".to_string(),
            severity: Severity::High,
            regulation: "Site Safety §3.1".to_string(),
            entity_ids: vec!["FL-01".to_string(), "W-03".to_string()],
            measured_value: 3.2,
            threshold: 5.0,
            timestamp_ms: 1000,
        };
        let prompt = build_prompt(&event, "FL-01 and W-03", "Minimum 5 m clearance.");
        assert!(prompt.contains("PROXIMITY_ALERT"));
        assert!(prompt.contains("3.20"));
        assert!(prompt.contains("5.00"));
        assert!(prompt.contains("FL-01 and W-03"));
        assert!(prompt.contains("Minimum 5 m clearance."));
    }
}
