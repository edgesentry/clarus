import { describe, it, expect, vi, beforeEach } from "vitest";
import { onRequestGet } from "./audit-index.js";

function makeEnv(keys) {
  return {
    CLARUS_DEV_PUBLIC_AUDIT: {
      list: vi.fn(async () => ({ objects: keys.map(key => ({ key })) })),
    },
  };
}

function makeCache(hit = null) {
  return { default: { match: vi.fn(async () => hit), put: vi.fn(async () => {}) } };
}

function makeWaitUntil() {
  return vi.fn(p => p);
}

beforeEach(() => {
  vi.stubGlobal("caches", makeCache());
});

describe("audit-index: key listing", () => {
  it("returns all keys sorted lexicographically", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv([
      "chains/SITE-A/1000/00000000000000000002.json",
      "chains/SITE-A/1000/00000000000000000000.json",
      "chains/SITE-A/1000/00000000000000000001.json",
    ]);
    const res = await onRequestGet({ env, request: new Request("https://x/api/audit-index"), waitUntil: makeWaitUntil() });
    const body = await res.json();
    expect(body.keys[0]).toContain("00000000000000000000.json");
    expect(body.keys[2]).toContain("00000000000000000002.json");
  });

  it("filters by site when ?site= is provided", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv(["chains/SITE-A/1000/00000000000000000000.json"]);
    await onRequestGet({ env, request: new Request("https://x/api/audit-index?site=SITE-A"), waitUntil: makeWaitUntil() });
    const [{ prefix }] = env.CLARUS_DEV_PUBLIC_AUDIT.list.mock.calls[0];
    expect(prefix).toBe("chains/SITE-A/");
  });

  it("extracts unique site IDs from keys", async () => {
    vi.stubGlobal("caches", makeCache());
    const env = makeEnv([
      "chains/SITE-A/1000/00000000000000000000.json",
      "chains/SITE-B/1000/00000000000000000000.json",
      "chains/SITE-A/1000/00000000000000000001.json",
    ]);
    const res = await onRequestGet({ env, request: new Request("https://x/api/audit-index"), waitUntil: makeWaitUntil() });
    const { sites } = await res.json();
    expect(sites).toHaveLength(2);
    expect(sites).toEqual(expect.arrayContaining(["SITE-A", "SITE-B"]));
  });
});

describe("audit-index: caching", () => {
  it("returns cached response without calling R2", async () => {
    const hit = Response.json({ keys: ["cached"], sites: ["X"] });
    vi.stubGlobal("caches", makeCache(hit));
    const env = makeEnv([]);
    const res = await onRequestGet({ env, request: new Request("https://x/api/audit-index"), waitUntil: makeWaitUntil() });
    const { keys } = await res.json();
    expect(env.CLARUS_DEV_PUBLIC_AUDIT.list).not.toHaveBeenCalled();
    expect(keys).toEqual(["cached"]);
  });

  it("stores response in cache on miss", async () => {
    const cache = makeCache();
    vi.stubGlobal("caches", cache);
    const waitUntil = makeWaitUntil();
    await onRequestGet({ env: makeEnv([]), request: new Request("https://x/api/audit-index"), waitUntil });
    expect(cache.default.put).toHaveBeenCalled();
  });
});
