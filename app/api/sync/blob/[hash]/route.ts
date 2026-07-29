import {
  ensureSchema,
  privateHeaders,
  runtimeEnv,
  sha256Hex,
  verifySyncRequest,
} from "@/lib/server";

const MAX_BLOB_BYTES = 20 * 1024 * 1024;

export async function PUT(
  request: Request,
  context: { params: Promise<{ hash: string }> },
) {
  const { hash } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return Response.json({ error: "Invalid hash" }, { status: 400, headers: privateHeaders() });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BLOB_BYTES) {
    return Response.json({ error: "Blob exceeds 20 MB" }, { status: 413, headers: privateHeaders() });
  }
  if (!(await verifySyncRequest(request, body))) {
    return Response.json({ error: "Invalid sync signature" }, { status: 401, headers: privateHeaders() });
  }
  if ((await sha256Hex(body)) !== hash) {
    return Response.json({ error: "Hash mismatch" }, { status: 400, headers: privateHeaders() });
  }
  await runtimeEnv().VAULT.put(`blobs/${hash}`, body, {
    httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
  });
  await ensureSchema();
  await runtimeEnv().DB
    .prepare(
      `INSERT INTO blob_objects (hash, size, mime, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET
         size = excluded.size,
         mime = excluded.mime`,
    )
    .bind(
      hash,
      body.byteLength,
      request.headers.get("content-type") ?? "application/octet-stream",
      Date.now(),
    )
    .run();
  return Response.json({ ok: true, hash }, { headers: privateHeaders() });
}
