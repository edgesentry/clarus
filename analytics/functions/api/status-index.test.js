import { describe, it, expect, vi, beforeEach } from "vitest";
import { onRequestGet } from "./status-index.js";

function makeEnv({ rawKeys = [], auditKeys = [] } = {}) {
  return {
    CLARUS_DEV_PUBLIC_RAW: {
      list: vi.fn(async () => ({ objects: rawKeys.map(key => ({ key })) })),
    },
    CLARUS_DEV_PUBLIC_AUDIT: {
      list: vi.fn(async () => ({ objects: auditKeys.map(key => ({ key })) })),
    },
  };
}

function makeCache(hit = null) {
  return { default: { match: vi.fn(async () => hit), put: vi.fn(async () => {}) } };
}

function makeCtx() {
  // Pages Functions receive waitUntil directly on context, not via a ctx object
  return { waitUntil: vi.fn(p => p) };
}

beforeEach(() => {
  vi.stubGlobal("caches", makeCache());
});

describe("status-index: aggregation", () => {
  it("counts heartbeat and audit_chain files per site", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      rawKeys: [
        "live/SITE-A/heartbeats/1000.parquet",
        "live/SITE-A/heartbeats/1001.parquet",
        "live/SITE-A/audit_chain/1002.parquet",
      ],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/status-index"), waitUntil: makeCtx().waitUntil });
    const { sites } = await res.json();
    const a = sites.find(s => s.site_id === "SITE-A");
    expect(a.raw.hb_files).toBe(2);
    expect(a.raw.chain_files).toBe(1);
  });

  it("groups WORM audit records by run_id", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      auditKeys: [
        "chains/SITE-A/1778000000000/00000000000000000000.json",
        "chains/SITE-A/1778000000000/00000000000000000001.json",
        "chains/SITE-A/1778999999999/00000000000000000000.json",
      ],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/status-index"), waitUntil: makeCtx().waitUntil });
    const { sites } = await res.json();
    const a = sites.find(s => s.site_id === "SITE-A");
    expect(a.worm.total).toBe(3);
    expect(a.worm.runs).toHaveLength(2);
    // newest run first
    expect(a.worm.runs[0].run_id).toBe("1778999999999");
  });

  it("handles legacy keys (no run_id segment)", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      auditKeys: [
        "chains/SITE-A/00000000000000000000.json",
        "chains/SITE-A/00000000000000000001.json",
      ],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/status-index"), waitUntil: makeCtx().waitUntil });
    const { sites } = await res.json();
    const a = sites.find(s => s.site_id === "SITE-A");
    expect(a.worm.runs[0].run_id).toBe("legacy");
    expect(a.worm.total).toBe(2);
  });

  it("merges raw-only and worm-only sites into one list", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      rawKeys:   ["live/RAW-ONLY/heartbeats/1000.parquet"],
      auditKeys: ["chains/WORM-ONLY/1000/00000000000000000000.json"],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/status-index"), waitUntil: makeCtx().waitUntil });
    const { sites } = await res.json();
    const ids = sites.map(s => s.site_id);
    expect(ids).toContain("RAW-ONLY");
    expect(ids).toContain("WORM-ONLY");
  });
});

describe("status-index: caching", () => {
  it("returns cached response without calling R2", async () => {
    const hit = Response.json({ sites: [{ site_id: "CACHED" }], generated_at_ms: 0 });
    vi.stubGlobal("caches", makeCache(hit));
    const env = makeEnv();
    const res = await onRequestGet({ env, request: new Request("https://x/api/status-index"), waitUntil: makeCtx().waitUntil });
    const { sites } = await res.json();

    expect(env.CLARUS_DEV_PUBLIC_RAW.list).not.toHaveBeenCalled();
    expect(sites[0].site_id).toBe("CACHED");
  });

  it("stores response in cache on miss", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", cache);
    const { waitUntil } = makeCtx();
    await onRequestGet({ env: makeEnv(), request: new Request("https://x/api/status-index"), waitUntil });
    expect(cache.default.put).toHaveBeenCalled();
  });
});
