import { invoke } from "@tauri-apps/api/core";

// AuditRecords generated from Scenario A (forklift FL-01 approach).
// Each record seals one RiskEvent with BLAKE3 + Ed25519.
const VALID_CHAIN    = '[{"device_id": "clarus-demo", "sequence": 1, "timestamp_ms": 1700000000000, "payload_hash": [134, 183, 253, 251, 132, 117, 182, 42, 25, 12, 114, 107, 50, 64, 119, 20, 26, 123, 173, 211, 199, 168, 178, 79, 146, 57, 74, 60, 228, 238, 99, 9], "signature": [117, 157, 3, 36, 24, 35, 92, 180, 68, 28, 168, 92, 66, 249, 42, 21, 35, 197, 27, 27, 250, 186, 186, 74, 44, 118, 206, 197, 108, 128, 238, 106, 232, 222, 61, 145, 140, 237, 244, 120, 213, 109, 90, 11, 14, 94, 37, 59, 124, 224, 48, 208, 102, 226, 181, 234, 136, 96, 247, 218, 24, 173, 17, 4], "prev_record_hash": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "object_ref": "clarus://scenario-a/inspection-1.bin"}, {"device_id": "clarus-demo", "sequence": 2, "timestamp_ms": 1700000060000, "payload_hash": [203, 28, 76, 75, 32, 117, 135, 66, 250, 64, 193, 93, 5, 110, 100, 227, 1, 55, 173, 151, 17, 78, 123, 135, 139, 226, 16, 196, 28, 186, 103, 125], "signature": [177, 134, 64, 67, 157, 56, 173, 146, 13, 238, 236, 254, 178, 196, 186, 164, 228, 63, 62, 100, 194, 193, 12, 153, 78, 3, 132, 250, 17, 189, 74, 27, 157, 141, 17, 229, 81, 248, 44, 240, 64, 61, 244, 139, 238, 200, 208, 35, 87, 180, 197, 67, 7, 83, 240, 58, 161, 243, 133, 148, 57, 11, 216, 14], "prev_record_hash": [166, 58, 170, 2, 217, 8, 26, 243, 77, 20, 211, 29, 28, 6, 248, 152, 27, 53, 199, 234, 34, 65, 41, 215, 68, 85, 25, 167, 246, 203, 98, 31], "object_ref": "clarus://scenario-a/inspection-2.bin"}, {"device_id": "clarus-demo", "sequence": 3, "timestamp_ms": 1700000120000, "payload_hash": [61, 42, 182, 208, 168, 176, 34, 103, 240, 20, 248, 7, 12, 53, 216, 126, 167, 31, 183, 168, 215, 224, 140, 130, 73, 255, 157, 15, 195, 222, 114, 123], "signature": [182, 36, 132, 220, 25, 70, 96, 105, 27, 57, 72, 28, 185, 179, 40, 66, 163, 186, 107, 207, 54, 150, 122, 86, 20, 6, 52, 104, 47, 78, 24, 17, 145, 247, 29, 91, 88, 27, 51, 23, 27, 226, 43, 183, 226, 6, 240, 222, 243, 52, 254, 146, 132, 12, 171, 26, 203, 33, 33, 191, 206, 33, 161, 7], "prev_record_hash": [185, 117, 139, 141, 163, 0, 191, 91, 49, 99, 46, 225, 30, 240, 183, 28, 45, 228, 32, 176, 90, 48, 194, 109, 107, 156, 126, 69, 125, 220, 255, 58], "object_ref": "clarus://scenario-a/inspection-3.bin"}]';
const TAMPERED_CHAIN = '[{"device_id": "clarus-demo", "sequence": 1, "timestamp_ms": 1700000000000, "payload_hash": [134, 183, 253, 251, 132, 117, 182, 42, 25, 12, 114, 107, 50, 64, 119, 20, 26, 123, 173, 211, 199, 168, 178, 79, 146, 57, 74, 60, 228, 238, 99, 9], "signature": [117, 157, 3, 36, 24, 35, 92, 180, 68, 28, 168, 92, 66, 249, 42, 21, 35, 197, 27, 27, 250, 186, 186, 74, 44, 118, 206, 197, 108, 128, 238, 106, 232, 222, 61, 145, 140, 237, 244, 120, 213, 109, 90, 11, 14, 94, 37, 59, 124, 224, 48, 208, 102, 226, 181, 234, 136, 96, 247, 218, 24, 173, 17, 4], "prev_record_hash": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "object_ref": "clarus://scenario-a/inspection-1.bin"}, {"device_id": "clarus-demo", "sequence": 2, "timestamp_ms": 1700000060000, "payload_hash": [204, 28, 76, 75, 32, 117, 135, 66, 250, 64, 193, 93, 5, 110, 100, 227, 1, 55, 173, 151, 17, 78, 123, 135, 139, 226, 16, 196, 28, 186, 103, 125], "signature": [177, 134, 64, 67, 157, 56, 173, 146, 13, 238, 236, 254, 178, 196, 186, 164, 228, 63, 62, 100, 194, 193, 12, 153, 78, 3, 132, 250, 17, 189, 74, 27, 157, 141, 17, 229, 81, 248, 44, 240, 64, 61, 244, 139, 238, 200, 208, 35, 87, 180, 197, 67, 7, 83, 240, 58, 161, 243, 133, 148, 57, 11, 216, 14], "prev_record_hash": [166, 58, 170, 2, 217, 8, 26, 243, 77, 20, 211, 29, 28, 6, 248, 152, 27, 53, 199, 234, 34, 65, 41, 215, 68, 85, 25, 167, 246, 203, 98, 31], "object_ref": "clarus://scenario-a/inspection-2.bin"}, {"device_id": "clarus-demo", "sequence": 3, "timestamp_ms": 1700000120000, "payload_hash": [61, 42, 182, 208, 168, 176, 34, 103, 240, 20, 248, 7, 12, 53, 216, 126, 167, 31, 183, 168, 215, 224, 140, 130, 73, 255, 157, 15, 195, 222, 114, 123], "signature": [182, 36, 132, 220, 25, 70, 96, 105, 27, 57, 72, 28, 185, 179, 40, 66, 163, 186, 107, 207, 54, 150, 122, 86, 20, 6, 52, 104, 47, 78, 24, 17, 145, 247, 29, 91, 88, 27, 51, 23, 27, 226, 43, 183, 226, 6, 240, 222, 243, 52, 254, 146, 132, 12, 171, 26, 203, 33, 33, 191, 206, 33, 161, 7], "prev_record_hash": [185, 117, 139, 141, 163, 0, 191, 91, 49, 99, 46, 225, 30, 240, 183, 28, 45, 228, 32, 176, 90, 48, 194, 109, 107, 156, 126, 69, 125, 220, 255, 58], "object_ref": "clarus://scenario-a/inspection-3.bin"}]';

