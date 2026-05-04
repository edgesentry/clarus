// EdgeSentry Vessel Risk Intelligence — app.js
// DuckDB WASM + Observable Plot, no build step required.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm";

// ── Config ────────────────────────────────────────────────────────────────────

const PARQUET_URL = "/data/analytics/vessel_features_synthetic.parquet";

const INDICATORS = [
  { key: "ais_gap_count_30d",      label: "AIS gaps (30d)",          max: 60,  fmt: v => `${v} gaps`,     risk: "higher = worse" },
  { key: "ais_gap_max_hours",      label: "Max gap duration",         max: 480, fmt: v => `${v}h`,          risk: "higher = worse" },
  { key: "sts_candidate_count",    label: "STS transfers",            max: 12,  fmt: v => `${v}`,           risk: "higher = worse" },
  { key: "loitering_hours_30d",    label: "Loitering (30d)",          max: 300, fmt: v => `${v}h`,          risk: "higher = worse" },
  { key: "sanctions_distance",     label: "Sanctions distance",       max: 10,  fmt: v => `${v} hops`,      risk: "lower = worse", invert: true },
  { key: "cluster_sanctions_ratio",label: "Cluster sanctions ratio",  max: 1,   fmt: v => `${(v*100).toFixed(0)}%`, risk: "higher = worse" },
  { key: "flag_changes_2y",        label: "Flag changes (2yr)",       max: 4,   fmt: v => `${v}`,           risk: "higher = worse" },
  { key: "ownership_depth",        label: "Ownership depth",          max: 10,  fmt: v => `${v} layers`,    risk: "higher = worse" },
  { key: "sanctions_list_count",   label: "Sanctions list hits",      max: 3,   fmt: v => `${v}`,           risk: "higher = worse" },
];

// ── DuckDB init ───────────────────────────────────────────────────────────────

