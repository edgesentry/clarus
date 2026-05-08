/**
 * GET /api/audit-summary?site=<site_id>
 * Returns a per-run summary derived from key structure — no records read.
 *
 * Key format: chains/{site_id}/{run_id}/{sequence:020}.json  (current)
 * Legacy:     chains/{site_id}/{sequence:020}.json
 *
 * Returns:
 * {
 *   sites: string[],
 *   runs: [{ site_id, run_id, record_count, first_seq, last_seq, last_seq, run_ts_ms }]
 * }
 * Runs are sorted newest-first (descending run_ts_ms / run_id).
 */
export async function onRequestGet({ env, request }) {
  const site = new URL(request.url).searchParams.get("site");
  const prefix = site ? `chains/${site}/` : "chains/";

  const listed = await env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix, limit: 1000 });

  // Group records by (site_id, run_id)
  const runs = {};
  for (const obj of listed.objects) {
    const parts = obj.key.split("/");
    // parts: ["chains", site_id, run_id, seq.json]  (current)
    // parts: ["chains", site_id, seq.json]           (legacy)
    if (parts.length < 3) continue;
    const site_id = parts[1];
    const isNew   = parts.length >= 4;
    const run_id  = isNew ? parts[2] : "legacy";
    const seqStr  = isNew ? parts[3] : parts[2];
    const seq     = parseInt(seqStr, 10);

    const key = `${site_id}__${run_id}`;
    if (!runs[key]) {
      runs[key] = { site_id, run_id, first_seq: seq, last_seq: seq, record_count: 0 };
    }
    runs[key].record_count++;
    if (seq < runs[key].first_seq) runs[key].first_seq = seq;
    if (seq > runs[key].last_seq)  runs[key].last_seq  = seq;
  }

  const runList = Object.values(runs).map((r) => ({
    ...r,
    run_ts_ms: r.run_id === "legacy" ? 0 : parseInt(r.run_id, 10) || 0,
  })).sort((a, b) => b.run_ts_ms - a.run_ts_ms);

  const sites = [...new Set(runList.map((r) => r.site_id))].sort();

  return Response.json(
    { sites, runs: runList },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
