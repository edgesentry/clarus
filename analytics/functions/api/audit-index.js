/**
 * Lists signed AuditRecord keys from clarus-dev-public-audit.
 *
 * GET /api/audit-index?site=site_sgp_001
 *   → { keys: ["chains/site_sgp_001/00000000000000000000.json", ...], sites: ["site_sgp_001"] }
 *
 * Keys are sorted lexicographically (zero-padded sequence → ascending order).
 */
export async function onRequestGet({ env, request }) {
  const site = new URL(request.url).searchParams.get("site");
  const prefix = site ? `chains/${site}/` : "chains/";

  const listed = await env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix, limit: 1000 });
  const keys = listed.objects.map(o => o.key).sort();
  const sites = [...new Set(keys.map(k => k.split("/")[1]))].filter(Boolean);

  return Response.json({ keys, sites }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
