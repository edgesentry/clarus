import { describe, it, expect, vi } from "vitest";
import { blake3 } from "@noble/hashes/blake3.js";
import { onRequestGet } from "./verify-raw.js";
import type { AuditRecord, Env, R2BucketMinimal } from "./_zk-types.js";

function b64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function makeRecord(seq: number): AuditRecord {
  const att  = { site_id: "MCH-OUTLET-042", cert_level: "gold" as const, all_criteria_pass: true,
                 cop_pass: true, lpd_pass: true, eui_kwh_m2: 105.0,
                 period_start_ms: 1_000_000, period_end_ms: 2_000_000 };
  const json     = JSON.stringify(att);
  const pubBytes = new TextEncoder().encode(json);
  return {
    sequence:        seq,
    timestamp_ms:    1_778_000_000_000,
    record_hash_hex: "b".repeat(64),
    zk_proof: {
      framework:     "mock",
      program_id:    "bca-green-mark-2021-v1-mock",
      proof_bytes:   b64Encode(blake3(pubBytes)),
      public_values: btoa(json),
    },
  };
}

function makeEnv(ptrBody: { run_id: string; last_seq: number } | null, auditObjects: Record<string, AuditRecord>): Env {
  return {
    CLARUS_DEV_PUBLIC_RAW: {
      get: vi.fn(async (key: string) => {
        if ((key.startsWith("compliance-latest/") || key.startsWith("zkp-latest/")) && ptrBody) {
          return { text: async () => JSON.stringify(ptrBody) };
        }
        return null;
      }),
    } as unknown as R2BucketMinimal,
    CLARUS_DEV_PUBLIC_AUDIT: {
      get: vi.fn(async (key: string) => {
        const r = auditObjects[key];
        return r ? { text: async () => JSON.stringify(r) } : null;
      }),
      list: vi.fn(async () => ({ objects: [] })),
    } as unknown as R2BucketMinimal,
    CLARUS_DEV_PUBLIC_ANALYTICS: {} as unknown as R2BucketMinimal,
  };
}

describe("GET /api/verify/raw", () => {
  it("returns raw proof envelope", async () => {
    const key = "chains/MCH-OUTLET-042/1000/00000000000000000000.json";
    const env = makeEnv({ run_id: "1000", last_seq: 0 }, { [key]: makeRecord(0) });

    const body = await (await onRequestGet({
      request: new Request("https://clarus.edgesentry.io/api/verify/raw?site=MCH-OUTLET-042"),
      env,
    })) .json() as Record<string, unknown>;

    expect(body.framework).toBe("mock");
    expect(body.program_id).toBe("bca-green-mark-2021-v1-mock");
    expect(body.proof_bytes).toBeTruthy();
    expect(body.public_values).toBeTruthy();
    expect(body.record_hash).toBe("b".repeat(64));
    expect(body.attested_at_ms).toBe(1_778_000_000_000);
    expect(body.fetched_at_ms).toBeGreaterThan(0);
  });

  it("returns 404 when no record exists", async () => {
    const env = makeEnv(null, {});
    (env.CLARUS_DEV_PUBLIC_AUDIT as any).list = vi.fn(async () => ({ objects: [] }));
    const res = await onRequestGet({
      request: new Request("https://clarus.edgesentry.io/api/verify/raw?site=NO-SITE"),
      env,
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when site param is missing", async () => {
    const env = makeEnv(null, {});
    const res = await onRequestGet({
      request: new Request("https://clarus.edgesentry.io/api/verify/raw"),
      env,
    });
    expect(res.status).toBe(400);
  });

  it("sets CORS header", async () => {
    const env = makeEnv(null, {});
    (env.CLARUS_DEV_PUBLIC_AUDIT as any).list = vi.fn(async () => ({ objects: [] }));
    const res = await onRequestGet({
      request: new Request("https://clarus.edgesentry.io/api/verify/raw?site=SITE-A"),
      env,
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