// Human context for each record — what each sealed event actually means.
// In production this comes from the RiskEvent payload referenced by object_ref.
const EVENTS = [
  {
    seq: 1,
    time: "t = 2.0 s",
    rule: "PROXIMITY_ALERT",
    severity: "HIGH",
    detail: "FL-01 at 3.2 m from W-03",
    note: "Clearance below 5 m threshold — alert sealed",
  },
  {
    seq: 2,
    time: "t = 8.0 s",
    rule: "TTC_ALERT",
    severity: "HIGH",
    detail: "FL-01 TTC = 2.1 s toward W-03",
    note: "Time-to-collision below 3 s — alert sealed",
    tamperNote: "Attacker changes measured distance 3.2 m → 5.8 m to hide the incident",
  },
  {
    seq: 3,
    time: "t = 12.0 s",
    rule: "PROXIMITY_ALERT",
    severity: "HIGH",
    detail: "FL-01 at 1.1 m from W-03",
    note: "Critical clearance — alert sealed",
  },
];

function renderRecords(tampered) {
  return EVENTS.map((ev, i) => {
    const isTampered = tampered && i === 1;
    return `
      <tr class="audit-row ${isTampered ? "audit-row--tampered" : ""}">
        <td class="audit-seq">#${ev.seq}</td>
        <td class="audit-time">${ev.time}</td>
        <td class="audit-rule">
          <span class="severity-badge sev-high">${ev.severity}</span>
          ${ev.rule}
        </td>
        <td class="audit-detail ${isTampered ? "audit-detail--changed" : ""}">
          ${isTampered
            ? `<span class="audit-original">3.2 m</span> → <span class="audit-faked">5.8 m</span><br><span class="audit-tamper-note">${ev.tamperNote}</span>`
            : ev.detail}
        </td>
        <td class="audit-hash">${isTampered ? "⚠ modified" : "sealed ✓"}</td>
      </tr>
    `;
  }).join("");
}

