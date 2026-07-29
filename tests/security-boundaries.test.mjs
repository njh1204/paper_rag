import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "node_modules",
]);

async function sourceFiles(directory = root) {
  const files = [];
  for (const entry of await readdir(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const absolute = path.join(directory, entry);
    if ((await stat(absolute)).isDirectory()) files.push(...await sourceFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

test("keeps credentials and paper payloads outside the public repository", async () => {
  const files = await sourceFiles();
  const relative = files.map((file) => path.relative(root, file).replaceAll("\\", "/"));
  assert.equal(relative.some((file) => file === ".dev.vars"), false);
  assert.equal(relative.some((file) => file.startsWith(".openai/")), false);
  assert.equal(relative.some((file) => /\.(pdf|docx)$/i.test(file)), false);
  assert.equal(relative.some((file) => /^(data|snapshots|vault|exports)\//.test(file)), false);

  const textFiles = files.filter((file) => (
    !path.relative(root, file).startsWith(`tests${path.sep}`)
    && /\.(?:ts|tsx|js|mjs|json|md|css|sql)$/i.test(file)
  ));
  const source = (await Promise.all(textFiles.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /C:\\Users\\/i);
  assert.doesNotMatch(source, /OAI-Sites-Authorization|oai-authenticated-user/i);
  assert.doesNotMatch(source, /chatgpt\.site/i);
});

test("uses server-side opaque sessions and replay-resistant sync requests", async () => {
  const [server, login, logout, client] = await Promise.all([
    readFile(path.join(root, "lib/server.ts"), "utf8"),
    readFile(path.join(root, "app/api/auth/login/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/auth/logout/route.ts"), "utf8"),
    readFile(path.join(root, "app/HostedPaperGraph.tsx"), "utf8"),
  ]);

  assert.match(server, /__Host-paper_graph_session/);
  assert.match(server, /INSERT INTO auth_sessions/);
  assert.match(server, /SameSite=Strict/);
  assert.match(server, /const SESSION_SECONDS = 60 \* 60/);
  assert.match(server, /x-sync-nonce/);
  assert.match(server, /INSERT OR IGNORE INTO sync_nonces/);
  assert.match(login, /expires_in:\s*3_600/);
  assert.match(logout, /revokeRequestSession/);
  assert.match(client, /\/api\/auth\/login/);
  assert.doesNotMatch(`${server}\n${client}`, /OWNER_EMAIL|auth\/guest/);
});

test("does not expose mutation routes in the hosted read API", async () => {
  const [route, readerApi] = await Promise.all([
    readFile(path.join(root, "app/api/v1/[...path]/route.ts"), "utf8"),
    readFile(path.join(root, "app/reader/api.ts"), "utf8"),
  ]);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(readerApi, /uploadParent|promote:|retryJob|deleteHighlight|highlight:\s*\(/);
});

test("caps denial-of-wallet paths before they reach D1 or R2", async () => {
  const [worker, server, blob, batch, check, commit, wrangler] = await Promise.all([
    readFile(path.join(root, "worker/index.ts"), "utf8"),
    readFile(path.join(root, "lib/server.ts"), "utf8"),
    readFile(path.join(root, "app/api/sync/blob/[hash]/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/sync/batch/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/sync/check/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/sync/commit/route.ts"), "utf8"),
    readFile(path.join(root, "wrangler.jsonc"), "utf8"),
  ]);

  assert.match(worker, /LOGIN_RATE_LIMITER/);
  assert.match(worker, /READ_RATE_LIMITER/);
  assert.match(worker, /SYNC_RATE_LIMITER/);
  assert.match(worker, /syncEnvelopeLooksValid/);
  assert.match(server, /readBodyLimited/);
  assert.match(server, /MAX_SNAPSHOT_BYTES/);
  assert.match(server, /isAllowedSnapshotPath/);
  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS/);
  assert.match(`${blob}\n${batch}\n${check}\n${commit}`, /RequestBodyTooLargeError/);
  assert.match(commit, /new Set\(files\.map/);
  assert.match(commit, /MAX_SNAPSHOT_BYTES/);
  assert.doesNotMatch(wrangler, /"cpu_ms"/);
  assert.match(wrangler, /"head_sampling_rate": 0\.01/);
});
