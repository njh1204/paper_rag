/** Cloudflare Worker entry point for the read-only Paper Graph site. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  VAULT: R2Bucket;
  LOGIN_RATE_LIMITER: RateLimiter;
  READ_RATE_LIMITER: RateLimiter;
  SYNC_RATE_LIMITER: RateLimiter;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function secure(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  return secured;
}

function reject(status: number, message: string, retryAfter?: string): Response {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return secure(Response.json({ error: message }, { status, headers }));
}

function requestKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
    "unknown"
  );
}

function declaredBodyTooLarge(request: Request, maximumBytes: number): boolean {
  const value = request.headers.get("content-length");
  if (value === null) return false;
  const length = Number(value);
  return !Number.isSafeInteger(length) || length < 0 || length > maximumBytes;
}

function expectedMethod(pathname: string): string | null {
  if (pathname === "/api/auth/login" || pathname === "/api/auth/logout") return "POST";
  if (pathname === "/api/auth/status" || pathname.startsWith("/api/v1/")) return "GET";
  if (pathname === "/api/sync/check" || pathname === "/api/sync/batch" || pathname === "/api/sync/commit") {
    return "POST";
  }
  if (pathname.startsWith("/api/sync/blob/")) return "PUT";
  return null;
}

function syncEnvelopeLooksValid(request: Request): boolean {
  const timestamp = request.headers.get("x-sync-timestamp") ?? "";
  return (
    /^\d+$/.test(timestamp) &&
    Math.abs(Date.now() - Number(timestamp)) <= 5 * 60 * 1000 &&
    /^[a-f0-9]{32}$/.test(request.headers.get("x-sync-nonce") ?? "") &&
    /^[a-f0-9]{64}$/.test(request.headers.get("x-sync-signature") ?? "")
  );
}

async function applyApiGuard(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return null;

  const method = expectedMethod(pathname);
  if (method && request.method !== method) {
    return reject(405, "Method not allowed");
  }
  const actor = requestKey(request);

  if (pathname === "/api/auth/login") {
    if (declaredBodyTooLarge(request, 2_048)) return reject(413, "Request body too large");
    if (!(await env.LOGIN_RATE_LIMITER.limit({ key: actor })).success) {
      return reject(429, "Too many login attempts", "60");
    }
    return null;
  }

  if (pathname.startsWith("/api/sync/")) {
    if (!syncEnvelopeLooksValid(request)) return reject(401, "Invalid sync envelope");
    const maximum =
      pathname === "/api/sync/check"
        ? 512 * 1024
        : pathname === "/api/sync/commit"
          ? 24 * 1024 * 1024
          : pathname === "/api/sync/batch"
            ? 16 * 1024 * 1024
            : 20 * 1024 * 1024;
    if (declaredBodyTooLarge(request, maximum)) return reject(413, "Request body too large");
    const [globalLimit, actorLimit] = await Promise.all([
      env.SYNC_RATE_LIMITER.limit({ key: "paper-rag-sync-global" }),
      env.SYNC_RATE_LIMITER.limit({ key: `ip:${actor}` }),
    ]);
    if (!globalLimit.success || !actorLimit.success) {
      return reject(429, "Sync rate limit exceeded", "60");
    }
    return null;
  }

  const ipLimit = await env.READ_RATE_LIMITER.limit({ key: `ip:${actor}` });
  if (!ipLimit.success) return reject(429, "Read rate limit exceeded", "60");
  const sessionToken = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("__Host-paper_graph_session="))
    ?.split("=", 2)[1];
  if (sessionToken && /^[a-f0-9]{64}$/.test(sessionToken)) {
    const sessionLimit = await env.READ_RATE_LIMITER.limit({
      key: `session:${sessionToken.slice(-24)}`,
    });
    if (!sessionLimit.success) return reject(429, "Session rate limit exceeded", "60");
  }
  return null;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const blocked = await applyApiGuard(request, env);
    if (blocked) return blocked;
    return secure(await handler.fetch(request, env, ctx));
  },
};

export default worker;
