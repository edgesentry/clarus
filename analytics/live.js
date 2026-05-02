// EdgeSentry Operations Monitor — live.js
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
import * as Plot   from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm";

// ── LLM alert explanation ─────────────────────────────────────────────────────
// Calls local llama.cpp via Caddy HTTPS proxy (run_llama.sh starts both).
// Caches results in DuckDB WASM so each alert is only explained once.

const LLM_ENDPOINT = "https://localhost:8443/v1/chat/completions";
const LLM_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT =
  "You are an EdgeSentry safety analyst writing event explanations for an insurance audit trail. " +
  "Write exactly 2 sentences:\n" +
  "Sentence 1: What physical situation triggered the alert and which regulation was breached.\n" +
  "Sentence 2: Recommended action for site operators.\n" +
  "STRICT: no mention of evidence quality, confidence, or admissibility — that will be added separately. " +
  "No markdown. No bullet points. Maximum 2 sentences.";

function buildAlertPrompt(r) {
  const entities = (() => { try { return JSON.parse(r.entity_ids).join(", "); } catch { return r.entity_ids; } })();
  const qualNote = r.evidence_quality === "Certified"
    ? "CERTIFIED — full evidential weight, admissible"
    : r.evidence_quality === "Degraded"
    ? "DEGRADED — reduced evidential weight, requires corroboration"
    : "REJECTED — CV confidence below 0.5, NOT admissible as standalone evidence";
  return [
    `Rule: ${r.rule_id}`,
    `Severity: ${r.severity}`,
    `Measured value: ${Number(r.measured_value).toFixed(2)} (threshold: ${Number(r.threshold).toFixed(2)})`,
    `Entities: ${entities}`,
    `Evidence quality: ${qualNote}`,
    `CV confidence: ${Number(r.confidence_cv).toFixed(2)}`,
    `Site: ${r.site_id}`,
  ].join("\n");
}

async function initExplainCache(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS alert_explanations (
      cache_key  TEXT PRIMARY KEY,
      explanation TEXT NOT NULL,
      generated_at TIMESTAMP DEFAULT now()
    )
  `);
}

function alertCacheKey(r) {
  return `${r.site_id}:${r.rule_id}:${r.timestamp_ms}`;
}

async function getCachedExplanation(conn, key) {
  const res = await conn.query(
    `SELECT explanation FROM alert_explanations WHERE cache_key = '${key.replace(/'/g,"''")}' LIMIT 1`
  );
  const rows = res.toArray();
  return rows.length > 0 ? rows[0].explanation : null;
}

async function saveExplanation(conn, key, text) {
  await conn.query(`
    INSERT INTO alert_explanations (cache_key, explanation)
    VALUES ('${key.replace(/'/g,"''")}', '${text.replace(/'/g,"''")}')
    ON CONFLICT (cache_key) DO UPDATE SET explanation = excluded.explanation, generated_at = now()
  `);
}

// Build the evidence quality sentence deterministically — never trust the LLM for this.
function evidenceQualitySentence(r) {
  const conf = Number(r.confidence_cv).toFixed(2);
  switch (r.evidence_quality) {
    case "Certified":
      return `Evidence quality: CERTIFIED (CV confidence ${conf}) — this record carries full evidential weight and is admissible in insurance claims.`;
    case "Degraded":
      return `Evidence quality: DEGRADED (CV confidence ${conf}) — this record carries reduced evidential weight and should be corroborated before use in a claim.`;
    default:
      return `Evidence quality: REJECTED (CV confidence ${conf}) — CV confidence was below 0.5; this record is NOT admissible as standalone evidence and must not be cited in a claim without independent corroboration.`;
  }
}

async function fetchExplanation(row) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_tokens: 120,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: buildAlertPrompt(row) },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const llmText = (data?.choices?.[0]?.message?.content ?? "").trim();
    // Inject the deterministic evidence quality sentence between LLM sentences 1 and 2.
    const sentences = llmText.split(/(?<=\.)\s+/);
    const s1 = sentences[0] ?? llmText;
    const rest = sentences.slice(1).join(" ");
    return [s1, evidenceQualitySentence(row), rest].filter(Boolean).join(" ");
  } finally {
    clearTimeout(timer);
  }
}

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

  // Persist alert_explanations cache across page reloads via OPFS.
  // Falls back to in-memory if OPFS is unavailable (Safari Private mode).
  try {
    await db.open({ path: "opfs://clarus-analytics.db" });
    status.textContent = "Database ready (persistent)";
  } catch {
    await db.open({ path: ":memory:" });
    status.textContent = "Database ready (in-memory)";
  }

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

