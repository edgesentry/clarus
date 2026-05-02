/**
 * Cloudflare Pages Function — serves files from clarus-public R2 bucket.
 * Any GET /data/<key> → fetches R2 object with CORS headers.
 */
export async function onRequestGet({ request, env, params }) {
  const key = "data/" + (params.path || []).join("/");
  const object = await env.CLARUS_PUBLIC.get(key);

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
