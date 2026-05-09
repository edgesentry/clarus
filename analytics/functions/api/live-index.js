/**
 * GET /api/live-index
 * Returns Parquet keys for /admin/live to load via DuckDB WASM.
 *
 * Priority (fastest → most complete):
 *   1. rollup/{site}/heartbeats.parquet + rollup/{site}/alerts.parquet
 *      Written hourly by indago rollup_clarus_live.py — one file per site.
 *   2. Fallback: latest MAX_PER_SITE raw files per site (if no rollup yet).
 *
 * Pass ?all=1 to skip rollup and return every raw file (debug).
 *
 * Returns { heartbeats: string[], alerts: string[], sites: string[] }
 */

const MAX_PER_SITE = 5;

function latestPerSite(keys) {
  const bySite = {};
  for (const k of keys) {
    const site = k.split("/")[1];
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(k);
  }
  const result = [];
  for (const group of Object.values(bySite)) {
    group.sort();
    result.push(...group.slice(-MAX_PER_SITE));
  }
  return result;
}

// Parse cutoff timestamp from ?days= (default 90). Returns 0 if disabled.
function cutoffMs(params) {
  const days = parseInt(params.get("days") ?? "90", 10);
  if (!days || days <= 0) return 0;
  return Date.now() - days * 86_400_000;
}

// Filename is the timestamp_ms: live/{site}/{table}/{timestamp_ms}.parquet
function keyTs(key) {
  const name = key.split("/").pop() ?? "";
  return parseInt(name, 10) || 0;
}

export async function onRequestGet({ env, request, waitUntil }) {
  const cacheKey = new Request(request.url);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const params  = new URL(request.url).searchParams;
  const allMode = params.get("all") === "1";
  const cutoff  = allMode ? 0 : cutoffMs(params);

  // List both rollup/ and live/ prefixes in parallel
  const [rollupResult, liveResult] = await Promise.all([
    env.CLARUS_DEV_PUBLIC_RAW.list({ prefix: "rollup/" }),
    env.CLARUS_DEV_PUBLIC_RAW.list({ prefix: "live/"   }),
  ]);

  const rollupKeys = rollupResult.objects.map((o) => o.key);
  // Apply time-window filter at key level — filename IS the timestamp_ms,
  // so we never download files older than the cutoff.
  const liveKeys = liveResult.objects
    .map((o) => o.key)
    .filter((k) => cutoff === 0 || keyTs(k) >= cutoff);

  // Sites present in either bucket
  const rollupSites = new Set(rollupKeys.map((k) => k.split("/")[1]).filter(Boolean));
  const liveSites   = [...new Set(liveKeys.map((k) => k.split("/")[1]).filter(Boolean))];

  let heartbeats, alerts;

  if (!allMode && rollupSites.size > 0) {
    // Prefer rollup files — one file per site per table
    heartbeats = rollupKeys.filter((k) => k.endsWith("/heartbeats.parquet"));
    alerts     = rollupKeys.filter((k) => k.endsWith("/alerts.parquet"));

    // Supplement with raw fallback for sites not yet rolled up
    const rawHb = liveKeys.filter((k) => k.includes("/heartbeats/") && k.endsWith(".parquet"));
    const rawAl = liveKeys.filter((k) => k.includes("/audit_chain/") && k.endsWith(".parquet"));
    for (const k of latestPerSite(rawHb)) {
      const site = k.split("/")[1];
      if (!rollupSites.has(site)) heartbeats.push(k);
    }
    for (const k of latestPerSite(rawAl)) {
      const site = k.split("/")[1];
      if (!rollupSites.has(site)) alerts.push(k);
    }
  } else {
    // No rollup or ?all=1 — fall back to latest raw files
    const rawHb = liveKeys.filter((k) => k.includes("/heartbeats/") && k.endsWith(".parquet"));
    const rawAl = liveKeys.filter((k) => k.includes("/audit_chain/") && k.endsWith(".parquet"));
    heartbeats = allMode ? rawHb : latestPerSite(rawHb);
    alerts     = allMode ? rawAl : latestPerSite(rawAl);
  }

  const sites = [...new Set([...rollupSites, ...liveSites])].sort();

  const response = Response.json(
    { heartbeats, alerts, sites },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=60, max-age=10" } }
  );
  waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
