import {
  contentHeaders,
  ensureSchema,
  normalizeVaultPath,
  runtimeEnv,
} from "@/lib/server";

export type SnapshotFile = {
  path: string;
  hash: string;
  size: number;
  mime: string;
  mtime: number;
};

export async function currentSnapshotState() {
  await ensureSchema();
  const row = await runtimeEnv().DB
    .prepare("SELECT generation, updated_at FROM vault_state WHERE id = 1")
    .first<{ generation: number; updated_at: string }>();
  return {
    generation: row?.generation ?? 0,
    updated_at: row?.updated_at ?? null,
  };
}

export async function getSnapshotFile(pathValue: string): Promise<SnapshotFile | null> {
  const path = normalizeVaultPath(pathValue);
  await ensureSchema();
  const row = await runtimeEnv().DB
    .prepare(
      `SELECT f.path, f.hash, f.size, f.mime, f.mtime
       FROM vault_files f
       JOIN vault_state s ON s.id = 1 AND s.generation = f.generation
       WHERE f.path = ?`,
    )
    .bind(path)
    .first<SnapshotFile>();
  return row ?? null;
}

export async function snapshotResponse(path: string): Promise<Response> {
  const file = await getSnapshotFile(path);
  if (!file) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "동기화된 자료를 찾을 수 없습니다." } },
      { status: 404, headers: contentHeaders("application/json; charset=utf-8") },
    );
  }
  const blob = await runtimeEnv().VAULT.get(`blobs/${file.hash}`);
  if (!blob) {
    return Response.json(
      { error: { code: "BLOB_MISSING", message: "동기화 자료가 누락되었습니다." } },
      { status: 503, headers: contentHeaders("application/json; charset=utf-8") },
    );
  }
  return new Response(blob.body, {
    headers: contentHeaders(file.mime, {
      ETag: `"${file.hash}"`,
      "Content-Length": String(file.size),
    }),
  });
}
