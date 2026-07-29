import {
  ensureSchema,
  hasValidSyncEnvelope,
  MAX_SYNC_BATCH_BYTES,
  normalizeSyncMime,
  privateHeaders,
  readTextLimited,
  RequestBodyTooLargeError,
  runtimeEnv,
  sha256Hex,
  verifySyncRequest,
} from "@/lib/server";

const MAX_ITEMS = 200;

type BatchItem = {
  hash?: string;
  mime?: string;
  data?: string;
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function POST(request: Request) {
  if (!hasValidSyncEnvelope(request)) {
    return Response.json({ error: "Invalid sync envelope" }, { status: 401, headers: privateHeaders() });
  }
  let body: string;
  try {
    body = await readTextLimited(request, MAX_SYNC_BATCH_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Batch exceeds 16 MB" }, { status: 413, headers: privateHeaders() });
    }
    return Response.json({ error: "Invalid UTF-8 body" }, { status: 400, headers: privateHeaders() });
  }
  if (!(await verifySyncRequest(request, body))) {
    return Response.json({ error: "Invalid sync signature" }, { status: 401, headers: privateHeaders() });
  }
  let items: BatchItem[];
  try {
    const payload = JSON.parse(body) as { items?: BatchItem[] };
    items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length || items.length > MAX_ITEMS) throw new Error("Invalid item count");
  } catch {
    return Response.json({ error: "Invalid batch" }, { status: 400, headers: privateHeaders() });
  }

  const decoded: Array<{ hash: string; mime: string; bytes: Uint8Array }> = [];
  try {
    for (const item of items) {
      const hash = String(item.hash || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid hash");
      const bytes = decodeBase64(String(item.data || ""));
      if ((await sha256Hex(bytes.buffer as ArrayBuffer)) !== hash) throw new Error("Hash mismatch");
      const mime = normalizeSyncMime(String(item.mime || ""));
      if (!mime) throw new Error("Unsupported content type");
      decoded.push({
        hash,
        mime,
        bytes,
      });
    }
  } catch {
    return Response.json({ error: "Invalid batch item" }, { status: 400, headers: privateHeaders() });
  }

  for (let index = 0; index < decoded.length; index += 25) {
    await Promise.all(
      decoded.slice(index, index + 25).map((item) =>
        runtimeEnv().VAULT.put(`blobs/${item.hash}`, item.bytes, {
          httpMetadata: { contentType: item.mime },
        }),
      ),
    );
  }
  await ensureSchema();
  for (let index = 0; index < decoded.length; index += 75) {
    await runtimeEnv().DB.batch(
      decoded.slice(index, index + 75).map((item) =>
        runtimeEnv().DB
          .prepare(
            `INSERT INTO blob_objects (hash, size, mime, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(hash) DO UPDATE SET
               size = excluded.size,
               mime = excluded.mime`,
          )
          .bind(item.hash, item.bytes.byteLength, item.mime, Date.now()),
      ),
    );
  }
  return Response.json({ ok: true, uploaded: decoded.length }, { headers: privateHeaders() });
}
