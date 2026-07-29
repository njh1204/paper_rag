import {
  checkLoginLimit,
  clearLoginFailures,
  issueSessionCookie,
  privateHeaders,
  recordLoginFailure,
  verifyPassword,
} from "@/lib/server";

const MAX_LOGIN_BODY_BYTES = 2_048;
const MAX_PASSWORD_CHARACTERS = 256;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_LOGIN_BODY_BYTES) {
    return Response.json(
      { error: "요청 크기가 너무 큽니다." },
      { status: 413, headers: privateHeaders() },
    );
  }

  const limit = await checkLoginLimit(request);
  if (limit.blocked) {
    return Response.json(
      { error: "로그인 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요." },
      { status: 429, headers: privateHeaders({ "Retry-After": "600" }) },
    );
  }

  let password = "";
  try {
    const payload = (await request.json()) as { password?: unknown };
    password = typeof payload.password === "string" ? payload.password : "";
    if (!password || password.length > MAX_PASSWORD_CHARACTERS) {
      throw new Error("Invalid password");
    }
  } catch {
    return Response.json(
      { error: "올바른 요청이 아닙니다." },
      { status: 400, headers: privateHeaders() },
    );
  }

  if (!(await verifyPassword(password))) {
    await recordLoginFailure(limit.fingerprint, limit.row ?? null);
    return Response.json(
      { error: "비밀번호가 맞지 않습니다." },
      { status: 401, headers: privateHeaders() },
    );
  }

  await clearLoginFailures(limit.fingerprint);
  return Response.json(
    { ok: true, expires_in: 3_600 },
    { headers: privateHeaders({ "Set-Cookie": await issueSessionCookie() }) },
  );
}
