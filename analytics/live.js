// EdgeSentry Operations Monitor — live.js
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
import * as Plot   from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm";

const status = document.getElementById("db-status");

// ── DuckDB init ───────────────────────────────────────────────────────────────

async function initDB() {
  status.textContent = "Initialising database…";
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  return db;
}

async function loadParquetFiles(db, conn, keys, tableName) {
  if (keys.length === 0) return false;
  const fnames = [];
  for (const [i, key] of keys.entries()) {
    const resp = await fetch(`/data/raw/${key}`);
    if (!resp.ok) continue;
    await db.registerFileBuffer(`${tableName}_${i}.parquet`, new Uint8Array(await resp.arrayBuffer()));
    fnames.push(`${tableName}_${i}.parquet`);
  }
  if (fnames.length === 0) return false;
  await conn.query(`
    CREATE OR REPLACE TABLE ${tableName} AS
    SELECT * FROM read_parquet([${fnames.map(f => `'${f}'`).join(",")}])
    ORDER BY timestamp_ms
  `);
  return true;
}

// ── Site selector ─────────────────────────────────────────────────────────────

let selectedSite = null; // null = all sites

function siteWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return selectedSite ? `${prefix}site_id = '${selectedSite}'` : "1=1";
}

// ── Site status cards (clickable) ─────────────────────────────────────────────

async function renderSiteStatus(conn, sites) {
  const grid = document.getElementById("site-grid");
  grid.innerHTML = "";

  // "All" card
  const allCard = document.createElement("div");
  allCard.className = "site-card" + (selectedSite === null ? " selected" : "");
  allCard.dataset.site = "";
  allCard.innerHTML = `<div class="name">All sites</div><div class="meta">${sites.length} site(s)</div>`;
  grid.appendChild(allCard);

  for (const site of sites) {
    const res = await conn.query(`
      SELECT calibration_status, drift_score, timestamp_ms,
             certified_count + degraded_count + rejected_count AS total
      FROM heartbeats WHERE site_id = '${site}'
      ORDER BY timestamp_ms DESC LIMIT 1
    `);
    const rows = res.toArray();
    if (rows.length === 0) continue;
    const r = rows[0];
    const cal = r.calibration_status;
    const dotCls = cal === "VALID" ? "dot-valid" : cal === "DEGRADED" ? "dot-degraded" : "dot-uncalibrated";
    const age = Math.round((Date.now() - Number(r.timestamp_ms)) / 1000);
    const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;

    const card = document.createElement("div");
    card.className = "site-card" + (selectedSite === site ? " selected" : "");
    card.dataset.site = site;
    card.innerHTML = `
      <div class="name"><span class="dot ${dotCls}"></span>${site}</div>
      <div class="status">${cal} &nbsp;·&nbsp; drift ${Number(r.drift_score).toFixed(3)} m</div>
      <div class="meta">Last: ${ageStr} &nbsp;·&nbsp; ${r.total} events</div>
    `;
    grid.appendChild(card);
  }

  // Click handler
  grid.querySelectorAll(".site-card").forEach(card => {
    card.addEventListener("click", async () => {
      selectedSite = card.dataset.site || null;
      await refreshCharts(conn, sites);
    });
  });
}

// ── Charts ────────────────────────────────────────────────────────────────────

async function renderDriftChart(conn) {
  const res = await conn.query(`
    SELECT timestamp_ms, site_id, drift_score, calibration_status
    FROM heartbeats WHERE ${siteWhere()}
    ORDER BY timestamp_ms
  `);
  const data = res.toArray().map(r => ({
    ts: new Date(Number(r.timestamp_ms)), site: r.site_id,
    drift: Number(r.drift_score), status: r.calibration_status,
  }));
  const chart = Plot.plot({
    width: 520, height: 150,
    marginLeft: 42, marginBottom: 28, marginTop: 8, marginRight: 12,
    style: { background: "transparent", color: "#8b949e", fontSize: 11 },
    x: { label: null, tickFormat: d => `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}` },
    y: { label: "drift (m)", domain: [0, 0.9] },
    color: { domain: ["VALID","DEGRADED","UNCALIBRATED"], range: ["#3fb950","#d29922","#f85149"] },
    marks: [
      Plot.ruleY([0.3], { stroke: "#d29922", strokeDasharray: "4 2", strokeWidth: 1 }),
      Plot.ruleY([0.6], { stroke: "#f85149", strokeDasharray: "4 2", strokeWidth: 1 }),
      Plot.line(data, { x: "ts", y: "drift", stroke: "site", strokeWidth: 1.5, opacity: 0.8 }),
      Plot.dot(data,  { x: "ts", y: "drift", fill: "status", r: 3 }),
    ],
  });
  document.getElementById("drift-chart").replaceChildren(chart);
}

