use serde::{Deserialize, Serialize};

/// Thin client for any OpenAI-compatible local LLM server.
///
/// Works with llama-server (llama.cpp) at http://localhost:8080 (default)
/// and with Ollama at http://localhost:11434 when its OpenAI-compat layer is enabled.
pub struct LlmClient {
    base_url: String,
    model: String,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: [ChatMessage<'a>; 1],
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Deserialize)]
struct AssistantMessage {
    content: String,
}

impl LlmClient {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
        }
    }

    /// Default: llama-server on localhost:8080, Llama 3.2 model.
    pub fn default_local() -> Self {
        Self::new("http://localhost:8080", "llama3.2")
    }

    /// Send a prompt; returns the assistant reply text.
    pub fn generate(&self, prompt: &str) -> Result<String, String> {
        let url = format!("{}/v1/chat/completions", self.base_url);
        let body = ChatRequest {
            model: &self.model,
            messages: [ChatMessage { role: "user", content: prompt }],
            stream: false,
        };
        let resp: ChatResponse = ureq::post(&url)
            .send_json(&body)
            .map_err(|e| format!("LLM request failed: {e}"))?
            .into_json()
            .map_err(|e| format!("LLM response parse error: {e}"))?;
        resp.choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| "LLM returned empty choices".to_string())
    }
}

/// Backward-compatible alias.
pub type OllamaClient = LlmClient;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_constructs_with_custom_url() {
        let c = LlmClient::new("http://192.168.1.10:8080", "mistral");
        assert_eq!(c.base_url, "http://192.168.1.10:8080");
        assert_eq!(c.model, "mistral");
    }

    #[test]
    fn default_local_uses_localhost_8080() {
        let c = LlmClient::default_local();
        assert!(c.base_url.contains("localhost:8080"));
    }
}
