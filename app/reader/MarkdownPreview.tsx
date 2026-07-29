import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import { memo, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { CitationLink, CitationTarget, Highlight } from "./api";
import { headingId } from "./markdown";

type Props = {
  source: string;
  paperId: string;
  highlights?: Highlight[];
  citationLinks?: CitationLink[];
  onCitationSelect?: (target: CitationTarget) => void;
};

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeHtml = (value: string) =>
  escapeAttribute(value).replaceAll("'", "&#39;");

function injectCitationLinks(source: string, links: CitationLink[]) {
  let prepared = source;
  let rightEdge = source.length;
  const codePointOffsets = [0];
  let codeUnitOffset = 0;
  for (const character of source) {
    codeUnitOffset += character.length;
    codePointOffsets.push(codeUnitOffset);
  }
  const ordered = [...links]
    .filter((link) => link.targets.length > 0)
    .sort((left, right) => right.start_offset - left.start_offset);
  for (const link of ordered) {
    const startOffset = codePointOffsets[link.start_offset];
    const endOffset = codePointOffsets[link.end_offset];
    if (
      startOffset === undefined
      || endOffset === undefined
      || startOffset < 0
      || startOffset >= endOffset
      || endOffset > rightEdge
    ) {
      continue;
    }
    const marker = source.slice(startOffset, endOffset);
    // Never inject HTML at a stale or mismatched offset. A skipped link is
    // preferable to corrupting equations or Markdown content.
    if (marker !== link.marker) continue;
    const button = `<button type="button" class="citation-link" data-citation-id="${escapeAttribute(link.citation_id)}" aria-label="${escapeAttribute(`${marker} 인용 논문 열기`)}">${escapeHtml(marker)}</button>`;
    prepared = `${prepared.slice(0, startOffset)}${button}${prepared.slice(endOffset)}`;
    rightEdge = startOffset;
  }
  return prepared;
}

export function normalizePaperAssetPath(href: string) {
  let cleaned = href.trim().replace(/^<|>$/g, "");
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // The asset endpoint rejects malformed paths.
  }
  cleaned = cleaned.split("#", 1)[0].split("?", 1)[0].replaceAll("\\", "/");
  cleaned = cleaned.replace(/^(?:\.\/)+/, "");
  const lowered = cleaned.toLowerCase();
  const imageMarker = lowered.lastIndexOf("/images/");
  if (imageMarker >= 0) return `images/${cleaned.slice(imageMarker + 8)}`;
  return lowered.startsWith("images/") ? `images/${cleaned.slice(7)}` : cleaned;
}

