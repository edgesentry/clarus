/**
 * Cloudflare Pages Function — serves files from R2.
 *
 * Routes:
 *   /data/analytics/* → clarus-dev-public-analytics  (vessel features, risk scores)
 *   /data/raw/*       → clarus-dev-public-raw         (heartbeats, alerts)
 */
export async function onRequestGet({ request, env, params }) {
  const parts = params.path || [];
  const role = parts[0]; // "analytics" or "raw"
  const key = parts.slice(1).join("/"); // strip role prefix — R2 key has no "raw/" or "analytics/" prefix

  const bucket = role === "raw"
    ? env.CLARUS_DEV_PUBLIC_RAW
    : env.CLARUS_DEV_PUBLIC_ANALYTICS;

  const object = await bucket.get(key);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Access-Control-Allow-Origin", "*");
  object.writeHttpMetadata(headers);

  return new Response(object.body, { headers });
}