async function initDB() {
  const status = document.getElementById("db-status");
  status.textContent = "Loading database…";

  const BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(BUNDLES);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  status.textContent = "Fetching vessel data…";
  const resp = await fetch(PARQUET_URL);
  if (!resp.ok) throw new Error(`Failed to fetch ${PARQUET_URL}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  await db.registerFileBuffer("vessels.parquet", new Uint8Array(buf));

  const conn = await db.connect();
  await conn.query(`CREATE TABLE vessels AS SELECT * FROM read_parquet('vessels.parquet')`);

  const row = await conn.query(`SELECT COUNT(*) AS n FROM vessels`);
  const n = row.toArray()[0].n;
  status.textContent = `${n} vessels loaded`;

  return conn;
}

// ── Fleet overview ────────────────────────────────────────────────────────────

async function renderFleetOverview(conn) {
  const result = await conn.query(`
    SELECT tier, COUNT(*) AS cnt
    FROM vessels GROUP BY tier
  `);
  const counts = { low: 0, medium: 0, high: 0 };
  for (const row of result.toArray()) counts[row.tier] = Number(row.cnt);

  document.getElementById("cnt-low").textContent  = counts.low;
  document.getElementById("cnt-med").textContent  = counts.medium;
  document.getElementById("cnt-high").textContent = counts.high;

  // Score distribution chart
  const dist = await conn.query(`
    SELECT
      FLOOR(behavioral_score / 10) * 10 AS bucket,
      COUNT(*) AS cnt
    FROM vessels
    GROUP BY bucket ORDER BY bucket
  `);
  const distData = dist.toArray().map(r => ({ bucket: Number(r.bucket), cnt: Number(r.cnt) }));

  const chart = Plot.plot({
    width: 280, height: 130,
    marginLeft: 28, marginBottom: 24, marginTop: 8, marginRight: 8,
    style: { background: "transparent", color: "#8b949e", fontSize: 11 },
    x: { label: "Risk score", tickFormat: d => d },
    y: { label: null, tickFormat: d => d },
    marks: [
      Plot.barY(distData, {
        x: "bucket",
        y: "cnt",
        fill: d => d.bucket >= 60 ? "#f85149" : d.bucket >= 30 ? "#d29922" : "#3fb950",
        dx: 2,
      }),
      Plot.ruleY([0], { stroke: "#30363d" }),
    ]
  });
  document.getElementById("dist-chart").replaceChildren(chart);
}

// ── Vessel list ───────────────────────────────────────────────────────────────

async function renderVesselList(conn, filter = "") {
  const like = filter.replace(/'/g, "''");
  const result = await conn.query(`
    SELECT mmsi, vessel_name, flag_state, behavioral_score, tier
    FROM vessels
    WHERE vessel_name ILIKE '%${like}%' OR mmsi ILIKE '%${like}%'
    ORDER BY behavioral_score DESC
    LIMIT 60
  `);
  const vessels = result.toArray();
  const list = document.getElementById("vessel-list");
  list.innerHTML = "";

  const active = document.querySelector(".vessel-item.active")?.dataset.mmsi;

  for (const v of vessels) {
    const el = document.createElement("div");
    el.className = "vessel-item" + (v.mmsi === active ? " active" : "");
    el.dataset.mmsi = v.mmsi;
    const dotClass = v.tier === "high" ? "dot-high" : v.tier === "medium" ? "dot-medium" : "dot-low";
    el.innerHTML = `
      <div class="name"><span class="score-dot ${dotClass}"></span>${v.vessel_name}</div>
      <div class="meta"><span>${v.flag_state}</span><span>${Number(v.behavioral_score).toFixed(1)}</span></div>
    `;
    el.addEventListener("click", () => selectVessel(conn, v.mmsi));
    list.appendChild(el);
  }
}

// ── Scorecard ─────────────────────────────────────────────────────────────────

async function selectVessel(conn, mmsi) {
  document.querySelectorAll(".vessel-item").forEach(el => {
    el.classList.toggle("active", el.dataset.mmsi === mmsi);
  });

  const result = await conn.query(`SELECT * FROM vessels WHERE mmsi = '${mmsi}'`);
  const v = result.toArray()[0];
  if (!v) return;

  // Cohort percentile: rank among same flag + type
  const pctResult = await conn.query(`
    SELECT
      ROUND(100.0 * SUM(CASE WHEN behavioral_score <= ${v.behavioral_score} THEN 1 ELSE 0 END) / COUNT(*), 0) AS pct
    FROM vessels
    WHERE flag_state = '${v.flag_state}' AND vessel_type = '${v.vessel_type}'
  `);
  const pct = Number(pctResult.toArray()[0].pct);

  // Show scorecard
  document.getElementById("no-selection").style.display = "none";
  document.getElementById("scorecard").style.display = "block";

  const score = Number(v.behavioral_score);
  const tier = v.tier;

  document.getElementById("sc-title").childNodes[0].textContent = v.vessel_name + " ";
  document.getElementById("sc-mmsi").textContent = `MMSI ${v.mmsi}`;
  const docLink = document.getElementById("sc-documaris-link");
  docLink.href = `https://documaris.edgesentry.io?mmsi=${v.mmsi}`;
  docLink.style.display = "inline";
  document.getElementById("sc-score").textContent = score.toFixed(1);
  document.getElementById("sc-tier").textContent = tier === "high" ? "HIGH RISK" : tier === "medium" ? "MEDIUM RISK" : "LOW RISK";
  const scoreBox = document.getElementById("sc-score-box");
  scoreBox.className = "score-box " + (tier === "high" ? "score-high" : tier === "medium" ? "score-medium" : "score-low");

  document.getElementById("sc-percentile").textContent = `${pct}th`;
  document.getElementById("sc-cohort-desc").textContent =
    `vs ${v.flag_state} ${v.vessel_type} cohort`;

  document.getElementById("sc-meta").innerHTML =
    `${v.flag_state}<br>${v.vessel_type}<br>Built ${v.built_year}`;

  // Cohort bar marker
  document.getElementById("sc-cohort-marker").style.left = `${pct}%`;

  // Indicators
  const grid = document.getElementById("sc-indicators");
  grid.innerHTML = "";
  for (const ind of INDICATORS) {
    const raw = Number(v[ind.key]);
    const norm = ind.invert
      ? 1 - Math.min(raw / ind.max, 1)
      : Math.min(raw / ind.max, 1);
    const pctBar = Math.round(norm * 100);
    const barClass = pctBar >= 60 ? "bar-high" : pctBar >= 30 ? "bar-medium" : "bar-low";
    const row = document.createElement("div");
    row.className = "indicator-row";
    row.innerHTML = `
      <span class="indicator-name">${ind.label}</span>
      <div class="bar-track"><div class="bar-fill ${barClass}" style="width:${pctBar}%"></div></div>
      <span class="indicator-val">${ind.fmt(raw)}</span>
    `;
    grid.appendChild(row);
  }

  // Premium comparison
  const traditional = Number(v.traditional_premium_usd);
  const behavioral  = Number(v.behavioral_premium_usd);
  const deltaPct    = (((behavioral - traditional) / traditional) * 100).toFixed(0);

  const signalRisk = (key, val) => {
    if (key === "ais_gap_count_30d")   return val > 10 ? "high" : val > 3  ? "med" : "ok";
    if (key === "sts_candidate_count") return val > 2  ? "high" : val > 0  ? "med" : "ok";
    if (key === "sanctions_distance")  return val <= 2 ? "high" : val <= 4 ? "med" : "ok";
    if (key === "behavioral_score")    return val >= 60 ? "high" : val >= 30 ? "med" : "ok";
    return "ok";
  };

  const SIGNALS = [
    { key: "ais_gap_count_30d",   label: "AIS gaps (30d)",     fmt: x => `${x} gaps` },
    { key: "sts_candidate_count", label: "STS transfers",       fmt: x => `${x}` },
    { key: "sanctions_distance",  label: "Sanctions proximity", fmt: x => `${x} hops` },
    { key: "behavioral_score",    label: "Behavioral score",    fmt: x => `${Number(x).toFixed(1)} / 100` },
  ];

  const signalsHtml = SIGNALS.map(s => {
    const val = Number(v[s.key]);
    const risk = signalRisk(s.key, val);
    return `<div class="prem-signal risk-${risk}">
      <div class="prem-signal-name">${s.label}</div>
      <div class="prem-signal-val">${s.fmt(val)}</div>
    </div>`;
  }).join("");

  document.getElementById("sc-premium-comparison").innerHTML = `
    <div class="prem-tier">
      <div class="prem-tier-label">Traditional underwriting</div>
      <div class="prem-tier-factors">Flag state · Vessel age · Vessel type</div>
      <div class="prem-amount">$${traditional.toLocaleString()}</div>
    </div>
    <div class="prem-divider">EdgeSentry adds</div>
    <div class="prem-tier">
      <div class="prem-signals">${signalsHtml}</div>
    </div>
    <div class="prem-delta-row">
      <div class="prem-delta-col">
        <div class="prem-delta-label">Traditional only</div>
        <div class="prem-delta-amount delta-base">$${traditional.toLocaleString()}</div>
      </div>
      <div class="prem-delta-arrow">→</div>
      <div class="prem-delta-col">
        <div class="prem-delta-label">With EdgeSentry</div>
        <div class="prem-delta-amount delta-high">$${behavioral.toLocaleString()}</div>
      </div>
      <div class="prem-delta-badge">+${deltaPct}%</div>
    </div>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const conn = await initDB();
await renderFleetOverview(conn);
await renderVesselList(conn);

// Auto-select: URL param (?mmsi=) takes priority, falls back to demo spotlight
const autoMmsi = new URLSearchParams(location.search).get("mmsi") ?? "563012345";
await selectVessel(conn, autoMmsi);
if (location.search.includes("mmsi=")) {
  document.querySelector(".vessel-item.active")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Search
document.getElementById("vessel-search").addEventListener("input", e => {
  renderVesselList(conn, e.target.value);
});
