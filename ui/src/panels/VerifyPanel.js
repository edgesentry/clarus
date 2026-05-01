import { invoke } from "@tauri-apps/api/core";

/**
 * VerifyPanel — paste AuditRecord JSON array and verify the hash chain.
 */
export function createVerifyPanel() {
  const container = document.createElement("div");
  container.id = "verify-panel-content";

  container.innerHTML = `
    <h2>Audit Chain Verifier</h2>
    <p style="font-size:12px;color:#8b949e">
      Paste a JSON array of AuditRecord objects to verify tamper-evidence.
    </p>
    <textarea id="chain-json" placeholder='[{"device_id":"...","sequence":1,...}]'></textarea>
    <button class="verify-btn" id="verify-btn">Verify Chain</button>
    <div id="verify-result"></div>
  `;

  const textarea = container.querySelector("#chain-json");
  const verifyBtn = container.querySelector("#verify-btn");
  const resultEl = container.querySelector("#verify-result");

  verifyBtn.addEventListener("click", async () => {
    const chainJson = textarea.value.trim();
    if (!chainJson) {
      resultEl.className = "verify-result verify-fail";
      resultEl.textContent = "Paste an AuditRecord JSON array first.";
      return;
    }

    verifyBtn.disabled = true;
    resultEl.className = "";
    resultEl.textContent = "Verifying…";

    try {
      const result = await invoke("verify_chain", { chainJson });
      if (result.valid) {
        resultEl.className = "verify-result verify-ok";
        resultEl.textContent = `Chain valid — ${result.record_count} records, no tampering detected`;
      } else {
        resultEl.className = "verify-result verify-fail";
        resultEl.textContent = `Chain invalid: ${result.error || "unknown error"}`;
      }
    } catch (err) {
      resultEl.className = "verify-result verify-fail";
      resultEl.textContent = `Error: ${err}`;
    } finally {
      verifyBtn.disabled = false;
    }
  });

  return { el: container };
}