async function populateRuleFilter(conn) {
  const res = await conn.query(`SELECT DISTINCT rule_id FROM audit_chain ORDER BY rule_id`);
  const sel = document.getElementById("filter-rule");
  const existing = [...sel.options].map(o => o.value);
  for (const r of res.toArray()) {
    if (!existing.includes(r.rule_id)) {
      const opt = document.createElement("option");
      opt.value = opt.textContent = r.rule_id;
      sel.appendChild(opt);
    }
  }
}

async function renderAlerts(conn) {
  const rule     = document.getElementById("filter-rule")?.value     || "";
  const severity = document.getElementById("filter-severity")?.value || "";
  const quality  = document.getElementById("filter-quality")?.value  || "";

  const conditions = [siteWhere()];
  if (rule)     conditions.push(`rule_id = '${rule}'`);
  if (severity) conditions.push(`severity = '${severity}'`);
  if (quality)  conditions.push(`evidence_quality = '${quality}'`);

  const where = conditions.join(" AND ");

  const res = await conn.query(`
    SELECT timestamp_ms, site_id, rule_id, severity, evidence_quality,
           confidence_cv, measured_value, entity_ids
    FROM audit_chain WHERE ${where}
    ORDER BY timestamp_ms DESC LIMIT 100
  `);
  const rows = res.toArray();
  const container = document.getElementById("alert-container");
  document.getElementById("filter-count").textContent = `${rows.length} row(s)`;

  if (rows.length === 0) {
    container.innerHTML = '<div class="empty">No alerts match the current filter.</div>';
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
    tr.style.cursor = "pointer";
    tr.title = "Click to explain with local LLM";
    tr.innerHTML = `
      <td class="ts">${ts}</td><td>${r.site_id}</td><td>${r.rule_id}</td>
      <td class="${sevCls}">${r.severity}</td><td class="${qualCls}">${r.evidence_quality}</td>
      <td style="font-family:monospace">${Number(r.confidence_cv).toFixed(2)}</td>
      <td style="font-family:monospace">${Number(r.measured_value).toFixed(2)}</td>
      <td style="color:var(--muted)">${entities}</td>
    `;

    // Expandable explanation row
    const expRow = document.createElement("tr");
    expRow.className = "explain-row";
    expRow.style.display = "none";
    const expTd = document.createElement("td");
    expTd.colSpan = 8;
    expTd.className = "explain-cell";
    expRow.appendChild(expTd);

    tr.addEventListener("click", async () => {
      const isOpen = expRow.style.display !== "none";
      if (isOpen) { expRow.style.display = "none"; return; }

      expRow.style.display = "table-row";
      expTd.innerHTML = `<span class="explain-loading">Thinking…</span>`;

      const key = alertCacheKey(r);
      const cached = await getCachedExplanation(conn, key);
      if (cached) { render(cached, true); return; }

      const render = (text, fromCache) => {
        expTd.innerHTML = `
          <span>${text}</span>
          <button class="regen-btn" title="Regenerate explanation">↻</button>
        `;
        expTd.querySelector(".regen-btn").addEventListener("click", async (e) => {
          e.stopPropagation();
          expTd.innerHTML = `<span class="explain-loading">Regenerating…</span>`;
          try {
            const fresh = await fetchExplanation(r);
            await saveExplanation(conn, key, fresh);
            render(fresh, false);
          } catch (err) {
            expTd.innerHTML = `<span style="color:var(--red)">Error: ${err.message}</span>`;
          }
        });
      };

      try {
        const text = await fetchExplanation(r);
        await saveExplanation(conn, key, text);
        render(text, false);
      } catch (e) {
        const isOffline = e.name === "AbortError" || e.message.includes("fetch") || e.message.includes("Load failed");
        expTd.innerHTML = isOffline
          ? `<span style="color:var(--amber)">LLM offline — run <code>./scripts/run_llama.sh</code> to enable explanations</span>`
          : `<span style="color:var(--red)">Error: ${e.message}</span>`;
      }
    });

    tbody.appendChild(tr);
    tbody.appendChild(expRow);
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

  await initExplainCache(conn);
  await populateRuleFilter(conn);
  await refreshCharts(conn, sites);

  // Alert filter listeners
  ["filter-rule", "filter-severity", "filter-quality"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => renderAlerts(conn));
  });
  document.getElementById("filter-clear")?.addEventListener("click", () => {
    document.getElementById("filter-rule").value     = "";
    document.getElementById("filter-severity").value = "";
    document.getElementById("filter-quality").value  = "";
    renderAlerts(conn);
  });
}
