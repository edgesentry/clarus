import { invoke } from "@tauri-apps/api/core";

/**
 * EventDetail — shown below the right panel when user clicks an event.
 * Returns an element and a show(event, profileDir, llmUrl) function.
 */
export function createEventDetail() {
  const container = document.createElement("div");
  container.id = "event-detail";
  container.style.display = "none";

  function show(event, profileDir, llmUrl) {
    container.style.display = "block";

    const sevLabel = (event.severity || "LOW").toUpperCase();
    container.innerHTML = `
      <h3>${event.rule_id} <span class="severity-badge sev-${sevLabel.toLowerCase()}">${sevLabel}</span></h3>
      <div class="detail-row">
        <span class="detail-label">Measured value:</span>
        <span class="detail-val">${event.measured_value != null ? event.measured_value.toFixed(3) : "—"}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Threshold:</span>
        <span class="detail-val">${event.threshold != null ? event.threshold.toFixed(3) : "—"}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Entities:</span>
        <span class="detail-val">${(event.entity_ids || []).join(", ")}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Regulation:</span>
        <span class="detail-val">${event.regulation || "—"}</span>
      </div>
      <div class="explanation-text" id="explanation-body">
        <span class="spinner"></span> Fetching LLM explanation…
      </div>
      <button class="copy-btn" id="copy-explanation-btn" style="display:none">Copy explanation</button>
    `;

    const explanationBody = container.querySelector("#explanation-body");
    const copyBtn = container.querySelector("#copy-explanation-btn");

    const riskEventJson = JSON.stringify({
      rule_id: event.rule_id,
      severity: event.severity,
      regulation: event.regulation,
      entity_ids: event.entity_ids,
      measured_value: event.measured_value,
      threshold: event.threshold,
      timestamp_ms: event.timestamp_ms,
    });

    invoke("explain_event", {
      riskEventJson,
      profileDir: profileDir || "",
      llmUrl: llmUrl || "http://localhost:8080",
    })
      .then((result) => {
        const grounded = result.grounded ? " (grounded)" : " (ungrounded — no KB match)";
        explanationBody.textContent = result.text + grounded;
        copyBtn.style.display = "inline-block";
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(result.text).catch(() => {});
        };
      })
      .catch((err) => {
        explanationBody.textContent = `LLM unavailable: ${err}`;
      });
  }

  function hide() {
    container.style.display = "none";
    container.innerHTML = "";
  }

  return { el: container, show, hide };
}
