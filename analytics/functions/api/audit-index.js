/**
 * Lists signed AuditRecord keys from clarus-dev-public-audit.
 *
 * GET /api/audit-index?site=site_sgp_001
 *   → { keys: ["chains/site_sgp_001/00000000000000000000.json", ...], sites: ["site_sgp_001"] }
 *
 * Keys are sorted lexicographically (zero-padded sequence → ascending order).
 */
export async function onRequestGet({ env, request, waitUntil }) {
  const cacheKey = new Request(request.url);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const params = new URL(request.url).searchParams;
  const site   = params.get("site");
  const run    = params.get("run");   // optional run_id filter

  // Narrow prefix as much as possible to minimise list overhead
  let prefix = "chains/";
  if (site && run)  prefix = `chains/${site}/${run}/`;
  else if (site)    prefix = `chains/${site}/`;

  const listed = await env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix, limit: 1000 });
  const keys = listed.objects.map(o => o.key).sort();
  const sites = [...new Set(keys.map(k => k.split("/")[1]))].filter(Boolean);

  const response = Response.json({ keys, sites }, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=60, max-age=10" },
  });
  waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
