// EdgeSentry Audit Chain — audit.ts
// Boot: load /api/audit-summary (key-structure only, no records) → show run cards.
// On run card click: fetch that run's records via /api/audit-index?site=X&run=Y.
export {}; // module scope

import { getCachedAuditRecord, setCachedAuditRecord } from "./opfs-cache.js";

interface AuditRecord {
  sequence: number;
  timestamp_ms: number | string;
  rule_id?: string;
  object_ref?: string;
  evidence_quality?: string;
  confidence_cv?: number | string;
  record_hash_hex?: string;
  prev_record_hash_hex?: string;
  payload_hash_hex?: string;
  signature_hex?: string;
  device_id?: string;
  entity_ids?: string | string[];
}

interface RunSummary {
  site_id: string;
  run_id: string;
  record_count: number;
  first_seq: number;
  last_seq: number;
  run_ts_ms: number;
}

interface AuditSummary {
  sites: string[];
  runs: RunSummary[];
}

const status = document.getElementById("status") as HTMLElement;

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchSummary(site: string | null): Promise<AuditSummary> {
  const url = site ? `/api/audit-summary?site=${site}` : "/api/audit-summary";
  return fetch(url).then(r => r.json()).catch(() => ({ sites: [], runs: [] }));
}

async function fetchRunRecords(site: string, runId: string): Promise<AuditRecord[]> {
  const { keys } = await fetch(`/api/audit-index?site=${site}&run=${runId}`)
    .then(r => r.json())
    .catch(() => ({ keys: [] }));

  return (await Promise.all(
    (keys as string[]).map(fetchRecord)
  )).filter((r): r is AuditRecord => r !== null);
}

async function fetchRecord(key: string): Promise<AuditRecord | null> {
  const cached = await getCachedAuditRecord(key);
  if (cached) return JSON.parse(cached) as AuditRecord;
  const resp = await fetch(`/data/audit/${key}`);
  if (!resp.ok) return null;
  const text = await resp.text();
  await setCachedAuditRecord(key, text);
  return JSON.parse(text) as AuditRecord;
}

// ── Chain verification ────────────────────────────────────────────────────────

interface VerifyResult { gaps: number; hashFails: number; intact: boolean; }

