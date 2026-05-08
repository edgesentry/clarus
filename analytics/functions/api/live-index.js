/**
 * GET /api/live-index
 * Lists Parquet files in clarus-dev-public-raw under live/ prefix.
 *
 * By default returns only the latest MAX_PER_SITE files per site per table,
 * so the browser loads a small fixed number regardless of history depth.
 * Pass ?all=1 to get every file (debug only).
 *
 * Returns { heartbeats: string[], alerts: string[], sites: string[] }
 */

const MAX_PER_SITE = 5;

function latestPerSite(keys) {
  // keys are named live/{site}/{table}/{timestamp_ms}.parquet
  // lexicographic sort on the full key works because timestamp is zero-padded by ms precision
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

export async function onRequestGet({ env, request }) {
  const allMode = new URL(request.url).searchParams.get("all") === "1";
  const result = await env.CLARUS_DEV_PUBLIC_RAW.list({ prefix: "live/" });

  const keys = result.objects.map((o) => o.key);
  let heartbeats = keys.filter(
    (k) => k.includes("/heartbeats/") && k.endsWith(".parquet")
  );
  let alerts = keys.filter(
    (k) => k.includes("/audit_chain/") && k.endsWith(".parquet")
  );

  if (!allMode) {
    heartbeats = latestPerSite(heartbeats);
    alerts     = latestPerSite(alerts);
  }

  const sites = [
    ...new Set(keys.map((k) => k.split("/")[1]).filter(Boolean)),
  ];

  return Response.json(
    { heartbeats, alerts, sites },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
