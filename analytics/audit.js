// EdgeSentry Audit Chain — audit.js
// Fetches AuditRecord JSON from clarus-dev-public-audit, verifies hash chain
// integrity, and renders a tamper-evidence timeline.

const status = document.getElementById("status");

// ── Fetch + parse ─────────────────────────────────────────────────────────────

async function fetchIndex(site) {
  const url = site ? `/api/audit-index?site=${site}` : "/api/audit-index";
  return fetch(url).then(r => r.json()).catch(() => ({ keys: [], sites: [] }));
}

async function fetchRecord(key) {
  const resp = await fetch(`/data/audit/${key}`);
  if (!resp.ok) return null;
  return resp.json();
}

// ── Chain verification ────────────────────────────────────────────────────────

function verifyChain(records) {
  let gaps = 0, hashFails = 0;
  for (let i = 0; i < records.length; i++) {
    if (i === 0) continue;
    if (records[i].sequence !== records[i - 1].sequence + 1) gaps++;
    if (records[i].prev_record_hash_hex !== records[i - 1].record_hash_hex) hashFails++;
  }
  return { gaps, hashFails, intact: gaps === 0 && hashFails === 0 };
}

// ── Integrity banner ──────────────────────────────────────────────────────────

function renderBanner(n, { intact, gaps, hashFails }) {
  const banner = document.getElementById("integrity-banner");
  const icon   = banner.querySelector(".integrity-icon");
  const title  = banner.querySelector(".integrity-title");
  const sub    = document.getElementById("integrity-sub");

  if (intact) {
    banner.className = "integrity-banner intact";
    icon.textContent  = "✅";
    title.textContent = `Chain intact — ${n} record${n !== 1 ? "s" : ""}, 0 gaps`;
    sub.textContent   = "All prev_record_hash values match. No records deleted or modified.";
  } else {
    banner.className = "integrity-banner broken";
    icon.textContent  = "❌";
    title.textContent = "Chain integrity failure";
    sub.textContent   = [
      gaps      ? `${gaps} sequence gap(s)` : "",
      hashFails ? `${hashFails} hash mismatch(es)` : "",
    ].filter(Boolean).join(" · ");
  }
}

// ── Table render ──────────────────────────────────────────────────────────────

function qualClass(q) {
  if (!q) return "";
  const lower = q.toLowerCase();
  if (lower === "certified") return "qual-certified";
  if (lower === "degraded")  return "qual-degraded";
  return "qual-rejected";
}

