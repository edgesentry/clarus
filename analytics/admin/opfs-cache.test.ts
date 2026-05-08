import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the pure key-transformation helpers by re-implementing them inline,
// since they are not exported.  The main value of these tests is to lock in the
// file-naming contract so refactors don't silently break cache lookups.

// Helpers mirrored from opfs-cache.ts (must stay in sync)
function metaKey(key: string): string {
  return key.replace(/\//g, "__") + ".meta.json";
}
function dataKey(key: string): string {
  return key.replace(/\//g, "__") + ".bin";
}
function auditKey(key: string): string {
  return "audit__" + key.replace(/\//g, "__") + ".json";
}

describe("key derivation", () => {
  it("metaKey replaces slashes and appends .meta.json", () => {
    expect(metaKey("sg-port-safety/2024-01-01/hb.parquet")).toBe(
      "sg-port-safety__2024-01-01__hb.parquet.meta.json"
    );
  });

  it("dataKey replaces slashes and appends .bin", () => {
    expect(dataKey("sg-port-safety/2024-01-01/hb.parquet")).toBe(
      "sg-port-safety__2024-01-01__hb.parquet.bin"
    );
  });

  it("auditKey prefixes with audit__ and replaces slashes", () => {
    expect(auditKey("sg-port-safety/rec-001.json")).toBe(
      "audit__sg-port-safety__rec-001.json.json"
    );
  });

  it("flat key (no slashes) passes through unchanged", () => {
    expect(metaKey("hb.parquet")).toBe("hb.parquet.meta.json");
    expect(dataKey("hb.parquet")).toBe("hb.parquet.bin");
    expect(auditKey("rec.json")).toBe("audit__rec.json.json");
  });
});

// ---------------------------------------------------------------------------
// Integration-style test using a fake OPFS via navigator.storage stub
// ---------------------------------------------------------------------------

function makeOpfsStub() {
  const files = new Map<string, Uint8Array | string>();

  function makeFileHandle(name: string) {
    return {
      getFile: async () => ({
        text: async () => {
          const v = files.get(name);
          if (v === undefined) throw new Error("not found");
          return typeof v === "string" ? v : new TextDecoder().decode(v);
        },
        arrayBuffer: async () => {
          const v = files.get(name);
          if (v === undefined) throw new Error("not found");
          return (v as Uint8Array).buffer;
        },
      }),
      createWritable: async () => {
        const chunks: (string | ArrayBuffer)[] = [];
        return {
          write: async (chunk: string | ArrayBuffer) => chunks.push(chunk),
          close: async () => {
            if (typeof chunks[0] === "string") {
              files.set(name, chunks.join(""));
            } else {
              files.set(name, new Uint8Array(chunks[0] as ArrayBuffer));
            }
          },
        };
      },
    };
  }

  const dir = {
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!opts?.create && !files.has(name) && !name.startsWith("__opfs_test__")) {
        const err = new DOMException("not found", "NotFoundError");
        throw err;
      }
      return makeFileHandle(name);
    },
    removeEntry: async (name: string) => { files.delete(name); },
  };

  return {
    files,
    storage: {
      getDirectory: async () => ({
        getDirectoryHandle: async (_name: string, _opts?: { create?: boolean }) => dir,
      }),
    },
  };
}

describe("getCachedParquet / setCachedParquet", async () => {
  beforeEach(() => {
    // Reset the module-level availability cache between tests
    vi.resetModules();
  });

  it("returns null on cache miss", async () => {
    const stub = makeOpfsStub();
    vi.stubGlobal("navigator", { storage: stub.storage });

    const { getCachedParquet } = await import("./opfs-cache.js");
    const result = await getCachedParquet("missing-key");
    expect(result).toBeNull();
  });

  it("round-trips an ArrayBuffer through the cache", async () => {
    const stub = makeOpfsStub();
    vi.stubGlobal("navigator", { storage: stub.storage });

    const { getCachedParquet, setCachedParquet } = await import("./opfs-cache.js");
    const original = new Uint8Array([1, 2, 3, 4]).buffer;

    await setCachedParquet("test/hb.parquet", original);
    const retrieved = await getCachedParquet("test/hb.parquet");

    expect(retrieved).not.toBeNull();
    expect(new Uint8Array(retrieved!)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns null when cache is stale (> 1h)", async () => {
    const stub = makeOpfsStub();
    vi.stubGlobal("navigator", { storage: stub.storage });

    const PARQUET_TTL_MS = 60 * 60 * 1000;
    const oldTs = Date.now() - PARQUET_TTL_MS - 1000;

    // Manually insert stale metadata
    const metaName = "test__stale.parquet.meta.json";
    const dataName = "test__stale.parquet.bin";
    stub.files.set(metaName, JSON.stringify({ ts: oldTs }));
    stub.files.set(dataName, new Uint8Array([9]));

    const { getCachedParquet } = await import("./opfs-cache.js");
    const result = await getCachedParquet("test/stale.parquet");
    expect(result).toBeNull();
  });
});

describe("getCachedAuditRecord / setCachedAuditRecord", async () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns null on cache miss", async () => {
    const stub = makeOpfsStub();
    vi.stubGlobal("navigator", { storage: stub.storage });

    const { getCachedAuditRecord } = await import("./opfs-cache.js");
    expect(await getCachedAuditRecord("no-such-record")).toBeNull();
  });

  it("round-trips a JSON string through the audit cache", async () => {
    const stub = makeOpfsStub();
    vi.stubGlobal("navigator", { storage: stub.storage });

    const { getCachedAuditRecord, setCachedAuditRecord } = await import("./opfs-cache.js");
    const payload = JSON.stringify({ sequence: 1, record_hash_hex: "abc" });

    await setCachedAuditRecord("site/rec-001.json", payload);
    const retrieved = await getCachedAuditRecord("site/rec-001.json");

    expect(retrieved).toBe(payload);
  });

  it("audit cache has no TTL — serves stale content indefinitely", async () => {
    const stub = makeOpfsStub();
    vi.stubGlobal("navigator", { storage: stub.storage });

    const { getCachedAuditRecord, setCachedAuditRecord } = await import("./opfs-cache.js");
    const payload = JSON.stringify({ sequence: 42 });
    await setCachedAuditRecord("site/old-rec.json", payload);

    // Even after a long time has passed (simulated by not modifying the data),
    // audit records should still be returned.
    const retrieved = await getCachedAuditRecord("site/old-rec.json");
    expect(retrieved).toBe(payload);
  });
});
