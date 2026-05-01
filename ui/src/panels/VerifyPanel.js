import { invoke } from "@tauri-apps/api/core";

// Intact chain: 3 records sealed with BLAKE3 + Ed25519, chain intact.
const VALID_CHAIN = '[{"device_id": "lift-01", "sequence": 1, "timestamp_ms": 1700000000000, "payload_hash": [143, 64, 207, 17, 174, 223, 226, 108, 203, 193, 201, 89, 11, 211, 226, 6, 121, 182, 67, 47, 251, 131, 239, 26, 119, 134, 72, 242, 5, 213, 207, 248], "signature": [26, 178, 96, 114, 233, 91, 246, 238, 9, 1, 212, 254, 220, 170, 197, 107, 81, 117, 77, 229, 227, 190, 217, 0, 149, 204, 80, 28, 117, 171, 187, 242, 143, 241, 170, 116, 77, 108, 193, 242, 125, 144, 252, 220, 141, 162, 18, 57, 142, 48, 90, 171, 88, 210, 17, 211, 166, 248, 1, 106, 181, 28, 77, 14], "prev_record_hash": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "object_ref": "s3://bucket/lift-01/inspection-1.bin"}, {"device_id": "lift-01", "sequence": 2, "timestamp_ms": 1700000060000, "payload_hash": [113, 39, 178, 209, 70, 194, 126, 71, 111, 224, 178, 13, 122, 171, 22, 213, 137, 231, 10, 31, 30, 179, 14, 96, 71, 179, 58, 33, 170, 117, 233, 165], "signature": [77, 243, 126, 213, 175, 179, 228, 45, 53, 45, 157, 20, 110, 231, 138, 0, 183, 186, 174, 170, 132, 169, 58, 250, 163, 170, 92, 223, 242, 144, 221, 49, 147, 63, 37, 205, 180, 170, 153, 165, 25, 196, 57, 239, 119, 201, 78, 234, 142, 247, 51, 10, 76, 11, 137, 255, 209, 56, 145, 144, 247, 42, 42, 4], "prev_record_hash": [105, 230, 28, 246, 28, 39, 240, 100, 44, 178, 79, 161, 63, 112, 6, 115, 16, 102, 161, 127, 215, 4, 124, 89, 238, 90, 53, 180, 30, 56, 203, 221], "object_ref": "s3://bucket/lift-01/inspection-2.bin"}, {"device_id": "lift-01", "sequence": 3, "timestamp_ms": 1700000120000, "payload_hash": [183, 217, 230, 89, 126, 119, 154, 75, 174, 57, 193, 27, 30, 92, 31, 221, 146, 19, 134, 240, 7, 56, 4, 11, 126, 232, 248, 147, 205, 140, 150, 77], "signature": [86, 77, 129, 146, 107, 74, 185, 28, 15, 108, 253, 1, 68, 95, 201, 150, 99, 36, 42, 144, 225, 183, 40, 120, 175, 128, 241, 192, 228, 133, 189, 245, 243, 105, 247, 110, 87, 18, 175, 135, 55, 208, 73, 97, 232, 127, 105, 222, 209, 91, 126, 25, 34, 17, 219, 163, 3, 187, 141, 134, 45, 205, 159, 7], "prev_record_hash": [91, 134, 7, 56, 194, 154, 226, 151, 136, 59, 29, 29, 58, 110, 140, 41, 134, 242, 64, 8, 16, 107, 71, 127, 66, 240, 221, 80, 163, 208, 154, 3], "object_ref": "s3://bucket/lift-01/inspection-3.bin"}]';

