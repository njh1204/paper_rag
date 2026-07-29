import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses Paper Graph metadata without starter markers", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<HostedPaperGraph \/>/);
  assert.match(layout, /title:\s*"Paper Graph"/);
  assert.doesNotMatch(`${page}\n${layout}\n${packageJson}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps deployment UI read-only and sessions fixed at one hour", async () => {
  const [app, reader, server, layout] = await Promise.all([
    readFile(new URL("../app/reader/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reader/ReaderPane.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /<ImportParent\b|<ProgressTray\b|removeHighlight\.mutate/);
  assert.doesNotMatch(reader, /onContextMenu=\{onReaderContextMenu\}/);
  assert.match(server, /const SESSION_SECONDS = 60 \* 60/);
  assert.match(server, /Max-Age=\$\{SESSION_SECONDS\}/);
  assert.match(layout, /index:\s*false/);
});
