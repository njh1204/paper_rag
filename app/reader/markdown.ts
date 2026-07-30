export type MarkdownHeading = {
  id: string;
  level: number;
  text: string;
};

export const headingId = (index: number) => `paper-heading-${index}`;

const plainHeadingText = (value: string) =>
  value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Remove the delimiter characters themselves. Replacing whole HTML-like
    // sequences once can expose a nested tag after the replacement.
    .replace(/[<>]/g, "")
    .replace(/[*_~`]/g, "")
    .trim();

export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = String(source || "").split(/\r?\n/);
  let fence = "";
  let index = 0;
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence ? "" : marker;
      continue;
    }
    if (fence) continue;
    const atx = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (atx) {
      headings.push({ id: headingId(index), level: atx[1].length, text: plainHeadingText(atx[2]) });
      index += 1;
    }
  }
  return headings;
}