// Tampered chain: record 2 payload_hash[0] flipped by 1 — simulates
// an attacker modifying a measured value after the fact.
const TAMPERED_CHAIN = '[{"device_id": "lift-01", "sequence": 1, "timestamp_ms": 1700000000000, "payload_hash": [143, 64, 207, 17, 174, 223, 226, 108, 203, 193, 201, 89, 11, 211, 226, 6, 121, 182, 67, 47, 251, 131, 239, 26, 119, 134, 72, 242, 5, 213, 207, 248], "signature": [26, 178, 96, 114, 233, 91, 246, 238, 9, 1, 212, 254, 220, 170, 197, 107, 81, 117, 77, 229, 227, 190, 217, 0, 149, 204, 80, 28, 117, 171, 187, 242, 143, 241, 170, 116, 77, 108, 193, 242, 125, 144, 252, 220, 141, 162, 18, 57, 142, 48, 90, 171, 88, 210, 17, 211, 166, 248, 1, 106, 181, 28, 77, 14], "prev_record_hash": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "object_ref": "s3://bucket/lift-01/inspection-1.bin"}, {"device_id": "lift-01", "sequence": 2, "timestamp_ms": 1700000060000, "payload_hash": [114, 39, 178, 209, 70, 194, 126, 71, 111, 224, 178, 13, 122, 171, 22, 213, 137, 231, 10, 31, 30, 179, 14, 96, 71, 179, 58, 33, 170, 117, 233, 165], "signature": [77, 243, 126, 213, 175, 179, 228, 45, 53, 45, 157, 20, 110, 231, 138, 0, 183, 186, 174, 170, 132, 169, 58, 250, 163, 170, 92, 223, 242, 144, 221, 49, 147, 63, 37, 205, 180, 170, 153, 165, 25, 196, 57, 239, 119, 201, 78, 234, 142, 247, 51, 10, 76, 11, 137, 255, 209, 56, 145, 144, 247, 42, 42, 4], "prev_record_hash": [105, 230, 28, 246, 28, 39, 240, 100, 44, 178, 79, 161, 63, 112, 6, 115, 16, 102, 161, 127, 215, 4, 124, 89, 238, 90, 53, 180, 30, 56, 203, 221], "object_ref": "s3://bucket/lift-01/inspection-2.bin"}, {"device_id": "lift-01", "sequence": 3, "timestamp_ms": 1700000120000, "payload_hash": [183, 217, 230, 89, 126, 119, 154, 75, 174, 57, 193, 27, 30, 92, 31, 221, 146, 19, 134, 240, 7, 56, 4, 11, 126, 232, 248, 147, 205, 140, 150, 77], "signature": [86, 77, 129, 146, 107, 74, 185, 28, 15, 108, 253, 1, 68, 95, 201, 150, 99, 36, 42, 144, 225, 183, 40, 120, 175, 128, 241, 192, 228, 133, 189, 245, 243, 105, 247, 110, 87, 18, 175, 135, 55, 208, 73, 97, 232, 127, 105, 222, 209, 91, 126, 25, 34, 17, 219, 163, 3, 187, 141, 134, 45, 205, 159, 7], "prev_record_hash": [91, 134, 7, 56, 194, 154, 226, 151, 136, 59, 29, 29, 58, 110, 140, 41, 134, 242, 64, 8, 16, 107, 71, 127, 66, 240, 221, 80, 163, 208, 154, 3], "object_ref": "s3://bucket/lift-01/inspection-3.bin"}]';

export function createVerifyPanel() {
  const container = document.createElement("div");
  container.id = "verify-panel-content";

  container.innerHTML = `
    <div class="verify-header">
      <h2>Audit Chain Verifier</h2>
      <p class="verify-desc">
        edgesentry-audit seals every RiskEvent with a BLAKE3 hash and Ed25519 signature,
        chaining each record to the previous. Any modification — measured value, timestamp,
        regulation citation — breaks the chain and is detected here.
      </p>
    </div>

    <div class="verify-demo-row">
      <div class="verify-demo-card">
        <div class="verify-demo-label">Intact chain</div>
        <div class="verify-demo-sub">3 records · valid signatures · hash chain intact</div>
        <button class="verify-demo-btn verify-demo-btn--ok" id="btn-valid">▶ Verify</button>
        <div class="verify-result" id="result-valid"></div>
      </div>

      <div class="verify-vs">vs</div>

      <div class="verify-demo-card">
        <div class="verify-demo-label">Tampered chain</div>
        <div class="verify-demo-sub">Record 2: one byte of payload_hash modified</div>
        <button class="verify-demo-btn verify-demo-btn--bad" id="btn-tampered">▶ Verify</button>
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
          `✓ Chain valid — ${result.record_count} records<br>` +
          `<span class="verify-detail">All signatures intact · no tampering detected</span>`;
      } else {
        resultEl.className = "verify-result verify-fail";
        resultEl.innerHTML =
          `✗ Tampering detected<br>` +
          `<span class="verify-detail">${result.error || "chain integrity check failed"}</span>`;
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
