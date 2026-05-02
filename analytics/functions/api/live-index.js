/**
 * GET /api/live-index
 * Lists all Parquet files in clarus-dev-public-raw under live/ prefix.
 * Returns { heartbeats: string[], alerts: string[], sites: string[] }
 */
export async function onRequestGet({ env }) {
  const result = await env.CLARUS_DEV_PUBLIC_RAW.list({ prefix: "live/" });

  const keys = result.objects.map((o) => o.key);
  const heartbeats = keys.filter(
    (k) => k.includes("/heartbeats/") && k.endsWith(".parquet")
  );
  const alerts = keys.filter(
    (k) => k.includes("/audit_chain/") && k.endsWith(".parquet")
  );
  const sites = [
    ...new Set(keys.map((k) => k.split("/")[1]).filter(Boolean)),
  ];

  return Response.json(
    { heartbeats, alerts, sites },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
