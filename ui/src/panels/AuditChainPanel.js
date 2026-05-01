import { invoke } from "@tauri-apps/api/core";

export function createAuditChainPanel() {
  const el = document.createElement("div");
  el.className = "audit-chain-panel";
  el.style.display = "none";

  let chainJson = null;

  el.innerHTML = `
    <div class="audit-chain-header">
      <span class="audit-chain-title">Audit Chain</span>
      <span class="audit-chain-sub">sealed with BLAKE3 + Ed25519</span>
    </div>
    <table class="audit-chain-table">
      <thead>
        <tr>
          <th>#</th><th>t (ms)</th><th>rule</th>
          <th>measured</th><th>threshold</th><th>hash</th>
        </tr>
      </thead>
      <tbody id="audit-chain-rows"></tbody>
    </table>
    <div class="audit-chain-actions">
      <button class="audit-action-btn audit-action-btn--verify" id="btn-verify">
        ▶ Verify chain
      </button>
      <button class="audit-action-btn audit-action-btn--tamper" id="btn-tamper">
        ✎ Tamper record 1 value
      </button>
      <span class="audit-action-status" id="audit-status"></span>
    </div>
    <div class="audit-verify-result" id="audit-verify-result"></div>
  `;

  const tbody = el.querySelector("#audit-chain-rows");
  const statusEl = el.querySelector("#audit-status");
  const resultEl = el.querySelector("#audit-verify-result");

  let tamperedChainJson = null;
  let originalValue = null;
  let tampered = false;

  async function seal(events) {
    tampered = false;
    tamperedChainJson = null;
    resultEl.textContent = "";
    resultEl.className = "audit-verify-result";
    statusEl.textContent = "";

    if (!events || events.length === 0) { el.style.display = "none"; return; }

    try {
      const eventsJson = JSON.stringify(events);
      const result = await invoke("seal_events", { eventsJson });
      chainJson = result.chain_json;

      // Save original value for tamper demo
      originalValue = result.records[0]?.measured_value;

      tbody.innerHTML = result.records.map(r => `
        <tr class="audit-chain-row" data-seq="${r.seq}">
          <td class="ac-seq">${r.seq}</td>
          <td class="ac-ts">${r.timestamp_ms}</td>
          <td class="ac-rule">${r.rule_id}</td>
          <td class="ac-val" data-orig="${r.measured_value}">${r.measured_value.toFixed(2)}</td>
          <td class="ac-thresh">${r.threshold.toFixed(1)}</td>
          <td class="ac-hash"><code>${r.hash_hex}…</code></td>
        </tr>
      `).join("");

      el.style.display = "block";
      el.querySelector("#btn-tamper").textContent = "✎ Tamper record 1 value";
      el.querySelector("#btn-tamper").classList.remove("audit-action-btn--restore");
    } catch (err) {
      console.error("seal_events:", err);
    }
  }

  el.querySelector("#btn-verify").addEventListener("click", async () => {
    const json = tampered ? tamperedChainJson : chainJson;
    if (!json) return;
    resultEl.className = "audit-verify-result";
    resultEl.textContent = "Verifying…";
    try {
      const result = await invoke("verify_chain", { chainJson: json });
      if (result.valid) {
        resultEl.className = "audit-verify-result audit-verify-ok";
        resultEl.textContent =
          `✓ Chain valid — ${result.record_count} records · all signatures intact`;
      } else {
        resultEl.className = "audit-verify-result audit-verify-fail";
        resultEl.textContent =
          `✗ Tampering detected — payload_hash does not match signature`;
      }
    } catch (err) {
      resultEl.textContent = `Error: ${err}`;
    }
  });

  el.querySelector("#btn-tamper").addEventListener("click", () => {
    if (!chainJson) return;
    if (tampered) {
      // Restore
      tampered = false;
      tamperedChainJson = null;
      const row = tbody.querySelector("[data-seq='1'] .ac-val");
      if (row) row.textContent = parseFloat(row.dataset.orig).toFixed(2);
      row?.classList.remove("ac-val--tampered");
      el.querySelector("#btn-tamper").textContent = "✎ Tamper record 1 value";
      el.querySelector("#btn-tamper").classList.remove("audit-action-btn--restore");
      resultEl.textContent = "";
      resultEl.className = "audit-verify-result";
      statusEl.textContent = "";
      return;
    }

    // Tamper: change first record's measured_value in the chain JSON
    try {
      const chain = JSON.parse(chainJson);
      // Flip one byte of payload_hash to simulate value modification
      chain[0].payload_hash[0] = (chain[0].payload_hash[0] + 1) % 256;
      tamperedChainJson = JSON.stringify(chain);
      tampered = true;

      // Visual: show changed value in the table
      const fakeVal = originalValue != null ? (originalValue + 2.0).toFixed(2) : "—";
      const row = tbody.querySelector("[data-seq='1'] .ac-val");
      if (row) {
        row.innerHTML =
          `<span class="ac-orig">${parseFloat(row.dataset.orig).toFixed(2)}</span>` +
          ` → <span class="ac-fake">${fakeVal}</span>`;
        row.classList.add("ac-val--tampered");
      }
      statusEl.textContent = "value changed — press Verify to detect";
      statusEl.style.color = "#ffa94d";
      el.querySelector("#btn-tamper").textContent = "↩ Restore";
      el.querySelector("#btn-tamper").classList.add("audit-action-btn--restore");
      resultEl.textContent = "";
      resultEl.className = "audit-verify-result";
    } catch (err) {
      console.error("tamper:", err);
    }
  });

  return { el, seal };
}
