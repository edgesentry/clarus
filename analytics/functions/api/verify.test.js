import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { blake3 } from "@noble/hashes/blake3.js";
import { onRequestGet } from "./verify.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function b64Encode(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function makeAttestation(overrides = {}) {
  return {
    site_id:           "MCH-OUTLET-042",
    eui_kwh_m2:        105.0,
    cert_level:        "gold",
    all_criteria_pass: true,
    cop_pass:          true,
    lpd_pass:          true,
    period_start_ms:   1_000_000,
    period_end_ms:     2_000_000,
    ...overrides,
  };
}

function makeProof(att, tamper = false) {
  const json      = JSON.stringify(att);
  const pubBytes  = new TextEncoder().encode(json);
  const hash      = tamper ? new Uint8Array(32).fill(0xde) : blake3(pubBytes);
  return {
    framework:     "mock",
    program_id:    "bca-green-mark-2021-v1-mock",
    proof_bytes:   b64Encode(hash),
    public_values: btoa(json),
  };
}

function makeRecord(seq, att, tamper = false) {
  return {
    sequence:        seq,
    timestamp_ms:    1_778_000_000_000 + seq * 1000,
    record_hash_hex: "a".repeat(64),
    zk_proof:        att ? makeProof(att, tamper) : undefined,
  };
}

function makeEnv(ptrBody, auditObjects) {
  return {
    CLARUS_DEV_PUBLIC_RAW: {
      get: vi.fn(async (key) => {
        if (key.startsWith("zkp-latest/") && ptrBody) {
          return { text: async () => JSON.stringify(ptrBody) };
        }
        return null;
      }),
    },
    CLARUS_DEV_PUBLIC_AUDIT: {
      get: vi.fn(async (key) => {
        const record = auditObjects[key];
        if (!record) return null;
        return { text: async () => JSON.stringify(record) };
      }),
      list: vi.fn(async () => ({ objects: [] })),
    },
  };
}

function makeRequest(site) {
  return new Request(`https://clarus.edgesentry.io/api/verify?site=${encodeURIComponent(site)}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/verify", () => {
  it("returns valid:true for a Gold attestation with correct mock proof", async () => {
    const att = makeAttestation({ cert_level: "gold", all_criteria_pass: true });
    const key = "chains/MCH-OUTLET-042/1000/00000000000000000005.json";
    const env = makeEnv({ run_id: "1000", last_seq: 5 }, { [key]: makeRecord(5, att) });

    const res = await onRequestGet({ request: makeRequest("MCH-OUTLET-042"), env });
    const body = await res.json();

    expect(body.valid).toBe(true);
    expect(body.cert_level).toBe("gold");
    expect(body.all_criteria_pass).toBe(true);
    expect(body.proof_verified).toBe(true);
    expect(body.record_hash).toBe("a".repeat(64));
    expect(body.verify_url).toContain("/api/verify?site=MCH-OUTLET-042");
  });

  it("returns valid:true for a Platinum attestation", async () => {
    const att = makeAttestation({ cert_level: "platinum", eui_kwh_m2: 70.0 });
    const key = "chains/SITE-PLAT/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: makeRecord(0, att) });

    const res = await onRequestGet({ request: makeRequest("SITE-PLAT"), env });
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.cert_level).toBe("platinum");
  });

  it("returns valid:true for a not_certified attestation (Q2 — valid proof, fails BCA)", async () => {
    const att = makeAttestation({ cert_level: "not_certified", all_criteria_pass: false, eui_kwh_m2: 155.0 });
    const key = "chains/BLD-HIGHUSE-FAIL/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: makeRecord(0, att) });

    const res = await onRequestGet({ request: makeRequest("BLD-HIGHUSE-FAIL"), env });
    const body = await res.json();
    expect(body.valid).toBe(true);      // proof is structurally valid
    expect(body.cert_level).toBe("not_certified");
    expect(body.all_criteria_pass).toBe(false);
  });

  it("returns valid:false for a tampered proof (Q3/Q4)", async () => {
    const att = makeAttestation({ cert_level: "gold_plus", all_criteria_pass: true });
    const key = "chains/BLD-TAMPER-PASS/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: makeRecord(0, att, true) });

    const res = await onRequestGet({ request: makeRequest("BLD-TAMPER-PASS"), env });
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe("proof_bytes_do_not_match_public_values");
  });

  it("returns 404 when no ZKP record exists", async () => {
    const env = makeEnv(null, {});
    env.CLARUS_DEV_PUBLIC_AUDIT.list = vi.fn(async () => ({ objects: [] }));

    const res = await onRequestGet({ request: makeRequest("NO-SUCH-SITE"), env });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe("no_zkp_record");
  });

  it("returns 400 when site param is missing", async () => {
    const env = makeEnv(null, {});
    const res = await onRequestGet({ request: new Request("https://clarus.edgesentry.io/api/verify"), env });
    expect(res.status).toBe(400);
  });

  it("scans backwards to find zk_proof in earlier record", async () => {
    const att = makeAttestation({ cert_level: "certified" });
    const key4 = "chains/SITE-A/1000/00000000000000000004.json";
    const key5 = "chains/SITE-A/1000/00000000000000000005.json";
    const env = makeEnv(
      { run_id: "1000", last_seq: 5 },
      {
        [key5]: makeRecord(5),         // no zk_proof
        [key4]: makeRecord(4, att),    // has zk_proof
      }
    );

    const res = await onRequestGet({ request: makeRequest("SITE-A"), env });
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.cert_level).toBe("certified");
  });

  it("sets CORS header", async () => {
    const env = makeEnv(null, {});
    env.CLARUS_DEV_PUBLIC_AUDIT.list = vi.fn(async () => ({ objects: [] }));
    const res = await onRequestGet({ request: makeRequest("SITE-A"), env });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes attested_at_ms from record timestamp", async () => {
    const att = makeAttestation();
    const ts  = 1_778_000_042_000;
    const key = "chains/SITE-A/1000/00000000000000000000.json";
    const record = { ...makeRecord(0, att), timestamp_ms: ts };
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: record });

    const res = await onRequestGet({ request: makeRequest("SITE-A"), env });
    const body = await res.json();
    expect(body.attested_at_ms).toBe(ts);
  });
});
