use serde::{Deserialize, Serialize};

/// Thin client for a local Ollama instance (`http://localhost:11434`).
pub struct OllamaClient {
    base_url: String,
    model: String,
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    stream: bool,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

impl OllamaClient {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
        }
    }

    pub fn default_local() -> Self {
        Self::new("http://localhost:11434", "llama3.2")
    }

    /// Send a prompt to Ollama; returns the full response text.
    pub fn generate(&self, prompt: &str) -> Result<String, String> {
        let url = format!("{}/api/generate", self.base_url);
        let body = GenerateRequest {
            model: &self.model,
            prompt,
            stream: false,
        };
        let resp: GenerateResponse = ureq::post(&url)
            .send_json(&body)
            .map_err(|e| format!("Ollama request failed: {e}"))?
            .into_json()
            .map_err(|e| format!("Ollama response parse error: {e}"))?;
        Ok(resp.response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_constructs_with_custom_url() {
        let c = OllamaClient::new("http://192.168.1.10:11434", "mistral");
        assert_eq!(c.base_url, "http://192.168.1.10:11434");
        assert_eq!(c.model, "mistral");
    }

    #[test]
    fn default_local_uses_localhost() {
        let c = OllamaClient::default_local();
        assert!(c.base_url.contains("localhost"));
    }
}