async function renderQualityChart(conn) {
  const res = await conn.query(`
    SELECT timestamp_ms, site_id, certified_count, degraded_count, rejected_count
    FROM heartbeats WHERE ${siteWhere()}
    ORDER BY timestamp_ms
  `);
  const data = res.toArray().flatMap(r => [
    { ts: new Date(Number(r.timestamp_ms)), site: r.site_id, quality: "Certified", count: Number(r.certified_count) },
    { ts: new Date(Number(r.timestamp_ms)), site: r.site_id, quality: "Degraded",  count: Number(r.degraded_count) },
    { ts: new Date(Number(r.timestamp_ms)), site: r.site_id, quality: "Rejected",  count: Number(r.rejected_count) },
  ]);
  const chart = Plot.plot({
    width: 520, height: 150,
    marginLeft: 32, marginBottom: 28, marginTop: 8, marginRight: 12,
    style: { background: "transparent", color: "#8b949e", fontSize: 11 },
    x: { label: null, tickFormat: d => `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}` },
    y: { label: "events" },
    color: { domain: ["Certified","Degraded","Rejected"], range: ["#3fb950","#d29922","#f85149"] },
    marks: [
      Plot.barY(data, Plot.stackY({ x: "ts", y: "count", fill: "quality" })),
      Plot.ruleY([0], { stroke: "#30363d" }),
    ],
  });
  document.getElementById("quality-chart").replaceChildren(chart);
}

async function renderAlerts(conn) {
  const res = await conn.query(`
    SELECT timestamp_ms, site_id, rule_id, severity, evidence_quality,
           confidence_cv, measured_value, entity_ids
    FROM audit_chain WHERE ${siteWhere()}
    ORDER BY timestamp_ms DESC LIMIT 50
  `);
  const rows = res.toArray();
  const container = document.getElementById("alert-container");
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty">No alerts recorded yet.</div>';
    return;
  }
  const table = document.createElement("table");
  table.className = "alert-table";
  table.innerHTML = `<thead><tr>
    <th>Time (UTC)</th><th>Site</th><th>Rule</th><th>Severity</th>
    <th>Quality</th><th>Confidence</th><th>Value</th><th>Entities</th>
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  for (const r of rows) {
    const qualCls = r.evidence_quality === "Certified" ? "qual-certified"
                  : r.evidence_quality === "Degraded"  ? "qual-degraded" : "qual-rejected";
    const sevCls  = r.severity === "Critical" ? "sev-critical" : "sev-high";
    const entities = (() => { try { return JSON.parse(r.entity_ids).join(", "); } catch { return r.entity_ids ?? "—"; } })();
    const ts = new Date(Number(r.timestamp_ms)).toISOString().replace("T"," ").slice(0,19) + " UTC";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="ts">${ts}</td><td>${r.site_id}</td><td>${r.rule_id}</td>
      <td class="${sevCls}">${r.severity}</td><td class="${qualCls}">${r.evidence_quality}</td>
      <td style="font-family:monospace">${Number(r.confidence_cv).toFixed(2)}</td>
      <td style="font-family:monospace">${Number(r.measured_value).toFixed(2)}</td>
      <td style="color:var(--muted)">${entities}</td>
    `;
    tbody.appendChild(tr);
  }
  container.replaceChildren(table);
}

// ── Refresh all charts with current site filter ───────────────────────────────

async function refreshCharts(conn, sites) {
  await renderSiteStatus(conn, sites);
  await renderDriftChart(conn);
  await renderQualityChart(conn);
  await renderAlerts(conn);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const db   = await initDB();
const conn = await db.connect();

status.textContent = "Fetching live index…";
const { heartbeats: hbKeys, alerts: alertKeys, sites } =
  await fetch("/api/live-index").then(r => r.json())
  .catch(() => ({ heartbeats: [], alerts: [], sites: [] }));

if (hbKeys.length === 0 && alertKeys.length === 0) {
  document.getElementById("no-data").style.display = "flex";
  status.textContent = "No data";
} else {
  document.getElementById("live-content").style.display = "block";
  status.textContent = `Loading ${hbKeys.length + alertKeys.length} file(s)…`;

  const hasHB  = await loadParquetFiles(db, conn, hbKeys,    "heartbeats");
  const hasAlt = await loadParquetFiles(db, conn, alertKeys, "audit_chain");

  const n = await conn.query("SELECT COUNT(*) AS n FROM heartbeats").then(r => r.toArray()[0]?.n ?? 0);
  status.textContent = `${n} heartbeats · ${sites.length} site(s)`;

  await refreshCharts(conn, sites);
}