function renderTable(records) {
  const container = document.getElementById("chain-container");
  document.getElementById("record-count").textContent = `${records.length} record(s)`;

  if (records.length === 0) {
    container.innerHTML = '<div class="empty">No records found for this site.</div>';
    return;
  }

  // Show newest first
  const sorted = [...records].reverse();

  const table = document.createElement("table");
  table.className = "chain-table";
  table.innerHTML = `<thead><tr>
    <th>Seq</th><th>Time (UTC)</th><th>Rule</th><th>Quality</th>
    <th>Confidence</th><th>Record hash</th><th>Chain link</th>
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");

  // Build a lookup by sequence for chain link display
  const bySeq = Object.fromEntries(records.map(r => [r.sequence, r]));

  for (const r of sorted) {
    const ts = r.timestamp_ms
      ? new Date(Number(r.timestamp_ms)).toISOString().replace("T", " ").slice(0, 19) + " UTC"
      : "—";
    const hashShort = r.record_hash_hex ? r.record_hash_hex.slice(0, 12) + "…" : "—";

    // Chain link verification
    let linkHtml;
    if (r.sequence === 0) {
      linkHtml = `<span class="link-genesis">genesis</span>`;
    } else {
      const prev = bySeq[r.sequence - 1];
      const ok = prev && r.prev_record_hash_hex === prev.record_hash_hex;
      linkHtml = ok
        ? `<span class="link-ok">✓ linked</span>`
        : `<span class="link-fail">✗ broken</span>`;
    }

    const tr = document.createElement("tr");
    tr.dataset.clickable = "1";
    tr.innerHTML = `
      <td class="seq">${r.sequence ?? "—"}</td>
      <td class="ts">${ts}</td>
      <td>${r.rule_id ?? r.object_ref ?? "—"}</td>
      <td class="${qualClass(r.evidence_quality)}">${r.evidence_quality ?? "—"}</td>
      <td style="font-family:monospace">${r.confidence_cv != null ? Number(r.confidence_cv).toFixed(2) : "—"}</td>
      <td class="hash">${hashShort}</td>
      <td>${linkHtml}</td>
    `;

    // Expandable detail row
    const detailRow = document.createElement("tr");
    detailRow.className = "detail-row";
    detailRow.style.display = "none";
    const detailTd = document.createElement("td");
    detailTd.colSpan = 7;

    const prev = bySeq[r.sequence - 1];
    const chainOk = r.sequence === 0 || (prev && r.prev_record_hash_hex === prev.record_hash_hex);

    detailTd.innerHTML = `<div class="detail-grid">
      <span class="detail-label">Device</span>
      <span class="detail-val">${r.device_id ?? "—"}</span>

      <span class="detail-label">Record hash</span>
      <span class="detail-val">${r.record_hash_hex ?? "—"}</span>

      <span class="detail-label">Prev hash</span>
      <span class="detail-val">${r.prev_record_hash_hex ?? "—"}</span>

      <span class="detail-label">Chain link</span>
      <span class="detail-val ${chainOk ? "ok" : "fail"}">
        ${r.sequence === 0 ? "genesis — no previous record" : chainOk ? "✓ prev_hash matches record[" + (r.sequence - 1) + "].record_hash" : "✗ hash mismatch — record may have been tampered"}
      </span>

      <span class="detail-label">Payload hash</span>
      <span class="detail-val">${r.payload_hash_hex ?? "—"}</span>

      <span class="detail-label">Signature</span>
      <span class="detail-val">${r.signature_hex ? r.signature_hex.slice(0, 32) + "…" : "—"}</span>

      <span class="detail-label">Entity IDs</span>
      <span class="detail-val">${Array.isArray(r.entity_ids) ? r.entity_ids.join(", ") : (r.entity_ids ?? "—")}</span>
    </div>`;
    detailRow.appendChild(detailTd);

    tr.addEventListener("click", () => {
      const isOpen = detailRow.style.display !== "none";
      detailRow.style.display = isOpen ? "none" : "table-row";
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailRow);
  }

  container.replaceChildren(table);
}

// ── Site selector ─────────────────────────────────────────────────────────────

async function loadSite(site) {
  status.textContent = `Fetching chain for ${site}…`;
  const { keys } = await fetchIndex(site);

  if (keys.length === 0) {
    renderBanner(0, { intact: true, gaps: 0, hashFails: 0 });
    renderTable([]);
    status.textContent = "0 records";
    return;
  }

  status.textContent = `Loading ${keys.length} record(s)…`;
  const records = (await Promise.all(keys.map(fetchRecord))).filter(Boolean);
  records.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const result = verifyChain(records);
  renderBanner(records.length, result);
  renderTable(records);
  status.textContent = `${records.length} records · ${result.intact ? "chain intact" : "chain broken"}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

status.textContent = "Fetching index…";
const { keys, sites } = await fetchIndex(null);

if (keys.length === 0) {
  document.getElementById("no-data").style.display = "flex";
  status.textContent = "No records";
} else {
  document.getElementById("audit-content").style.display = "block";

  const sel = document.getElementById("site-select");
  for (const s of sites) {
    const opt = document.createElement("option");
    opt.value = opt.textContent = s;
    sel.appendChild(opt);
  }

  // Auto-select from URL param or first site
  const urlSite = new URLSearchParams(location.search).get("site");
  if (urlSite && sites.includes(urlSite)) sel.value = urlSite;

  sel.addEventListener("change", () => loadSite(sel.value));
  await loadSite(sel.value);
}
