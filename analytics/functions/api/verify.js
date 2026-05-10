/**
 * GET /api/verify?site=<site_id>
 *
 * Layer 1 verifier — human and machine readable.
 * Returns the decoded GreenMarkAttestation with proof validity.
 *
 * Mock framework: proof_bytes = BLAKE3(public_values_bytes)
 * SP1/RISC Zero:  returns verified: null (pending ZK verifier integration)
 *
 * Response (valid):
 * {
 *   valid: true,
 *   site_id, cert_level, all_criteria_pass, cop_pass, lpd_pass,
 *   eui_kwh_m2, framework, program_id, attested_at_ms, record_hash,
 *   verify_url
 * }
 *
 * Response (invalid / tampered):
 * { valid: false, site_id, reason }
 */

import { blake3 } from "@noble/hashes/blake3.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function b64Decode(s) {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function arrEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function verifyProof(proof) {
  if (proof.framework === "mock") {
    try {
      const pubValBytes = b64Decode(proof.public_values);
      const expected    = blake3(pubValBytes);
      const actual      = b64Decode(proof.proof_bytes);
      return arrEqual(expected, actual);
    } catch {
      return false;
    }
  }
  // SP1 / RISC Zero: full ZK verification pending — return null (unverified)
  return null;
}

async function fetchLatestZkRecord(siteId, env) {
  // 1. Try zkp-latest pointer (strongly consistent, written on each proof cycle)
  const ptr = await env.CLARUS_DEV_PUBLIC_RAW.get(`zkp-latest/${siteId}.json`);
  if (ptr) {
    const { run_id, last_seq } = JSON.parse(await ptr.text());
    if (run_id != null && last_seq != null) {
      // Scan last 10 records for one with zk_proof
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

  // 2. Fallback: list audit chain keys and find newest run
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
    return Response.json({ valid: false, site_id: site, reason: "no_zkp_record" }, { status: 404, headers: CORS });
  }

  const proof = record.zk_proof;
  let att;
  try {
    att = JSON.parse(atob(proof.public_values));
  } catch {
    return Response.json({ valid: false, site_id: site, reason: "public_values_decode_failed" }, { status: 200, headers: CORS });
  }

  const proofValid = verifyProof(proof);
  if (proofValid === false) {
    return Response.json(
      { valid: false, site_id: site, reason: "proof_bytes_do_not_match_public_values",
        framework: proof.framework, program_id: proof.program_id, record_hash: record.record_hash_hex ?? null },
      { status: 200, headers: CORS }
    );
  }

  const verifyUrl = `${new URL(request.url).origin}/api/verify?site=${encodeURIComponent(site)}`;

  return Response.json({
    valid:             true,
    site_id:           att.site_id ?? site,
    cert_level:        att.cert_level,
    all_criteria_pass: att.all_criteria_pass,
    cop_pass:          att.cop_pass,
    lpd_pass:          att.lpd_pass,
    eui_kwh_m2:        att.eui_kwh_m2,
    framework:         proof.framework,
    program_id:        proof.program_id,
    // null = SP1/RISC Zero proof present but not yet verifiable server-side
    proof_verified:    proofValid,
    attested_at_ms:    record.timestamp_ms,
    record_hash:       record.record_hash_hex ?? null,
    verify_url:        verifyUrl,
  }, { headers: CORS });
}
