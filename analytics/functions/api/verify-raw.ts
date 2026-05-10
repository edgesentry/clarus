/**
 * GET /api/verify/raw?site=<site_id>
 *
 * Layer 2 verifier — machine / B2B.
 * Returns the raw ZkProof envelope for independent client-side verification.
 */

import type { Env } from "./_zk-types.js";
import { fetchLatestZkRecord } from "./_zk-fetch.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } as const;

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const site = new URL(request.url).searchParams.get("site");
  if (!site) {
    return Response.json({ error: "site parameter required" }, { status: 400, headers: CORS });
  }

  const record = await fetchLatestZkRecord(site, env);
  if (!record) {
    return Response.json({ error: "no_zkp_record", site_id: site }, { status: 404, headers: CORS });
  }

  const proof = record.zk_proof!;

  return Response.json({
    site_id:        site,
    framework:      proof.framework,
    program_id:     proof.program_id,
    proof_bytes:    proof.proof_bytes,
    public_values:  proof.public_values,
    record_hash:    record.record_hash_hex ?? null,
    attested_at_ms: record.timestamp_ms,
    fetched_at_ms:  Date.now(),
  }, { headers: CORS });
}
