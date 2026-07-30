import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

async function loadMarkdownModule() {
  const source = await readFile(new URL("../app/reader/markdown.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { exports: module.exports, module });
  return module.exports;
}

test("heading extraction cannot expose nested HTML-like markup", async () => {
  const { extractMarkdownHeadings } = await loadMarkdownModule();
  const headings = extractMarkdownHeadings([
    "# Safe <scr<script>ipt>alert(1)</scr</script>ipt>",
    "## [linked](https://example.invalid) ![image](asset.png)",
  ].join("\n"));

  assert.equal(headings.length, 2);
  assert.doesNotMatch(headings[0].text, /[<>]/);
  assert.equal(headings[1].text, "linked image");
});
