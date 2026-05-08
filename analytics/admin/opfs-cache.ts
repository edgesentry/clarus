/**
 * OPFS caching helpers for admin page Parquet and audit record fetches.
 *
 * Strategy:
 *   - Parquet files (heartbeats, alert chains): TTL-based cache (default 1h).
 *     Re-fetch when stale; serve from OPFS when fresh.
 *   - Audit records (WORM / Object Lock): cache indefinitely — they are
 *     immutable by design.
 *
 * Falls back to direct fetch if OPFS is unavailable (Safari Private, Firefox
 * without storage permission, etc.).
 */

const DIR_NAME = "clarus-admin-cache";
const PARQUET_TTL_MS = 60 * 60 * 1000; // 1 hour

let _opfsAvailable: boolean | null = null;

async function opfsAvailable(): Promise<boolean> {
  if (_opfsAvailable !== null) return _opfsAvailable;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR_NAME, { create: true });
    const testName = "__opfs_test__";
    const fh = await dir.getFileHandle(testName, { create: true });
    const w = await fh.createWritable();
    await w.write("1");
    await w.close();
    await dir.removeEntry(testName);
    _opfsAvailable = true;
  } catch {
    _opfsAvailable = false;
  }
  return _opfsAvailable;
}

async function cacheDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR_NAME, { create: true });
}

function metaKey(key: string): string {
  return key.replace(/\//g, "__") + ".meta.json";
}

function dataKey(key: string): string {
  return key.replace(/\//g, "__") + ".bin";
}

// ---------------------------------------------------------------------------
// Parquet cache (TTL-based)
// ---------------------------------------------------------------------------

export async function getCachedParquet(key: string): Promise<ArrayBuffer | null> {
  if (!(await opfsAvailable())) return null;
  try {
    const dir = await cacheDir();
    const metaHandle = await dir.getFileHandle(metaKey(key));
    const metaText = await (await metaHandle.getFile()).text();
    const { ts } = JSON.parse(metaText) as { ts: number };
    if (Date.now() - ts > PARQUET_TTL_MS) return null;

    const dataHandle = await dir.getFileHandle(dataKey(key));
    return (await dataHandle.getFile()).arrayBuffer();
  } catch {
    return null;
  }
}

export async function setCachedParquet(key: string, buf: ArrayBuffer): Promise<void> {
  if (!(await opfsAvailable())) return;
  try {
    const dir = await cacheDir();

    const metaHandle = await dir.getFileHandle(metaKey(key), { create: true });
    const mw = await metaHandle.createWritable();
    await mw.write(JSON.stringify({ ts: Date.now() }));
    await mw.close();

    const dataHandle = await dir.getFileHandle(dataKey(key), { create: true });
    const dw = await dataHandle.createWritable();
    await dw.write(buf);
    await dw.close();
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Audit record cache (immutable / indefinite)
// ---------------------------------------------------------------------------

export async function getCachedAuditRecord(key: string): Promise<string | null> {
  if (!(await opfsAvailable())) return null;
  try {
    const dir = await cacheDir();
    const fh = await dir.getFileHandle("audit__" + key.replace(/\//g, "__") + ".json");
    return (await fh.getFile()).text();
  } catch {
    return null;
  }
}

export async function setCachedAuditRecord(key: string, text: string): Promise<void> {
  if (!(await opfsAvailable())) return;
  try {
    const dir = await cacheDir();
    const fh = await dir.getFileHandle("audit__" + key.replace(/\//g, "__") + ".json", { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Convenience: fetch with OPFS Parquet cache
// ---------------------------------------------------------------------------

export async function fetchParquetCached(url: string, cacheKey: string): Promise<ArrayBuffer | null> {
  const cached = await getCachedParquet(cacheKey);
  if (cached) return cached;

  const resp = await fetch(url);
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  await setCachedParquet(cacheKey, buf);
  return buf;
}
