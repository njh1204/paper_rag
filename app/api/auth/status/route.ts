import { hasReadAccess, privateHeaders } from "@/lib/server";

export async function GET(request: Request) {
  if (!(await hasReadAccess(request))) {
    return Response.json({ authenticated: false }, { status: 401, headers: privateHeaders() });
  }
  return Response.json({ authenticated: true }, { headers: privateHeaders() });
}
