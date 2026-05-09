/**
 * Summarises audit runs for a given site from clarus-dev-public-audit.
 *
 * GET /api/audit-summary?site=MCH-OUTLET-042
 *   → { runs: [{ run_id: "1778247831917", record_count: 350, last_seq: 349 }] }
 *
 * Runs are sorted newest-first (descending run_id).
 * run_id is the epoch-ms timestamp embedded in the R2 key path.
 */
export async function onRequestGet({ env, request }) {
  const site = new URL(request.url).searchParams.get("site");
  if (!site) {
    return Response.json({ error: "site parameter required" }, { status: 400 });
  }

  const prefix = `chains/${site}/`;
  const listed = await env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix, limit: 5000 });
  const keys = listed.objects.map(o => o.key);

  // Group by run_id (second path segment after site)
  const runMap = new Map();
  for (const key of keys) {
    const parts = key.split("/");
    if (parts.length < 4) continue; // chains/{site}/{run_id}/{seq}.json
    const runId = parts[2];
    const seq = parseInt(parts[3].replace(".json", ""), 10);
    if (!runMap.has(runId)) runMap.set(runId, { run_id: runId, record_count: 0, last_seq: -1 });
    const run = runMap.get(runId);
    run.record_count += 1;
    if (seq > run.last_seq) run.last_seq = seq;
  }

  const runs = [...runMap.values()].sort((a, b) => b.run_id.localeCompare(a.run_id));

  return Response.json({ runs }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
