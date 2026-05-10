import { describe, it, expect, vi } from "vitest";
import { blake3 } from "@noble/hashes/blake3.js";
import { onRequestGet } from "./verify.js";
import type { GreenMarkAttestation, ZkProof, AuditRecord, Env, R2BucketMinimal } from "./_zk-types.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function b64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function makeAttestation(overrides: Partial<GreenMarkAttestation> = {}): GreenMarkAttestation {
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

function makeProof(att: GreenMarkAttestation, tamper = false): ZkProof {
  const json     = JSON.stringify(att);
  const pubBytes = new TextEncoder().encode(json);
  const hash     = tamper ? new Uint8Array(32).fill(0xde) : blake3(pubBytes);
  return {
    framework:     "mock",
    program_id:    "bca-green-mark-2021-v1-mock",
    proof_bytes:   b64Encode(hash),
    public_values: btoa(json),
  };
}

function makeRecord(seq: number, att?: GreenMarkAttestation, tamper = false): AuditRecord {
  return {
    sequence:        seq,
    timestamp_ms:    1_778_000_000_000 + seq * 1000,
    record_hash_hex: "a".repeat(64),
    ...(att ? { zk_proof: makeProof(att, tamper) } : {}),
  };
}

function makeEnv(
  ptrBody: { run_id: string; last_seq: number } | null,
  auditObjects: Record<string, AuditRecord>,
): Env {
  return {
    CLARUS_DEV_PUBLIC_RAW: {
      get: vi.fn(async (key: string) => {
        if (key.startsWith("zkp-latest/") && ptrBody) {
          return { text: async () => JSON.stringify(ptrBody) };
        }
        return null;
      }),
    } as unknown as R2BucketMinimal,
    CLARUS_DEV_PUBLIC_AUDIT: {
      get: vi.fn(async (key: string) => {
        const record = auditObjects[key];
        if (!record) return null;
        return { text: async () => JSON.stringify(record) };
      }),
      list: vi.fn(async () => ({ objects: [] })),
    } as unknown as R2BucketMinimal,
    CLARUS_DEV_PUBLIC_ANALYTICS: {} as unknown as R2BucketMinimal,
  };
}

function req(site: string) {
  return new Request(`https://clarus.edgesentry.io/api/verify?site=${encodeURIComponent(site)}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/verify", () => {
  it("returns valid:true for a Gold attestation with correct mock proof", async () => {
    const att = makeAttestation({ cert_level: "gold", all_criteria_pass: true });
    const key = "chains/MCH-OUTLET-042/1000/00000000000000000005.json";
    const env = makeEnv({ run_id: "1000", last_seq: 5 }, { [key]: makeRecord(5, att) });

    const body = await (await onRequestGet({ request: req("MCH-OUTLET-042"), env })) .json() as Record<string, unknown>;

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

    const body = await (await onRequestGet({ request: req("SITE-PLAT"), env })) .json() as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.cert_level).toBe("platinum");
  });

  it("returns valid:true for a not_certified attestation (Q2 — valid proof, fails BCA)", async () => {
    const att = makeAttestation({ cert_level: "not_certified", all_criteria_pass: false, eui_kwh_m2: 155.0 });
    const key = "chains/BLD-HIGHUSE-FAIL/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: makeRecord(0, att) });

    const body = await (await onRequestGet({ request: req("BLD-HIGHUSE-FAIL"), env })) .json() as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.cert_level).toBe("not_certified");
    expect(body.all_criteria_pass).toBe(false);
  });

  it("returns valid:false for a tampered proof (Q3/Q4)", async () => {
    const att = makeAttestation({ cert_level: "gold_plus", all_criteria_pass: true });
    const key = "chains/BLD-TAMPER-PASS/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: makeRecord(0, att, true) });

    const body = await (await onRequestGet({ request: req("BLD-TAMPER-PASS"), env })) .json() as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.reason).toBe("proof_bytes_do_not_match_public_values");
  });

  it("returns 404 when no ZKP record exists", async () => {
    const env = makeEnv(null, {});
    (env.CLARUS_DEV_PUBLIC_AUDIT as any).list = vi.fn(async () => ({ objects: [] }));

    const res = await onRequestGet({ request: req("NO-SUCH-SITE"), env });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
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
    const env = makeEnv(
      { run_id: "1000", last_seq: 5 },
      {
        "chains/SITE-A/1000/00000000000000000005.json": makeRecord(5),
        "chains/SITE-A/1000/00000000000000000004.json": makeRecord(4, att),
      },
    );

    const body = await (await onRequestGet({ request: req("SITE-A"), env })) .json() as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.cert_level).toBe("certified");
  });

  it("sets CORS header", async () => {
    const env = makeEnv(null, {});
    (env.CLARUS_DEV_PUBLIC_AUDIT as any).list = vi.fn(async () => ({ objects: [] }));
    const res = await onRequestGet({ request: req("SITE-A"), env });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes attested_at_ms from record timestamp", async () => {
    const ts  = 1_778_000_042_000;
    const att = makeAttestation();
    const key = "chains/SITE-A/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: { ...makeRecord(0, att), timestamp_ms: ts } });

    const body = await (await onRequestGet({ request: req("SITE-A"), env })) .json() as Record<string, unknown>;
    expect(body.attested_at_ms).toBe(ts);
  });
});
