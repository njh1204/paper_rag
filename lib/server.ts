import { env } from "cloudflare:workers";

const SESSION_COOKIE = "__Host-paper_graph_session";
const SESSION_SECONDS = 60 * 60;
// Cloudflare Workers currently caps Web Crypto PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
export const MAX_LOGIN_BODY_BYTES = 2_048;
export const MAX_SYNC_BATCH_BYTES = 16 * 1024 * 1024;
export const MAX_SYNC_BLOB_BYTES = 20 * 1024 * 1024;
export const MAX_SYNC_CHECK_BYTES = 512 * 1024;
export const MAX_SYNC_COMMIT_BYTES = 24 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
export const MAX_SNAPSHOT_FILES = 5_000;

let schemaReady: Promise<void> | undefined;

export type RuntimeEnv = {
  DB: D1Database;
  VAULT: R2Bucket;
  PASSWORD_PEPPER?: string;
  INITIAL_GUEST_PASSWORD?: string;
  SYNC_SECRET?: string;
};

export type VaultFileInput = {
  path: string;
  hash: string;
  size: number;
  mime: string;
  mtime: number;
  searchText?: string;
  listed?: boolean;
};

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export async function ensureSchema(db = runtimeEnv().DB) {
  // Wrangler migrations own the schema. Check once per isolate rather than
  // issuing a batch of DDL statements on every authenticated read.
  schemaReady ??= db
    .prepare("SELECT id FROM vault_state WHERE id = 1")
    .first()
    .then((row) => {
      if (!row) throw new Error("D1 schema is not initialized; apply migrations first");
    });
  await schemaReady;
}

export class RequestBodyTooLargeError extends Error {}

export async function readBodyLimited(request: Request, maximumBytes: number): Promise<ArrayBuffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) {
      throw new RequestBodyTooLargeError("Request body is too large");
    }
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError("Request body is too large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export async function readTextLimited(request: Request, maximumBytes: number): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readBodyLimited(request, maximumBytes),
  );
}

const ALLOWED_SYNC_MIME = new Map([
  ["application/json", "application/json; charset=utf-8"],
  ["text/markdown", "text/markdown; charset=utf-8"],
  ["image/jpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"],
  ["image/gif", "image/gif"],
]);

export function normalizeSyncMime(input: string): string | null {
  return ALLOWED_SYNC_MIME.get(input.split(";", 1)[0].trim().toLowerCase()) ?? null;
}

export function isAllowedSnapshotPath(path: string, mime: string): boolean {
  const json =
    path === "library/tree.json" ||
    /^(papers|annotations)\/[^/]+\.json$/.test(path) ||
    /^citations\/[^/]+\/(ko|en)\.json$/.test(path) ||
    /^children\/[^/]+\/[^/]+\.json$/.test(path);
  if (json) return mime === "application/json; charset=utf-8";
  if (/^content\/[^/]+\/(ko|en)\.md$/.test(path)) {
    return mime === "text/markdown; charset=utf-8";
  }
  if (/^assets\/[^/]+\/.+\.(jpe?g|png|webp|gif)$/i.test(path)) {
    return /^image\/(jpeg|png|webp|gif)$/.test(mime);
  }
  return false;
}

export function normalizeVaultPath(input: string): string {
  const decoded = decodeURIComponent(input).replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = decoded.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    throw new Error("Invalid vault path");
  }
  return segments.join("/");
}

