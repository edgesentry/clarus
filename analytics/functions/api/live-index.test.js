import { describe, it, expect, vi, beforeEach } from "vitest";
import { onRequestGet } from "./live-index.js";

function makeEnv(keys) {
  return {
    CLARUS_DEV_PUBLIC_RAW: {
      list: vi.fn(async () => ({ objects: keys.map(key => ({ key })) })),
    },
  };
}

function makeCache(hit = null) {
  return {
    default: {
      match: vi.fn(async () => hit),
      put: vi.fn(async () => {}),
    },
  };
}

function makeCtx() {
  return { waitUntil: vi.fn(p => p) };
}

beforeEach(() => {
  vi.stubGlobal("caches", makeCache());
});

describe("live-index: categorisation", () => {
  it("splits keys into heartbeats, alerts, and sites", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv([
      "live/SITE-A/heartbeats/1000.parquet",
      "live/SITE-A/audit_chain/1001.parquet",
      "live/SITE-B/heartbeats/1002.parquet",
    ]);
    const req = new Request("https://clarus.edgesentry.io/api/live-index");
    const res = await onRequestGet({ env, request: req, ctx: makeCtx() });
    const body = await res.json();

    expect(body.heartbeats).toHaveLength(2);
    expect(body.alerts).toHaveLength(1);
    expect(body.sites).toEqual(expect.arrayContaining(["SITE-A", "SITE-B"]));
    expect(body.sites).toHaveLength(2);
  });

  it("ignores keys that are not parquet files", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv([
      "live/SITE-A/heartbeats/1000.json",
      "live/SITE-A/heartbeats/1001.parquet",
    ]);
    const req = new Request("https://clarus.edgesentry.io/api/live-index");
    const res = await onRequestGet({ env, request: req, ctx: makeCtx() });
    const body = await res.json();
    expect(body.heartbeats).toHaveLength(1);
  });
});

describe("live-index: caching", () => {
  it("returns cached response without calling R2", async () => {
    const cachedResponse = Response.json({ heartbeats: [], alerts: [], sites: ["cached"] });
    vi.stubGlobal("caches", makeCache(cachedResponse));
    const env = makeEnv([]);
    const req = new Request("https://clarus.edgesentry.io/api/live-index");
    const res = await onRequestGet({ env, request: req, ctx: makeCtx() });
    const body = await res.json();

    expect(env.CLARUS_DEV_PUBLIC_RAW.list).not.toHaveBeenCalled();
    expect(body.sites).toEqual(["cached"]);
  });

  it("stores response in cache on miss", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", cache);
    const env = makeEnv(["live/SITE-A/heartbeats/1000.parquet"]);
    const ctx = makeCtx();
    const req = new Request("https://clarus.edgesentry.io/api/live-index");
    await onRequestGet({ env, request: req, ctx });

    expect(ctx.waitUntil).toHaveBeenCalled();
    expect(cache.default.put).toHaveBeenCalled();
  });

  it("sets Cache-Control header on response", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv([]);
    const req = new Request("https://clarus.edgesentry.io/api/live-index");
    const res = await onRequestGet({ env, request: req, ctx: makeCtx() });
    expect(res.headers.get("Cache-Control")).toMatch(/s-maxage/);
  });
});
