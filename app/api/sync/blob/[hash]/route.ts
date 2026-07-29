import {
  ensureSchema,
  hasValidSyncEnvelope,
  MAX_SYNC_BLOB_BYTES,
  normalizeSyncMime,
  privateHeaders,
  readBodyLimited,
  RequestBodyTooLargeError,
  runtimeEnv,
  sha256Hex,
  verifySyncRequest,
} from "@/lib/server";

export async function PUT(
  request: Request,
  context: { params: Promise<{ hash: string }> },
) {
  const { hash } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return Response.json({ error: "Invalid hash" }, { status: 400, headers: privateHeaders() });
  }
  if (!hasValidSyncEnvelope(request)) {
    return Response.json({ error: "Invalid sync envelope" }, { status: 401, headers: privateHeaders() });
  }
  const mime = normalizeSyncMime(request.headers.get("content-type") ?? "");
  if (!mime) {
    return Response.json({ error: "Unsupported content type" }, { status: 415, headers: privateHeaders() });
  }
  let body: ArrayBuffer;
  try {
    body = await readBodyLimited(request, MAX_SYNC_BLOB_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Blob exceeds 20 MB" }, { status: 413, headers: privateHeaders() });
    }
    throw error;
  }
  if (!(await verifySyncRequest(request, body))) {
    return Response.json({ error: "Invalid sync signature" }, { status: 401, headers: privateHeaders() });
  }
  if ((await sha256Hex(body)) !== hash) {
    return Response.json({ error: "Hash mismatch" }, { status: 400, headers: privateHeaders() });
  }
  await runtimeEnv().VAULT.put(`blobs/${hash}`, body, {
    httpMetadata: { contentType: mime },
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
      mime,
      Date.now(),
    )
    .run();
  return Response.json({ ok: true, hash }, { headers: privateHeaders() });
}
