import { hasReadAccess, privateHeaders, unauthorized } from "@/lib/server";
import { currentSnapshotState, snapshotResponse } from "@/lib/snapshot";

function clean(value: string) {
  return encodeURIComponent(decodeURIComponent(value));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!(await hasReadAccess(request))) return unauthorized();
  const { path } = await context.params;
  const url = new URL(request.url);

  if (path.length === 1 && path[0] === "health") {
    const state = await currentSnapshotState();
    return Response.json(
      {
        status: state.generation > 0 ? "ok" : "degraded",
        neo4j: "not_required",
        models: {},
        generation: state.generation,
        updated_at: state.updated_at,
      },
      { headers: privateHeaders() },
    );
  }
  if (path.join("/") === "library/tree") return snapshotResponse("library/tree.json");

  if (path[0] === "papers" && path.length === 2) {
    return snapshotResponse(`papers/${clean(path[1])}.json`);
  }
  if (path[0] === "papers" && path[2] === "content") {
    const language = url.searchParams.get("language") === "en" ? "en" : "ko";
    return snapshotResponse(`content/${clean(path[1])}/${language}.md`);
  }
  if (path[0] === "papers" && path[2] === "citation-links") {
    const language = url.searchParams.get("language") === "ko" ? "ko" : "en";
    return snapshotResponse(`citations/${clean(path[1])}/${language}.json`);
  }
  if (path[0] === "papers" && path[2] === "asset") {
    const assetPath = url.searchParams.get("path");
    if (!assetPath) return Response.json({ error: "Missing path" }, { status: 400, headers: privateHeaders() });
    return snapshotResponse(`assets/${clean(path[1])}/${assetPath}`);
  }
  if (path[0] === "papers" && path[2] === "annotations") {
    return snapshotResponse(`annotations/${clean(path[1])}.json`);
  }
  if (
    path[0] === "library" &&
    path[1] === "parents" &&
    path[3] === "children" &&
    path.length === 5
  ) {
    return snapshotResponse(`children/${clean(path[2])}/${clean(path[4])}.json`);
  }
  return Response.json(
    { error: { code: "NOT_FOUND", message: "지원하지 않는 읽기 요청입니다." } },
    { status: 404, headers: privateHeaders() },
  );
}
