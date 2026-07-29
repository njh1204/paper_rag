import {
  ensureSchema,
  hasValidSyncEnvelope,
  MAX_SYNC_CHECK_BYTES,
  privateHeaders,
  readTextLimited,
  RequestBodyTooLargeError,
  runtimeEnv,
  verifySyncRequest,
} from "@/lib/server";

export async function POST(request: Request) {
  if (!hasValidSyncEnvelope(request)) {
    return Response.json({ error: "Invalid sync envelope" }, { status: 401, headers: privateHeaders() });
  }
  let body: string;
  try {
    body = await readTextLimited(request, MAX_SYNC_CHECK_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Hash list is too large" }, { status: 413, headers: privateHeaders() });
    }
    return Response.json({ error: "Invalid UTF-8 body" }, { status: 400, headers: privateHeaders() });
  }
  if (!(await verifySyncRequest(request, body))) {
    return Response.json({ error: "Invalid sync signature" }, { status: 401, headers: privateHeaders() });
  }
  let hashes: string[];
  try {
    const payload = JSON.parse(body) as { hashes?: string[] };
    hashes = Array.isArray(payload.hashes) ? payload.hashes : [];
    if (hashes.length > 5_000 || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
      throw new Error("Invalid hash list");
    }
  } catch {
    return Response.json({ error: "Invalid hash list" }, { status: 400, headers: privateHeaders() });
  }
  await ensureSchema();
  const available = new Set<string>();
  for (let index = 0; index < hashes.length; index += 75) {
    const group = hashes.slice(index, index + 75);
    if (!group.length) continue;
    const result = await runtimeEnv().DB
      .prepare(
        `SELECT hash FROM blob_objects WHERE hash IN (${group.map(() => "?").join(",")})`,
      )
      .bind(...group)
      .all<{ hash: string }>();
    for (const item of result.results) available.add(item.hash);
  }
  const missing = hashes.filter((hash) => !available.has(hash));
  return Response.json({ missing }, { headers: privateHeaders() });
}
