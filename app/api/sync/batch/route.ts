import {
  ensureSchema,
  privateHeaders,
  runtimeEnv,
  sha256Hex,
  verifySyncRequest,
} from "@/lib/server";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
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
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Batch exceeds 16 MB" }, { status: 413, headers: privateHeaders() });
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
      decoded.push({
        hash,
        mime: String(item.mime || "application/octet-stream").slice(0, 120),
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