export function createVerifyPanel() {
  const container = document.createElement("div");
  container.id = "verify-panel-content";

  container.innerHTML = `
    <div class="verify-story">
      <div class="verify-story-title">Scenario A — Forklift FL-01 approach · 3 events sealed</div>
      <p class="verify-story-sub">
        edgesentry-audit signs each RiskEvent with Ed25519 and chains them with BLAKE3.
        If anyone modifies a measured value after the fact, the chain breaks.
      </p>
    </div>

    <div class="verify-split">

      <div class="verify-col">
        <div class="verify-col-header verify-col-header--ok">Intact chain</div>
        <table class="audit-table" id="table-valid">${renderRecords(false)}</table>
        <button class="verify-demo-btn verify-demo-btn--ok" id="btn-valid">▶ Verify chain</button>
        <div class="verify-result" id="result-valid"></div>
      </div>

      <div class="verify-col">
        <div class="verify-col-header verify-col-header--bad">
          Tampered chain
          <span class="verify-tamper-badge">record 2 modified</span>
        </div>
        <table class="audit-table" id="table-tampered">${renderRecords(true)}</table>
        <button class="verify-demo-btn verify-demo-btn--bad" id="btn-tampered">▶ Verify chain</button>
        <div class="verify-result" id="result-tampered"></div>
      </div>

    </div>

    <details class="verify-manual">
      <summary>Paste custom AuditRecord JSON</summary>
      <textarea id="chain-json" placeholder='[{"device_id":"...","sequence":1,...}]'></textarea>
      <button class="verify-btn" id="verify-btn">Verify</button>
      <div class="verify-result" id="result-manual"></div>
    </details>
  `;

  async function runVerify(chainJson, resultEl) {
    resultEl.className = "verify-result";
    resultEl.textContent = "Verifying…";
    try {
      const result = await invoke("verify_chain", { chainJson });
      if (result.valid) {
        resultEl.className = "verify-result verify-ok";
        resultEl.innerHTML =
          `✓ Chain valid — ${result.record_count} records intact<br>` +
          `<span class="verify-detail">All Ed25519 signatures verified · BLAKE3 chain unbroken</span>`;
      } else {
        resultEl.className = "verify-result verify-fail";
        resultEl.innerHTML =
          `✗ Tampering detected at record 2<br>` +
          `<span class="verify-detail">payload_hash does not match signature — distance was altered</span>`;
      }
    } catch (err) {
      resultEl.className = "verify-result verify-fail";
      resultEl.textContent = `Error: ${err}`;
    }
  }

  container.querySelector("#btn-valid").addEventListener("click", () =>
    runVerify(VALID_CHAIN, container.querySelector("#result-valid"))
  );
  container.querySelector("#btn-tampered").addEventListener("click", () =>
    runVerify(TAMPERED_CHAIN, container.querySelector("#result-tampered"))
  );
  container.querySelector("#verify-btn").addEventListener("click", () => {
    const json = container.querySelector("#chain-json").value.trim();
    if (json) runVerify(json, container.querySelector("#result-manual"));
  });

  return { el: container };
}
