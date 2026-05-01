import { invoke } from "@tauri-apps/api/core";

const COLLAPSED_H = 0;   // hidden
const DEFAULT_H   = 44;  // minimum draggable height
const EXPANDED_H  = 300; // auto-expand when first alert fires

export function createEventDetail(onExplanation) {
  // ── Wrapper (the resizable bottom sheet) ──────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.id = "event-detail-wrapper";
  wrapper.style.height = `${COLLAPSED_H}px`;

  // Drag handle
  const handle = document.createElement("div");
  handle.id = "event-detail-handle";
  handle.innerHTML = `<div class="handle-grip"></div><span class="handle-label">Alert detail — drag to resize</span>`;
  wrapper.appendChild(handle);

  // Scrollable content area
  const content = document.createElement("div");
  content.id = "event-detail-content";
  wrapper.appendChild(content);

  // ── Drag-to-resize ────────────────────────────────────────────────────────
  let dragging = false;
  let startY = 0;
  let startH = 0;

  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startY = e.clientY;
    startH = wrapper.offsetHeight;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;          // drag UP = bigger
    const newH = Math.min(560, Math.max(DEFAULT_H, startH + delta));
    wrapper.style.height = `${newH}px`;
    wrapper.style.transition = "none";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  });

  // ── Content renderer ──────────────────────────────────────────────────────
  function show(event, profileDir, llmUrl) {
    // Expand to default height on first show
    if (wrapper.offsetHeight < DEFAULT_H) {
      wrapper.style.transition = "height 0.2s ease";
      wrapper.style.height = `${EXPANDED_H}px`;
    }

    const sevLabel = (event.severity || "LOW").toUpperCase();
    const sevClass = `sev-${sevLabel.toLowerCase()}`;

    content.innerHTML = `
      <div class="detail-header">
        <span class="detail-rule">${event.rule_id}</span>
        <span class="severity-badge ${sevClass}">${sevLabel}</span>
        <span class="detail-entities">${(event.entity_ids || []).join(" · ")}</span>
      </div>
      <div class="detail-fields">
        <div class="detail-row">
          <span class="detail-label">TTC / measured</span>
          <span class="detail-val">${event.measured_value != null ? event.measured_value.toFixed(2) + " s" : "—"}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Threshold</span>
          <span class="detail-val">${event.threshold != null ? event.threshold.toFixed(1) + " s" : "—"}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Regulation</span>
          <span class="detail-val">${event.regulation || "—"}</span>
        </div>
      </div>
      <div class="explanation-text" id="explanation-body">
        <span class="spinner"></span> Requesting LLM explanation…
      </div>
      <button class="copy-btn" id="copy-explanation-btn" style="display:none">Copy</button>
    `;

    const explanationBody = content.querySelector("#explanation-body");
    const copyBtn = content.querySelector("#copy-explanation-btn");

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
        const tag = result.grounded ? "" : " (no KB match)";
        explanationBody.textContent = result.text + tag;
        copyBtn.style.display = "inline-block";
        copyBtn.onclick = () => navigator.clipboard.writeText(result.text).catch(() => {});
        if (onExplanation) {
          onExplanation({ rule_id: event.rule_id, timestamp_ms: Date.now(), text: result.text });
        }
      })
      .catch((err) => {
        explanationBody.textContent = `LLM unavailable — start ./scripts/run_llama.sh (${err})`;
      });
  }

  function hide() {
    wrapper.style.transition = "height 0.2s ease";
    wrapper.style.height = `${COLLAPSED_H}px`;
    content.innerHTML = "";
  }

  return { el: wrapper, show, hide };
}
