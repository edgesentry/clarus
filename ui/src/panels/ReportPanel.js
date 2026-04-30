import { invoke } from "@tauri-apps/api/core";

/**
 * ReportPanel — generates and previews a MOM safety report.
 */
export function createReportPanel() {
  const container = document.createElement("div");
  container.id = "report-panel-content";

  let allPhysicsEvents = [];
  let siteName = "Demo Site";

  container.innerHTML = `
    <h2>MOM Safety Report</h2>
    <div class="summary-grid" id="rpt-summary-grid">
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
    <button class="gen-btn" id="gen-report-btn">Generate MOM Report PDF</button>
    <div id="report-preview" style="display:none"></div>
    <div class="audit-hash" id="audit-hash-line"></div>
  `;

  const genBtn = container.querySelector("#gen-report-btn");
  const previewEl = container.querySelector("#report-preview");
  const auditHashEl = container.querySelector("#audit-hash-line");

  genBtn.addEventListener("click", async () => {
    genBtn.disabled = true;
    genBtn.textContent = "Generating…";
    previewEl.style.display = "none";

    try {
      const eventsJson = JSON.stringify(allPhysicsEvents);
      // Build a minimal assessment object
      const assessmentJson = JSON.stringify({
        timestamp_ms: Date.now(),
        repeated_rules: [],
        correlated_entities: [],
        trend: "Stable",
        event_count: allPhysicsEvents.length,
      });

      const b64Pdf = await invoke("generate_pdf_report", {
        eventsJson,
        assessmentJson,
        siteName,
      });

      // Build text preview from events
      let preview = `EdgeSentry Safety Report\n`;
      preview += `Site: ${siteName}\n`;
      preview += `Period: ${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}\n`;
      preview += `Generated: ${new Date().toISOString()}\n\n`;
      preview += `SUMMARY\n`;
      let critical = 0, high = 0, medium = 0, low = 0;
      for (const e of allPhysicsEvents) {
        switch ((e.severity || "").toUpperCase()) {
          case "CRITICAL": critical++; break;
          case "HIGH": high++; break;
          case "MEDIUM": medium++; break;
          default: low++; break;
        }
      }
      preview += `Critical: ${critical}\nHigh: ${high}\nMedium: ${medium}\nLow: ${low}\nTotal: ${allPhysicsEvents.length}\n\n`;
      preview += `PDF generated successfully (${b64Pdf.length} base64 chars).\n`;

      previewEl.textContent = preview;
      previewEl.style.display = "block";

      // Show a fake audit hash
      const hashHex = "0x" + Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
      auditHashEl.textContent = `Audit: ${hashHex}`;
    } catch (err) {
      previewEl.textContent = `Error generating report: ${err}`;
      previewEl.style.display = "block";
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = "Generate MOM Report PDF";
    }
  });

  function updateEvents(events, site) {
    allPhysicsEvents = events || [];
    siteName = site || "Demo Site";

    let critical = 0, high = 0, medium = 0, low = 0;
    for (const e of allPhysicsEvents) {
      switch ((e.severity || "").toUpperCase()) {
        case "CRITICAL": critical++; break;
        case "HIGH": high++; break;
        case "MEDIUM": medium++; break;
        default: low++; break;
      }
    }
    container.querySelector("#rpt-critical").textContent = critical;
    container.querySelector("#rpt-high").textContent = high;
    container.querySelector("#rpt-medium").textContent = medium;
    container.querySelector("#rpt-low").textContent = low;
  }

  return { el: container, updateEvents };
}
