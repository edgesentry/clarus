// EdgeSentry Upload Status dashboard — no DuckDB needed, pure R2 index queries.
import { ageStr, ageClass, dotClass } from "./status-helpers.js";

interface RawStat { hb_files: number; chain_files: number; latest_ms: number; }
interface WormRun  { run_id: string; count: number; }
interface WormStat { runs: WormRun[]; total: number; }
interface SiteStat { site_id: string; raw: RawStat; worm: WormStat; }
interface StatusIndex { sites: SiteStat[]; generated_at_ms: number; }

const REFRESH_INTERVAL_S = 30;

const statusLine  = document.getElementById("status-line")!;
const kpiRow      = document.getElementById("kpi-row")!;
const tableWrap   = document.getElementById("site-table-container")!;
const generatedAt = document.getElementById("generated-at")!;
const countdownEl = document.getElementById("countdown")!;
const refreshBtn  = document.getElementById("refresh-btn") as HTMLButtonElement;

function renderKpis(data: StatusIndex): void {
  const totalRaw  = data.sites.reduce((s, x) => s + x.raw.hb_files + x.raw.chain_files, 0);
  const totalWorm = data.sites.reduce((s, x) => s + x.worm.total, 0);
  const latestMs  = data.sites.reduce((m, x) => Math.max(m, x.raw.latest_ms), 0);

  const [k0, k1, k2, k3] = kpiRow.querySelectorAll<HTMLElement>(".kpi");

  k0.querySelector(".value")!.textContent = String(data.sites.length);
  k0.className = "kpi " + (data.sites.length > 0 ? "green" : "amber");

  k1.querySelector(".value")!.textContent = String(totalRaw);
  k1.className = "kpi " + (totalRaw > 0 ? "green" : "amber");

  k2.querySelector(".value")!.textContent = String(totalWorm);
  k2.className = "kpi " + (totalWorm > 0 ? "green" : "amber");

  k3.querySelector(".value")!.textContent = ageStr(latestMs);
  k3.className = "kpi " + ageClass(latestMs);
}

function renderTable(data: StatusIndex): void {
  if (data.sites.length === 0) {
    tableWrap.innerHTML = '<div class="empty">No sites found in R2. Start the edge daemon to generate data.</div>';
    return;
  }

  const table = document.createElement("table");
  table.className = "site-table";
  table.innerHTML = `<thead><tr>
    <th>Site</th>
    <th>Heartbeat files</th>
    <th>Audit chain (raw)</th>
    <th>Last sync</th>
    <th>WORM records</th>
    <th>Runs</th>
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody")!;

  for (const s of data.sites) {
    const dot = `<span class="dot ${dotClass(s.raw.latest_ms)}"></span>`;
    const age = ageStr(s.raw.latest_ms);

    const wormPillCls = s.worm.total > 0 ? "pill-green" : "pill-muted";
    const wormPill = `<span class="pill ${wormPillCls}">${s.worm.total} records</span>`;

    const runsHtml = s.worm.runs.length === 0
      ? '<span style="color:var(--muted);font-size:12px">no runs yet</span>'
      : `<div class="run-list">${s.worm.runs.slice(0, 5).map(r => {
          const runAge = ageStr(Number(r.run_id));
          return `<div class="run-row"><span class="run-count">${r.count}</span><span title="run_id: ${r.run_id}">${runAge}</span></div>`;
        }).join("")}${s.worm.runs.length > 5 ? `<div class="run-row" style="color:var(--muted)">+ ${s.worm.runs.length - 5} older run(s)</div>` : ""}</div>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${dot}${s.site_id}</strong></td>
      <td style="font-family:monospace">${s.raw.hb_files}</td>
      <td style="font-family:monospace">${s.raw.chain_files}</td>
      <td>${age}</td>
      <td>${wormPill}</td>
      <td>${runsHtml}</td>
    `;
    tbody.appendChild(tr);
  }

  tableWrap.replaceChildren(table);
}

async function load(): Promise<void> {
  statusLine.innerHTML = `<span class="spinner"></span>`;
  try {
    const data = await fetch("/api/status-index").then(r => r.json() as Promise<StatusIndex>);
    renderKpis(data);
    renderTable(data);
    const ts = new Date(data.generated_at_ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
    generatedAt.textContent = `Generated at ${ts}`;
    statusLine.textContent = `${data.sites.length} site(s)`;
  } catch (e) {
    statusLine.textContent = `Error: ${(e as Error).message}`;
    tableWrap.innerHTML = `<div class="empty">Failed to load status index: ${(e as Error).message}</div>`;
  }
}

// ── Auto-refresh countdown ────────────────────────────────────────────────────

let remaining = REFRESH_INTERVAL_S;
setInterval(() => {
  remaining--;
  countdownEl.textContent = `Auto-refresh in ${remaining}s`;
  if (remaining <= 0) {
    remaining = REFRESH_INTERVAL_S;
    load();
  }
}, 1000);

refreshBtn.addEventListener("click", () => {
  remaining = REFRESH_INTERVAL_S;
  load();
});

load();
