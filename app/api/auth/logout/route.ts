import {
  clearSessionCookie,
  privateHeaders,
  revokeRequestSession,
} from "@/lib/server";

export async function POST(request: Request) {
  await revokeRequestSession(request);
  return Response.json(
    { ok: true },
    {
      headers: privateHeaders({ "Set-Cookie": clearSessionCookie() }),
    },
  );
}
