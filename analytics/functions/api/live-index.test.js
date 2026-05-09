import { describe, it, expect, vi, beforeEach } from "vitest";
import { onRequestGet } from "./live-index.js";

// live-index.js lists rollup/ and live/ in parallel
function makeEnv({ rollupKeys = [], liveKeys = [] } = {}) {
  return {
    CLARUS_DEV_PUBLIC_RAW: {
      list: vi.fn(async ({ prefix }) => ({
        objects: (prefix.startsWith("rollup/") ? rollupKeys : liveKeys).map(key => ({ key })),
      })),
    },
  };
}

function makeCache(hit = null) {
  return { default: { match: vi.fn(async () => hit), put: vi.fn(async () => {}) } };
}

function makeWaitUntil() { return vi.fn(p => p); }

beforeEach(() => { vi.stubGlobal("caches", makeCache()); });

describe("live-index: categorisation", () => {
  it("splits live keys into heartbeats, alerts, and sites", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      liveKeys: [
        `live/SITE-A/heartbeats/${Date.now()}.parquet`,
        `live/SITE-A/audit_chain/${Date.now() + 1}.parquet`,
        `live/SITE-B/heartbeats/${Date.now() + 2}.parquet`,
      ],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/live-index"), waitUntil: makeWaitUntil() });
    const body = await res.json();
    expect(body.heartbeats).toHaveLength(2);
    expect(body.alerts).toHaveLength(1);
    expect(body.sites).toEqual(expect.arrayContaining(["SITE-A", "SITE-B"]));
  });

  it("ignores keys that are not parquet files", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      liveKeys: [
        `live/SITE-A/heartbeats/${Date.now()}.json`,
        `live/SITE-A/heartbeats/${Date.now() + 1}.parquet`,
      ],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/live-index"), waitUntil: makeWaitUntil() });
    const body = await res.json();
    expect(body.heartbeats).toHaveLength(1);
  });

  it("prefers rollup files when available", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv({
      rollupKeys: ["rollup/SITE-A/heartbeats.parquet"],
      liveKeys:   ["live/SITE-A/heartbeats/1778341730000.parquet"],
    });
    const res = await onRequestGet({ env, request: new Request("https://x/api/live-index"), waitUntil: makeWaitUntil() });
    const body = await res.json();
    // rollup file should be used; raw live file excluded for this site
    expect(body.heartbeats).toContain("rollup/SITE-A/heartbeats.parquet");
    expect(body.heartbeats).not.toContain("live/SITE-A/heartbeats/1778341730000.parquet");
  });
});

describe("live-index: caching", () => {
  it("returns cached response without calling R2", async () => {
    const hit = Response.json({ heartbeats: [], alerts: [], sites: ["cached"] });
    vi.stubGlobal("caches", makeCache(hit));
    const env = makeEnv();
    const res = await onRequestGet({ env, request: new Request("https://x/api/live-index"), waitUntil: makeWaitUntil() });
    const body = await res.json();
    expect(env.CLARUS_DEV_PUBLIC_RAW.list).not.toHaveBeenCalled();
    expect(body.sites).toEqual(["cached"]);
  });

  it("stores response in cache on miss", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", cache);
    const env = makeEnv({ liveKeys: ["live/SITE-A/heartbeats/1778341730000.parquet"] });
    const waitUntil = makeWaitUntil();
    await onRequestGet({ env, request: new Request("https://x/api/live-index"), waitUntil });
    expect(cache.default.put).toHaveBeenCalled();
  });

  it("sets Cache-Control header on response", async () => {
    vi.stubGlobal("caches", makeCache());
    const res = await onRequestGet({ env: makeEnv(), request: new Request("https://x/api/live-index"), waitUntil: makeWaitUntil() });
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage/);
  });
});
