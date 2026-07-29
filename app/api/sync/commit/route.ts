import {
  ensureSchema,
  normalizeVaultPath,
  privateHeaders,
  runtimeEnv,
  type VaultFileInput,
  verifySyncRequest,
} from "@/lib/server";

type CommitPayload = {
  files?: VaultFileInput[];
  profile?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const body = await request.text();
  if (!(await verifySyncRequest(request, body))) {
    return Response.json(
      { error: "Invalid sync signature" },
      { status: 401, headers: privateHeaders() },
    );
  }

  let payload: CommitPayload;
  try {
    payload = JSON.parse(body) as CommitPayload;
  } catch {
    return Response.json(
      { error: "Invalid JSON" },
      { status: 400, headers: privateHeaders() },
    );
  }
  if (!Array.isArray(payload.files) || payload.files.length > 5_000) {
    return Response.json(
      { error: "A full manifest of up to 5,000 files is required" },
      { status: 400, headers: privateHeaders() },
    );
  }

  let files: VaultFileInput[];
  try {
    files = payload.files.map((file) => ({
      path: normalizeVaultPath(file.path),
      hash: file.hash.toLowerCase(),
      size: Number(file.size),
      mime: String(file.mime || "application/octet-stream").slice(0, 120),
      mtime: Number(file.mtime),
      searchText: String(file.searchText ?? "").slice(0, 150_000),
      listed: file.listed !== false,
    }));
    if (
      files.some(
        (file) =>
          !/^[a-f0-9]{64}$/.test(file.hash) ||
          !Number.isFinite(file.size) ||
          file.size < 0 ||
          !Number.isFinite(file.mtime),
      )
    ) {
      throw new Error("Invalid manifest entry");
    }
  } catch {
    return Response.json(
      { error: "Invalid manifest entry" },
      { status: 400, headers: privateHeaders() },
    );
  }

  const requiredHashes = [...new Set(files.map((file) => file.hash))];
  const available = new Set<string>();
  await ensureSchema();
  for (let index = 0; index < requiredHashes.length; index += 75) {
    const group = requiredHashes.slice(index, index + 75);
    const result = await runtimeEnv().DB
      .prepare(
        `SELECT hash FROM blob_objects WHERE hash IN (${group.map(() => "?").join(",")})`,
      )
      .bind(...group)
      .all<{ hash: string }>();
    for (const item of result.results) available.add(item.hash);
  }
  const missing = files
    .filter((file) => !available.has(file.hash))
    .map((file) => file.path);
  if (missing.length) {
    return Response.json(
      { error: "Missing blobs", paths: missing.slice(0, 20) },
      { status: 409, headers: privateHeaders() },
    );
  }

  const db = runtimeEnv().DB;
  await ensureSchema(db);
  const state = await db
    .prepare("SELECT generation FROM vault_state WHERE id = 1")
    .first<{ generation: number }>();
  const generation = (state?.generation ?? 0) + 1;
  const statements = files.map((file) =>
    db
      .prepare(
        `INSERT INTO vault_files
         (generation, path, hash, size, mime, mtime, search_text, listed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        generation,
        file.path,
        file.hash,
        file.size,
        file.mime,
        file.mtime,
        file.searchText ?? "",
        file.listed === false ? 0 : 1,
      ),
  );
  for (let index = 0; index < statements.length; index += 100) {
    await db.batch(statements.slice(index, index + 100));
  }
  await db.batch([
    db
      .prepare("INSERT INTO vault_profiles (generation, json) VALUES (?, ?)")
      .bind(generation, JSON.stringify(payload.profile ?? {})),
    db
      .prepare("UPDATE vault_state SET generation = ?, updated_at = ? WHERE id = 1")
      .bind(generation, new Date().toISOString()),
  ]);
  await db
    .prepare("DELETE FROM vault_files WHERE generation < ?")
    .bind(Math.max(0, generation - 2))
    .run();
  await db
    .prepare("DELETE FROM vault_profiles WHERE generation < ?")
    .bind(Math.max(0, generation - 2))
    .run();

  return Response.json(
    { ok: true, generation, fileCount: files.length },
    { headers: privateHeaders() },
  );
}
