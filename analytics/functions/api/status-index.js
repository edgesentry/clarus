/**
 * GET /api/status-index
 * Aggregates raw + WORM audit buckets into a per-site upload status summary.
 *
 * Returns:
 * {
 *   sites: [{
 *     site_id, raw: { hb_files, chain_files, latest_ms }, worm: { runs: [{run_id, count}], total }
 *   }],
 *   generated_at_ms
 * }
 */
export async function onRequestGet({ env }) {
  const [rawList, auditList] = await Promise.all([
    env.CLARUS_DEV_PUBLIC_RAW.list({ prefix: "live/" }),
    env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix: "chains/", limit: 1000 }),
  ]);

  // ── Raw bucket ────────────────────────────────────────────────────────────────
  const rawBySite = {};
  for (const obj of rawList.objects) {
    // key: live/{site_id}/{table}/{timestamp_ms}.parquet
    const parts = obj.key.split("/");
    if (parts.length < 4) continue;
    const site = parts[1];
    const table = parts[2];
    const ts = parseInt(parts[3], 10);
    if (!rawBySite[site]) rawBySite[site] = { hb_files: 0, chain_files: 0, latest_ms: 0 };
    if (table === "heartbeats") rawBySite[site].hb_files++;
    if (table === "audit_chain") rawBySite[site].chain_files++;
    if (!isNaN(ts) && ts > rawBySite[site].latest_ms) rawBySite[site].latest_ms = ts;
  }

  // ── WORM audit bucket ─────────────────────────────────────────────────────────
  // key: chains/{site_id}/{run_id}/{sequence:020}.json  (new format with run_id)
  // key: chains/{site_id}/{sequence:020}.json           (legacy format, no run_id)
  const wormBySite = {};
  for (const obj of auditList.objects) {
    const parts = obj.key.split("/");
    if (parts.length < 3) continue;
    const site = parts[1];
    const isNewFormat = parts.length >= 4;
    const runId = isNewFormat ? parts[2] : "legacy";
    if (!wormBySite[site]) wormBySite[site] = {};
    if (!wormBySite[site][runId]) wormBySite[site][runId] = 0;
    wormBySite[site][runId]++;
  }

  // ── Merge ─────────────────────────────────────────────────────────────────────
  const allSites = new Set([
    ...Object.keys(rawBySite),
    ...Object.keys(wormBySite),
  ]);

  const sites = [...allSites].sort().map((site_id) => {
    const raw = rawBySite[site_id] ?? { hb_files: 0, chain_files: 0, latest_ms: 0 };
    const wormRuns = wormBySite[site_id] ?? {};
    const runs = Object.entries(wormRuns)
      .map(([run_id, count]) => ({ run_id, count }))
      .sort((a, b) => b.run_id.localeCompare(a.run_id)); // newest first
    const total = runs.reduce((s, r) => s + r.count, 0);
    return { site_id, raw, worm: { runs, total } };
  });

  return Response.json(
    { sites, generated_at_ms: Date.now() },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