function renderMarkdown(source: string, paperId: string, citationLinks: CitationLink[]) {
  const code: string[] = [];
  const math: Array<{ html: string; display: boolean }> = [];
  let prepared = injectCitationLinks(source, citationLinks)
    .replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\r\n]+`)/g, (segment) => {
    const token = `PGRCODETOKEN${code.length}ENDTOKEN`;
    code.push(segment);
    return token;
  });
  const mathToken = (formula: string, display: boolean) => {
    const index = math.length;
    const normalized = formula.trim();
    let html: string;
    try {
      html = katex.renderToString(normalized, {
        displayMode: display,
        throwOnError: false,
        strict: false,
      });
    } catch {
      const fallbackClass = display
        ? "math-fallback math-fallback-block"
        : "math-fallback";
      html = `<code class="${fallbackClass}">${escapeHtml(normalized)}</code>`;
    }
    math.push({
      display,
      html,
    });
    return display
      ? `\n\n<div data-paper-math="${index}"></div>\n\n`
      : `<span data-paper-math="${index}"></span>`;
  };
  prepared = prepared
    .replace(/^[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*$/gm, (_, formula: string) => mathToken(formula, true))
    .replace(/^[ \t]*\$\$([^\r\n]+?)\$\$[ \t]*$/gm, (_, formula: string) => mathToken(formula, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, formula: string) => mathToken(formula, true))
    .replace(/\\\((.+?)\\\)/g, (_, formula: string) => mathToken(formula, false))
    .replace(/(?<!\\)\$([^$\r\n]+?)(?<!\\)\$/g, (_, formula: string) => mathToken(formula, false));
  code.forEach((segment, index) => {
    prepared = prepared.replace(`PGRCODETOKEN${index}ENDTOKEN`, segment);
  });
  const renderer = new marked.Renderer();
  let headingIndex = 0;
  renderer.heading = ({ tokens, depth }) =>
    `<h${depth} id="${headingId(headingIndex++)}">${renderer.parser.parseInline(tokens)}</h${depth}>`;
  renderer.image = ({ href, text }) => {
    const external = /^(https?:|data:|blob:)/i.test(href);
    const cleaned = normalizePaperAssetPath(href);
    const src = external
      ? href
      : `/api/v1/papers/${encodeURIComponent(paperId)}/asset?path=${encodeURIComponent(cleaned)}`;
    return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(text)}" loading="lazy">`;
  };
  renderer.link = ({ href, text }) =>
    /^(https?:|mailto:)/i.test(href)
      ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${text}</a>`
      : `<a href="${escapeAttribute(href)}">${text}</a>`;
  let raw = marked.parse(prepared, { renderer, gfm: true, breaks: true }) as string;
  math.forEach(({ html, display }, index) => {
    const placeholder = display
      ? `<div data-paper-math="${index}"></div>`
      : `<span data-paper-math="${index}"></span>`;
    raw = raw.replaceAll(
      placeholder,
      display ? `<div class="math-block">${html}</div>` : html,
    );
  });
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel", "loading", "id", "type", "aria-label", "data-citation-id"],
  });
}

function textNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const result: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.data.length;
    result.push({ node, start: offset, end: offset + length });
    offset += length;
  }
  return result;
}

function locateByQuote(root: HTMLElement, highlight: Highlight) {
  const text = root.textContent || "";
  const expected = highlight.start_offset ?? -1;
  if (
    expected >= 0 &&
    text.slice(expected, highlight.end_offset ?? expected + highlight.quote.length) === highlight.quote
  ) {
    return { start: expected, end: highlight.end_offset ?? expected + highlight.quote.length };
  }
  const candidates: number[] = [];
  let cursor = text.indexOf(highlight.quote);
  while (cursor >= 0) {
    candidates.push(cursor);
    cursor = text.indexOf(highlight.quote, cursor + 1);
  }
  if (!candidates.length) return null;
  const start = candidates.find((value) => {
    const prefix = highlight.prefix || "";
    const suffix = highlight.suffix || "";
    return (
      (!prefix || text.slice(Math.max(0, value - prefix.length), value) === prefix) &&
      (!suffix || text.slice(value + highlight.quote.length, value + highlight.quote.length + suffix.length) === suffix)
    );
  }) ?? candidates[0];
  return { start, end: start + highlight.quote.length };
}

function applyHighlights(root: HTMLElement, highlights: Highlight[]) {
  const ranges = highlights
    .map((highlight) => ({ highlight, located: locateByQuote(root, highlight) }))
    .filter((item): item is { highlight: Highlight; located: { start: number; end: number } } => Boolean(item.located))
    .sort((left, right) => right.located.start - left.located.start);
  for (const { highlight, located } of ranges) {
    const nodes = textNodes(root);
    const color = highlight.color || "yellow";
    const covered = nodes
      .filter((item) => item.end > located.start && item.start < located.end)
      .reverse();
    for (const item of covered) {
      const localStart = Math.max(0, located.start - item.start);
      const localEnd = Math.min(item.node.data.length, located.end - item.start);
      if (localEnd <= localStart) continue;
      const range = document.createRange();
      range.setStart(item.node, localStart);
      range.setEnd(item.node, localEnd);
      const mark = document.createElement("mark");
      mark.className = `paper-highlight highlight-${color}`;
      mark.dataset.annotationId = highlight.annotation_id;
      mark.dataset.highlightColor = color;
      range.surroundContents(mark);
    }
  }
}

type CitationPopover = {
  link: CitationLink;
  x: number;
  y: number;
};

function MarkdownPreview({
  source,
  paperId,
  highlights = [],
  citationLinks = [],
  onCitationSelect,
}: Props) {
  const html = useMemo(
    () => renderMarkdown(source, paperId, citationLinks),
    [citationLinks, paperId, source],
  );
  const root = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const [popover, setPopover] = useState<CitationPopover>();
  const linksById = useMemo(
    () => new Map(citationLinks.map((link) => [link.citation_id, link])),
    [citationLinks],
  );

  const clearTimers = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const citationFromTarget = (target: EventTarget | null) => {
    const element = target instanceof Element
      ? target.closest<HTMLElement>("[data-citation-id]")
      : null;
    const id = element?.dataset.citationId;
    return id ? { element, link: linksById.get(id) } : undefined;
  };

  const positionPopover = (element: HTMLElement, link: CitationLink) => {
    const rect = element.getBoundingClientRect();
    setPopover({
      link,
      x: Math.min(Math.max(12, rect.left), window.innerWidth - 350),
      y: Math.min(rect.bottom + 9, window.innerHeight - 170),
    });
  };

  const onMouseOver = (event: MouseEvent<HTMLDivElement>) => {
    const citation = citationFromTarget(event.target);
    if (!citation?.link || !citation.element) return;
    clearTimers();
    hoverTimer.current = window.setTimeout(
      () => positionPopover(citation.element!, citation.link!),
      1_000,
    );
  };

  const onMouseOut = (event: MouseEvent<HTMLDivElement>) => {
    if (!citationFromTarget(event.target)) return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => setPopover(undefined), 160);
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const citation = citationFromTarget(event.target);
    if (!citation?.link || !citation.element) return;
    event.preventDefault();
    event.stopPropagation();
    if (citation.link.targets.length === 1) {
      onCitationSelect?.(citation.link.targets[0]);
      setPopover(undefined);
      return;
    }
    positionPopover(citation.element, citation.link);
  };

  useEffect(() => {
    if (root.current) applyHighlights(root.current, highlights);
  }, [highlights, html]);
  useEffect(() => () => clearTimers(), []);
  return (
    <div className="markdown-preview-shell">
      <div
        className="markdown-preview"
        ref={root}
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {popover && (
        <aside
          className="citation-popover"
          style={{ left: popover.x, top: popover.y }}
          onMouseEnter={clearTimers}
          onMouseLeave={() => {
            closeTimer.current = window.setTimeout(() => setPopover(undefined), 120);
          }}
          aria-label="인용 논문"
        >
          <span className="citation-popover-label">CITED PAPER</span>
          {popover.link.targets.map((target) => (
            <button
              key={`${popover.link.citation_id}:${target.paper_id}`}
              type="button"
              onClick={() => {
                onCitationSelect?.(target);
                setPopover(undefined);
              }}
            >
              <strong>{target.title}</strong>
              <small>
                {target.year || "연도 미상"}
                {" · "}
                {target.availability === "METADATA_ONLY" ? "메타데이터" : "PDF"}
              </small>
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}

export default memo(MarkdownPreview);
