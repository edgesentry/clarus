/**
 * GET /api/verify/raw?site=<site_id>
 *
 * Layer 2 verifier — machine / B2B.
 * Returns the raw ZkProof envelope for independent client-side verification.
 *
 * Response:
 * {
 *   site_id, framework, program_id,
 *   proof_bytes,   // base64 — BLAKE3(public_values) for mock; Groth16 for SP1
 *   public_values, // base64 JSON — GreenMarkAttestation
 *   record_hash, attested_at_ms, fetched_at_ms
 * }
 */

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

async function fetchLatestZkRecord(siteId, env) {
  const ptr = await env.CLARUS_DEV_PUBLIC_RAW.get(`zkp-latest/${siteId}.json`);
  if (ptr) {
    const { run_id, last_seq } = JSON.parse(await ptr.text());
    if (run_id != null && last_seq != null) {
      const start = Math.max(0, last_seq - 9);
      for (let seq = last_seq; seq >= start; seq--) {
        const key = `chains/${siteId}/${run_id}/${String(seq).padStart(20, "0")}.json`;
        const obj = await env.CLARUS_DEV_PUBLIC_AUDIT.get(key);
        if (!obj) continue;
        const record = JSON.parse(await obj.text());
        if (record.zk_proof) return record;
      }
    }
  }

  const listed = await env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix: `chains/${siteId}/`, limit: 1000 });
  if (!listed.objects.length) return null;

  const runMap = new Map();
  for (const obj of listed.objects) {
    const parts = obj.key.split("/");
    if (parts.length < 4) continue;
    const runId = parts[2];
    const seq   = parseInt(parts[3], 10);
    if (!runMap.has(runId) || seq > runMap.get(runId).last_seq) {
      runMap.set(runId, { run_id: runId, last_seq: seq });
    }
  }
  if (!runMap.size) return null;

  const [newestRun] = [...runMap.values()].sort((a, b) => b.run_id.localeCompare(a.run_id));
  const start = Math.max(0, newestRun.last_seq - 9);
  for (let seq = newestRun.last_seq; seq >= start; seq--) {
    const key = `chains/${siteId}/${newestRun.run_id}/${String(seq).padStart(20, "0")}.json`;
    const obj = await env.CLARUS_DEV_PUBLIC_AUDIT.get(key);
    if (!obj) continue;
    const record = JSON.parse(await obj.text());
    if (record.zk_proof) return record;
  }

  return null;
}

export async function onRequestGet({ request, env }) {
  const site = new URL(request.url).searchParams.get("site");
  if (!site) {
    return Response.json({ error: "site parameter required" }, { status: 400, headers: CORS });
  }

  const record = await fetchLatestZkRecord(site, env);
  if (!record) {
    return Response.json({ error: "no_zkp_record", site_id: site }, { status: 404, headers: CORS });
  }

  const proof = record.zk_proof;

  return Response.json({
    site_id:       site,
    framework:     proof.framework,
    program_id:    proof.program_id,
    proof_bytes:   proof.proof_bytes,
    public_values: proof.public_values,
    record_hash:   record.record_hash_hex ?? null,
    attested_at_ms: record.timestamp_ms,
    fetched_at_ms:  Date.now(),
  }, { headers: CORS });
}
