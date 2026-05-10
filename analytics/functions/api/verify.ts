/**
 * GET /api/verify?site=<site_id>
 *
 * Layer 1 verifier — human and machine readable.
 * Returns the decoded GreenMarkAttestation with BLAKE3 proof validity.
 *
 * Mock framework: proof_bytes = BLAKE3(public_values_bytes) — verified server-side.
 * SP1/RISC Zero:  proof_verified: null — pending ZK verifier integration.
 */

import { blake3 } from "@noble/hashes/blake3.js";
import type { GreenMarkAttestation, ZkProof, Env } from "./_zk-types.js";
import { fetchLatestZkRecord } from "./_zk-fetch.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } as const;

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function arrEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function verifyProof(proof: ZkProof): boolean | null {
  if (proof.framework === "mock") {
    try {
      const pubValBytes = b64Decode(proof.public_values);
      return arrEqual(blake3(pubValBytes), b64Decode(proof.proof_bytes));
    } catch {
      return false;
    }
  }
  return null; // SP1 / RISC Zero: pending verifier integration
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const site = new URL(request.url).searchParams.get("site");
  if (!site) {
    return Response.json({ error: "site parameter required" }, { status: 400, headers: CORS });
  }

  const record = await fetchLatestZkRecord(site, env);
  if (!record) {
    return Response.json({ valid: false, site_id: site, reason: "no_zkp_record" }, { status: 404, headers: CORS });
  }

  const proof = record.zk_proof!;
  let att: GreenMarkAttestation;
  try {
    att = JSON.parse(atob(proof.public_values)) as GreenMarkAttestation;
  } catch {
    return Response.json({ valid: false, site_id: site, reason: "public_values_decode_failed" }, { headers: CORS });
  }

  const proofValid = verifyProof(proof);
  if (proofValid === false) {
    return Response.json({
      valid:       false,
      site_id:     site,
      reason:      "proof_bytes_do_not_match_public_values",
      framework:   proof.framework,
      program_id:  proof.program_id,
      record_hash: record.record_hash_hex ?? null,
    }, { headers: CORS });
  }

  return Response.json({
    valid:             true,
    site_id:           att.site_id,
    cert_level:        att.cert_level,
    all_criteria_pass: att.all_criteria_pass,
    cop_pass:          att.cop_pass,
    lpd_pass:          att.lpd_pass,
    eui_kwh_m2:        att.eui_kwh_m2,
    framework:         proof.framework,
    program_id:        proof.program_id,
    proof_verified:    proofValid, // null = SP1/RISC Zero, not yet verifiable server-side
    attested_at_ms:    record.timestamp_ms,
    record_hash:       record.record_hash_hex ?? null,
    verify_url:        `${new URL(request.url).origin}/api/verify?site=${encodeURIComponent(site)}`,
  }, { headers: CORS });
}
