import type { AuditRecord, Env, R2BucketMinimal } from "./_zk-types.js";

interface RunEntry { run_id: string; last_seq: number }

/**
 * Fetch the most recent audit record containing a zk_proof for the given site.
 *
 * Strategy:
 * 1. Read zkp-latest/{site}.json pointer (written on each proof cycle, strongly consistent).
 * 2. Fallback: scan audit chain key listing for the newest run.
 *
 * Scans at most 10 records from the tail of the newest run.
 */
export async function fetchLatestZkRecord(siteId: string, env: Env): Promise<AuditRecord | null> {
  const ptr = await env.CLARUS_DEV_PUBLIC_RAW.get(`zkp-latest/${siteId}.json`);
  if (ptr) {
    const { run_id, last_seq } = JSON.parse(await ptr.text()) as { run_id: string; last_seq: number };
    if (run_id != null && last_seq != null) {
      const record = await scanRun(siteId, run_id, last_seq, env);
      if (record) return record;
    }
  }

  const listed = await env.CLARUS_DEV_PUBLIC_AUDIT.list({ prefix: `chains/${siteId}/`, limit: 1000 });
  if (!listed.objects.length) return null;

  const runMap = new Map<string, RunEntry>();
  for (const obj of listed.objects) {
    const parts = obj.key.split("/");
    if (parts.length < 4) continue;
    const runId = parts[2];
    const seq   = parseInt(parts[3], 10);
    const entry = runMap.get(runId);
    if (!entry || seq > entry.last_seq) runMap.set(runId, { run_id: runId, last_seq: seq });
  }
  if (!runMap.size) return null;

  const [newestRun] = [...runMap.values()].sort((a, b) => b.run_id.localeCompare(a.run_id));
  return scanRun(siteId, newestRun.run_id, newestRun.last_seq, env);
}

async function scanRun(siteId: string, runId: string, lastSeq: number, env: Env): Promise<AuditRecord | null> {
  const start = Math.max(0, lastSeq - 9);
  for (let seq = lastSeq; seq >= start; seq--) {
    const key = `chains/${siteId}/${runId}/${String(seq).padStart(20, "0")}.json`;
    const obj = await env.CLARUS_DEV_PUBLIC_AUDIT.get(key);
    if (!obj) continue;
    const record = JSON.parse(await obj.text()) as AuditRecord;
    if (record.zk_proof) return record;
  }
  return null;
}
