import { invoke } from "@tauri-apps/api/core";

export function createReportPanel() {
  const container = document.createElement("div");
  container.id = "report-panel-content";

  let allPhysicsEvents = [];
  let siteName = "Demo Site";

  container.innerHTML = `
    <h2>MOM Safety Report</h2>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="count count-critical" id="rpt-critical">0</div>
        <div class="label">Critical</div>
      </div>
      <div class="summary-card">
        <div class="count count-high" id="rpt-high">0</div>
        <div class="label">High</div>
      </div>
      <div class="summary-card">
        <div class="count count-medium" id="rpt-medium">0</div>
        <div class="label">Medium</div>
      </div>
      <div class="summary-card">
        <div class="count count-low" id="rpt-low">0</div>
        <div class="label">Low</div>
      </div>
    </div>

    <p style="color:#888;font-size:0.85rem;margin:8px 0 16px">
      Run the demo first to populate events, then generate the report.
      The PDF is produced by the edgesentry-report Rust crate.
    </p>

    <button class="gen-btn" id="gen-report-btn">Generate MOM Report PDF</button>
    <div id="report-status" style="margin-top:12px;color:#00d4aa;display:none"></div>
    <div id="report-error"  style="margin-top:12px;color:#ff6b6b;display:none"></div>
    <div id="report-preview" style="display:none;margin-top:16px;white-space:pre;font-family:monospace;font-size:0.8rem;background:#111;padding:12px;border-radius:6px;border:1px solid #333;max-height:300px;overflow:auto"></div>
  `;

  const genBtn    = container.querySelector("#gen-report-btn");
  const statusEl  = container.querySelector("#report-status");
  const errorEl   = container.querySelector("#report-error");
  const previewEl = container.querySelector("#report-preview");

  genBtn.addEventListener("click", async () => {
    genBtn.disabled = true;
    genBtn.textContent = "Generating…";
    statusEl.style.display = "none";
    errorEl.style.display  = "none";
    previewEl.style.display = "none";

    try {
      const eventsJson = JSON.stringify(allPhysicsEvents);

      const b64Pdf = await invoke("generate_pdf_report", {
        eventsJson,
        siteName,
      });

      // Decode base64 → Blob → object URL → download link
      const binary = atob(b64Pdf);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob   = new Blob([bytes], { type: "application/pdf" });
      const url    = URL.createObjectURL(blob);

      // Create auto-click download link
      const a = document.createElement("a");
      a.href     = url;
      a.download = `clarus-mom-report-${Date.now()}.pdf`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Also show a preview link
      statusEl.innerHTML =
        `✓ PDF generated (${Math.round(bytes.length / 1024)} KB) — ` +
        `<a href="${url}" target="_blank" style="color:#00d4aa">open in browser</a>`;
      statusEl.style.display = "block";

      // Text preview
      let critical = 0, high = 0, medium = 0, low = 0;
      for (const e of allPhysicsEvents) {
        switch ((e.severity || "").toUpperCase()) {
          case "CRITICAL": critical++; break;
          case "HIGH":     high++;     break;
          case "MEDIUM":   medium++;   break;
          default:         low++;      break;
        }
      }
      previewEl.textContent =
        `EdgeSentry MOM Safety Report\n` +
        `Site:      ${siteName}\n` +
        `Generated: ${new Date().toISOString()}\n\n` +
        `SUMMARY\n` +
        `Critical: ${critical}\nHigh: ${high}\nMedium: ${medium}\nLow: ${low}\n` +
        `Total:    ${allPhysicsEvents.length} events\n\n` +
        `Monitoring system: active and enforcing correct standard at time of event.\n` +
        `Audit: sealed by edgesentry-audit (BLAKE3 + Ed25519)`;
      previewEl.style.display = "block";

    } catch (err) {
      errorEl.textContent = `Error: ${err}`;
      errorEl.style.display = "block";
      console.error("generate_pdf_report failed:", err);
    } finally {
      genBtn.disabled  = false;
      genBtn.textContent = "Generate MOM Report PDF";
    }
  });

  function updateEvents(events, site) {
    allPhysicsEvents = events || [];
    siteName = site || "Demo Site";
    _updateCounts();
  }

  function _updateCounts() {
    let critical = 0, high = 0, medium = 0, low = 0;
    for (const e of allPhysicsEvents) {
      switch ((e.severity || "").toUpperCase()) {
        case "CRITICAL": critical++; break;
        case "HIGH":     high++;     break;
        case "MEDIUM":   medium++;   break;
        default:         low++;      break;
      }
    }
    container.querySelector("#rpt-critical").textContent = critical;
    container.querySelector("#rpt-high").textContent     = high;
    container.querySelector("#rpt-medium").textContent   = medium;
    container.querySelector("#rpt-low").textContent      = low;
  }

  return { el: container, updateEvents };
}