export async function sha256Hex(input: ArrayBuffer | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function hmacBytes(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2) return new Uint8Array();
  return new Uint8Array(value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

function randomHex(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function passwordDigest(password: string, salt: string, iterations: number) {
  const pepper = runtimeEnv().PASSWORD_PEPPER;
  if (!pepper) throw new Error("PASSWORD_PEPPER is not configured");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${password}\u0000${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function ensureInitialPassword() {
  const db = runtimeEnv().DB;
  await ensureSchema(db);
  const current = await db
    .prepare("SELECT id FROM auth_state WHERE id = 1")
    .first<{ id: number }>();
  if (current) return;

  const initialPassword = runtimeEnv().INITIAL_GUEST_PASSWORD;
  if (!initialPassword) throw new Error("INITIAL_GUEST_PASSWORD is not configured");
  if (initialPassword.length < 14 || initialPassword.length > 256) {
    throw new Error("INITIAL_GUEST_PASSWORD must be 14 to 256 characters");
  }
  const salt = randomHex();
  const hash = await passwordDigest(initialPassword, salt, PBKDF2_ITERATIONS);
  await db
    .prepare(
      `INSERT OR IGNORE INTO auth_state
       (id, password_salt, password_hash, iterations, session_epoch, updated_at)
       VALUES (1, ?, ?, ?, 1, ?)`,
    )
    .bind(salt, hash, PBKDF2_ITERATIONS, new Date().toISOString())
    .run();
}

export async function verifyPassword(password: string): Promise<boolean> {
  await ensureInitialPassword();
  const row = await runtimeEnv().DB
    .prepare(
      "SELECT password_salt, password_hash, iterations FROM auth_state WHERE id = 1",
    )
    .first<{ password_salt: string; password_hash: string; iterations: number }>();
  if (!row) return false;
  const actual = await passwordDigest(password, row.password_salt, row.iterations);
  return safeEqual(hexToBytes(actual), hexToBytes(row.password_hash));
}

export async function changeGuestPassword(password: string) {
  if (password.length < 14 || password.length > 256) {
    throw new Error("Password must be 14 to 256 characters");
  }
  const salt = randomHex();
  const hash = await passwordDigest(password, salt, PBKDF2_ITERATIONS);
  await ensureSchema();
  await runtimeEnv().DB
    .prepare(
      `INSERT INTO auth_state
       (id, password_salt, password_hash, iterations, session_epoch, updated_at)
       VALUES (1, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         password_salt = excluded.password_salt,
         password_hash = excluded.password_hash,
         iterations = excluded.iterations,
         session_epoch = auth_state.session_epoch + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(salt, hash, PBKDF2_ITERATIONS, new Date().toISOString())
    .run();
}

export async function revokeSessions() {
  await ensureInitialPassword();
  await runtimeEnv().DB.batch([
    runtimeEnv().DB.prepare("DELETE FROM auth_sessions"),
    runtimeEnv().DB
      .prepare(
        "UPDATE auth_state SET session_epoch = session_epoch + 1, updated_at = ? WHERE id = 1",
      )
      .bind(new Date().toISOString()),
  ]);
}

export async function issueSessionCookie(): Promise<string> {
  await ensureInitialPassword();
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_SECONDS * 1000;
  const db = runtimeEnv().DB;
  await db.batch([
    db
      .prepare(
        "INSERT INTO auth_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
      )
      .bind(tokenHash, createdAt, expiresAt),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(createdAt),
  ]);
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export async function hasGuestSession(request: Request): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  await ensureSchema();
  const tokenHash = await sha256Hex(token);
  const session = await runtimeEnv().DB
    .prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ expires_at: number }>();
  if (!session || session.expires_at <= Date.now()) {
    if (session) {
      await runtimeEnv().DB
        .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
        .bind(tokenHash)
        .run();
    }
    return false;
  }
  return true;
}

export async function revokeRequestSession(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  await ensureSchema();
  await runtimeEnv().DB
    .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

export async function hasReadAccess(request: Request): Promise<boolean> {
  return hasGuestSession(request);
}

export function privateHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return headers;
}

export function contentHeaders(mime: string, extra?: HeadersInit): Headers {
  const headers = privateHeaders(extra);
  headers.set("Content-Type", mime);
  return headers;
}

export function unauthorized() {
  return Response.json(
    { error: "비밀번호 인증이 필요합니다." },
    { status: 401, headers: privateHeaders() },
  );
}

export async function requestFingerprint(request: Request): Promise<string> {
  const pepper = runtimeEnv().PASSWORD_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error("PASSWORD_PEPPER is not configured");
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    "local";
  return bytesToHex(await hmacBytes(pepper, ip.trim()));
}

export async function checkLoginLimit(request: Request) {
  await ensureSchema();
  const fingerprint = await requestFingerprint(request);
  const row = await runtimeEnv().DB
    .prepare(
      "SELECT window_started_at, failures, blocked_until FROM login_attempts WHERE fingerprint = ?",
    )
    .bind(fingerprint)
    .first<{ window_started_at: number; failures: number; blocked_until: number }>();
  return { fingerprint, blocked: Boolean(row && row.blocked_until > Date.now()), row };
}

export async function recordLoginFailure(
  fingerprint: string,
  row: { window_started_at: number; failures: number; blocked_until: number } | null,
) {
  const now = Date.now();
  const inWindow = row && now - row.window_started_at < LOGIN_WINDOW_MS;
  const failures = inWindow ? row.failures + 1 : 1;
  const windowStartedAt = inWindow ? row.window_started_at : now;
  const blockedUntil = failures >= MAX_LOGIN_FAILURES ? now + LOGIN_WINDOW_MS : 0;
  await runtimeEnv().DB
    .prepare(
      `INSERT INTO login_attempts (fingerprint, window_started_at, failures, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         window_started_at = excluded.window_started_at,
         failures = excluded.failures,
         blocked_until = excluded.blocked_until`,
    )
    .bind(fingerprint, windowStartedAt, failures, blockedUntil)
    .run();
  // Roughly 1/256 failure records perform bounded retention cleanup, avoiding
  // an extra write on every failed login while preventing unbounded bot rows.
  if (fingerprint.startsWith("00")) {
    await runtimeEnv().DB
      .prepare("DELETE FROM login_attempts WHERE window_started_at < ?")
      .bind(now - 24 * 60 * 60 * 1000)
      .run();
  }
}

export async function clearLoginFailures(fingerprint: string) {
  await runtimeEnv().DB
    .prepare("DELETE FROM login_attempts WHERE fingerprint = ?")
    .bind(fingerprint)
    .run();
}

export async function verifySyncRequest(
  request: Request,
  body: ArrayBuffer | string,
): Promise<boolean> {
  const secret = runtimeEnv().SYNC_SECRET;
  const timestamp = request.headers.get("x-sync-timestamp");
  const nonce = request.headers.get("x-sync-nonce");
  const signature = request.headers.get("x-sync-signature");
  if (
    !secret ||
    secret.length < 32 ||
    !timestamp ||
    !nonce ||
    !signature ||
    !/^\d+$/.test(timestamp) ||
    !/^[a-f0-9]{32}$/.test(nonce)
  ) {
    return false;
  }
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const url = new URL(request.url);
  const bodyHash = await sha256Hex(body);
  const canonical = `${timestamp}\n${nonce}\n${request.method.toUpperCase()}\n${url.pathname}\n${bodyHash}`;
  const expected = await hmacBytes(secret, canonical);
  if (!safeEqual(expected, hexToBytes(signature))) return false;

  const db = runtimeEnv().DB;
  await ensureSchema(db);
  const now = Date.now();
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO sync_nonces (nonce, created_at, expires_at) VALUES (?, ?, ?)",
    )
    .bind(nonce, now, now + 10 * 60 * 1000)
    .run();
  if (!inserted.meta.changes) return false;
  await db.prepare("DELETE FROM sync_nonces WHERE expires_at <= ?").bind(now).run();
  return true;
}

export function hasValidSyncEnvelope(request: Request): boolean {
  const timestamp = request.headers.get("x-sync-timestamp");
  const nonce = request.headers.get("x-sync-nonce");
  const signature = request.headers.get("x-sync-signature");
  return Boolean(
    timestamp &&
      nonce &&
      signature &&
      /^\d+$/.test(timestamp) &&
      /^[a-f0-9]{32}$/.test(nonce) &&
      /^[a-f0-9]{64}$/.test(signature) &&
      Math.abs(Date.now() - Number(timestamp)) <= 5 * 60 * 1000,
  );
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