function verifyChain(records: AuditRecord[]): VerifyResult {
  let gaps = 0, hashFails = 0;
  for (let i = 1; i < records.length; i++) {
    if (records[i].sequence !== records[i - 1].sequence + 1) gaps++;
    if (records[i].prev_record_hash_hex !== records[i - 1].record_hash_hex) hashFails++;
  }
  return { gaps, hashFails, intact: gaps === 0 && hashFails === 0 };
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderBanner(n: number, { intact, gaps, hashFails }: VerifyResult): void {
  const banner = document.getElementById("integrity-banner")!;
  const icon   = banner.querySelector(".integrity-icon") as HTMLElement;
  const title  = banner.querySelector(".integrity-title") as HTMLElement;
  const sub    = document.getElementById("integrity-sub")!;
  if (intact) {
    banner.className = "integrity-banner intact";
    icon.textContent  = "✅";
    title.textContent = `Chain intact — ${n} record${n !== 1 ? "s" : ""}, 0 gaps`;
    sub.textContent   = "All prev_record_hash values match. No records deleted or modified.";
  } else {
    banner.className = "integrity-banner broken";
    icon.textContent  = "❌";
    title.textContent = "Chain integrity failure";
    sub.textContent   = [gaps ? `${gaps} gap(s)` : "", hashFails ? `${hashFails} hash mismatch(es)` : ""].filter(Boolean).join(" · ");
  }
}

function qualClass(q: string | undefined): string {
  const l = (q ?? "").toLowerCase();
  return l === "certified" ? "qual-certified" : l === "degraded" ? "qual-degraded" : l ? "qual-rejected" : "";
}

function renderTable(records: AuditRecord[]): void {
  const container = document.getElementById("chain-container")!;
  document.getElementById("record-count")!.textContent = `${records.length} record(s)`;

  if (records.length === 0) {
    container.innerHTML = '<div class="empty">No records found.</div>';
    return;
  }

  const sorted = [...records].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
  const table = document.createElement("table");
  table.className = "chain-table";
  table.innerHTML = `<thead><tr>
    <th>Seq</th><th>Time (UTC)</th><th>Rule</th><th>Quality</th>
    <th>Confidence</th><th>Record hash</th><th>Chain link</th>
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody")!;
  const bySeq = Object.fromEntries(records.map(r => [r.sequence, r]));

  for (const r of sorted) {
    const ts       = r.timestamp_ms ? new Date(Number(r.timestamp_ms)).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
    const hashShort = r.record_hash_hex ? r.record_hash_hex.slice(0, 12) + "…" : "—";
    const prev     = bySeq[r.sequence - 1];
    const linkHtml = r.sequence === 0
      ? `<span class="link-genesis">genesis</span>`
      : prev && r.prev_record_hash_hex === prev.record_hash_hex
        ? `<span class="link-ok">✓ linked</span>`
        : `<span class="link-fail">✗ broken</span>`;

    const tr = document.createElement("tr");
    tr.dataset.clickable = "1";
    tr.innerHTML = `
      <td class="seq">${r.sequence ?? "—"}</td>
      <td class="ts">${ts}</td>
      <td>${r.rule_id ?? r.object_ref ?? "—"}</td>
      <td class="${qualClass(r.evidence_quality)}">${r.evidence_quality ?? "—"}</td>
      <td style="font-family:monospace">${r.confidence_cv != null ? Number(r.confidence_cv).toFixed(2) : "—"}</td>
      <td class="hash">${hashShort}</td>
      <td>${linkHtml}</td>`;

    const detailRow = document.createElement("tr");
    detailRow.className = "detail-row";
    detailRow.style.display = "none";
    const detailTd = document.createElement("td");
    detailTd.colSpan = 7;
    const chainOk = r.sequence === 0 || (prev && r.prev_record_hash_hex === prev.record_hash_hex);
    detailTd.innerHTML = `<div class="detail-grid">
      <span class="detail-label">Device</span><span class="detail-val">${r.device_id ?? "—"}</span>
      <span class="detail-label">Record hash</span><span class="detail-val">${r.record_hash_hex ?? "—"}</span>
      <span class="detail-label">Prev hash</span><span class="detail-val">${r.prev_record_hash_hex ?? "—"}</span>
      <span class="detail-label">Chain link</span>
      <span class="detail-val ${chainOk ? "ok" : "fail"}">
        ${r.sequence === 0 ? "genesis — no previous record"
          : chainOk ? `✓ prev_hash matches record[${r.sequence - 1}].record_hash`
          : "✗ hash mismatch — record may have been tampered"}</span>
      <span class="detail-label">Payload hash</span><span class="detail-val">${r.payload_hash_hex ?? "—"}</span>
      <span class="detail-label">Signature</span><span class="detail-val">${r.signature_hex ? r.signature_hex.slice(0, 32) + "…" : "—"}</span>
      <span class="detail-label">Entity IDs</span><span class="detail-val">${Array.isArray(r.entity_ids) ? r.entity_ids.join(", ") : (r.entity_ids ?? "—")}</span>
    </div>`;
    detailRow.appendChild(detailTd);
    tr.addEventListener("click", () => { detailRow.style.display = detailRow.style.display === "none" ? "table-row" : "none"; });
    tbody.appendChild(tr);
    tbody.appendChild(detailRow);
  }

  container.replaceChildren(table);
}

// ── Run cards ─────────────────────────────────────────────────────────────────

function ageStr(tsMs: number): string {
  if (!tsMs) return "legacy";
  const s = Math.round((Date.now() - tsMs) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

let activeRunCard: HTMLElement | null = null;

function renderRunCards(runs: RunSummary[], onSelect: (r: RunSummary) => void): void {
  const grid = document.getElementById("run-grid")!;
  grid.innerHTML = "";

  // Group by site
  const bySite: Record<string, RunSummary[]> = {};
  for (const r of runs) {
    (bySite[r.site_id] ??= []).push(r);
  }

  for (const [site, siteRuns] of Object.entries(bySite)) {
    const siteHeader = document.createElement("div");
    siteHeader.className = "run-site-header";
    siteHeader.textContent = site;
    grid.appendChild(siteHeader);

    for (const run of siteRuns) {
      const card = document.createElement("div");
      card.className = "run-card";
      card.innerHTML = `
        <div class="run-card-title">${run.run_id === "legacy" ? "legacy" : ageStr(run.run_ts_ms)}</div>
        <div class="run-card-meta">${run.record_count} records &nbsp;·&nbsp; seq ${run.first_seq}–${run.last_seq}</div>
        <div class="run-card-id">${run.run_id}</div>`;
      card.addEventListener("click", () => {
        activeRunCard?.classList.remove("selected");
        card.classList.add("selected");
        activeRunCard = card;
        onSelect(run);
      });
      grid.appendChild(card);
    }
  }
}

// ── Load a run ────────────────────────────────────────────────────────────────

async function loadRun(run: RunSummary): Promise<void> {
  status.textContent = `Loading ${run.record_count} record(s) for run ${run.run_id}…`;
  document.getElementById("chain-container")!.innerHTML = '<div class="empty">Loading…</div>';
  document.getElementById("record-count")!.textContent = "…";
  renderBanner(0, { intact: true, gaps: 0, hashFails: 0 });

  const records = await fetchRunRecords(run.site_id, run.run_id);
  records.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const result = verifyChain(records);
  renderBanner(records.length, result);
  renderTable(records);
  status.textContent = `${records.length} records · ${result.intact ? "chain intact ✓" : "chain broken ✗"}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

status.textContent = "Fetching audit summary…";
const urlSite = new URLSearchParams(location.search).get("site");
const summary  = await fetchSummary(urlSite);

if (summary.runs.length === 0) {
  (document.getElementById("no-data") as HTMLElement).style.display = "flex";
  status.textContent = "No records";
} else {
  (document.getElementById("audit-content") as HTMLElement).style.display = "flex";
  status.textContent = `${summary.runs.length} run(s) · ${summary.sites.length} site(s) — select a run to verify`;

  renderRunCards(summary.runs, loadRun);

  // Auto-select the most recent run
  const first = summary.runs[0];
  const firstCard = document.querySelector(".run-card") as HTMLElement | null;
  if (firstCard) {
    firstCard.classList.add("selected");
    activeRunCard = firstCard;
  }
  await loadRun(first);
}
