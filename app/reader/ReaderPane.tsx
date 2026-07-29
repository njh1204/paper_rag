import { useQuery } from "@tanstack/react-query";
import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  Paper,
} from "./api";
import MarkdownPreview from "./MarkdownPreview";
import { extractMarkdownHeadings, MarkdownHeading } from "./markdown";
import { PaneId, ReaderView } from "./store";

export type PaneDocumentState = {
  view: ReaderView;
  headings: MarkdownHeading[];
  activeHeading: string;
  paper?: Paper;
};

function ScrollIcon({ direction }: { direction: "up" | "down" }) {
  const points = direction === "up" ? "5 15 12 8 19 15" : "5 9 12 16 19 9";
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function ScrollControls({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  return (
    <div className="pane-scroll-controls" aria-label="문서 스크롤 이동">
      <button
        aria-label="맨 위로"
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        title="맨 위로"
      >
        <ScrollIcon direction="up" />
      </button>
      <button
        aria-label="맨 아래로"
        onClick={() => scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight || 0,
          behavior: "smooth",
        })}
        title="맨 아래로"
      >
        <ScrollIcon direction="down" />
      </button>
    </div>
  );
}

function LoadError({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  return (
    <div className="load-error" role="alert">
      <strong>{title}</strong>
      <span>배포 사이트 연결을 확인한 뒤 다시 시도해 주세요.</span>
      <button onClick={onRetry}>다시 시도</button>
    </div>
  );
}

function ChildDetail({
  parentId,
  childId,
  onNavigate,
}: {
  parentId: string;
  childId: string;
  onNavigate: (view: ReaderView) => void;
}) {
  const detail = useQuery({
    queryKey: ["child", parentId, childId],
    queryFn: () => api.child(parentId, childId),
    retry: 1,
    refetchInterval: (query) => query.state.status === "error" ? 5_000 : false,
  });

  if (detail.isLoading) return <div className="reader-loading">참조 관계를 불러오는 중…</div>;
  if (detail.error || !detail.data) {
    return (
      <LoadError
        title="참조 논문 정보를 불러오지 못했습니다."
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const data = detail.data;
  return (
    <article className="child-detail">
      <header className="child-hero">
        <div className="paper-kicker">
          <span>REFERENCE {String(data.reference.number || "").padStart(2, "0")}</span>
          <span
            title={`같은 논문은 모든 상위 논문에서 이 ID를 공유합니다: ${data.child.paper_id}`}
          >
            {data.child.doi
              ? `DOI ${data.child.doi}`
              : data.child.arxiv_id
                ? `ARXIV ${data.child.arxiv_id}`
                : `ID ${data.child.paper_id.slice(0, 16)}`}
          </span>
          <span>{data.child.year || "연도 미상"}</span>
          <span>{data.child.availability === "METADATA_ONLY" ? "메타데이터만" : "PDF 확보"}</span>
        </div>
        <h1>{data.child.title}</h1>
        <p>{data.child.authors?.join(" · ") || "저자 정보 없음"}</p>
      </header>
      <section className="detail-section abstract-section">
        <span className="eyebrow">KOREAN ABSTRACT</span>
        <h2>한국어 초록</h2>
        <p>{data.child.abstract_ko || data.reference.summary || data.child.abstract || "공개 초록을 확보하지 못했습니다."}</p>
      </section>
      <section className="relationship-card">
        <span className="eyebrow">WHY CITED</span>
        <h2>왜 이 논문을 참고했을까?</h2>
        {data.citation.relationship_mode && (
          <div className="relationship-mode">
            부모별 관계 ·{" "}
            {data.citation.relationship_mode === "CITATION_CONTEXT"
              ? "확인된 인용 문장 기반"
              : "키워드 유사도 기반 · 인용 문장 미확인"}
          </div>
        )}
        <p className="relationship-lead">
          {data.citation.relationship_summary_ko
            || "관계 설명을 생성하고 있습니다. 오른쪽 아래 진행 상황을 확인해 주세요."}
        </p>
        {data.citation.relationship_evidence_ko && (
          <div className="relationship-block">
            <strong>판단 근거</strong>
            <p>{data.citation.relationship_evidence_ko}</p>
          </div>
        )}
        {!!data.citation.relationship_keyword_matches?.length && (
          <div className="relationship-keywords">
            {data.citation.relationship_keyword_matches.map((keyword) => (
              <span key={`${keyword.child_keyword_en}-${keyword.parent_keyword_en}`}>
                {keyword.child_keyword_ko || keyword.child_keyword_en}
                <small>{Math.round(keyword.similarity * 100)}%</small>
              </span>
            ))}
          </div>
        )}
        {data.citation.relationship_connection_ko && (
          <div className="relationship-block">
            <strong>논문 간 연결</strong>
            <p>{data.citation.relationship_connection_ko}</p>
          </div>
        )}
        <small>{data.parent.title} → {data.child.title}</small>
      </section>
      <section className="detail-grid">
        <div className="detail-section">
          <span className="eyebrow">DOMAINS</span><h2>관련 도메인 Top 3</h2>
          <div className="domain-list">
            {data.domains.map((domain, index) => (
              <div key={`${domain.name}-${index}`}><span>0{index + 1}</span><strong>{domain.name}</strong><small>{domain.name_en}</small></div>
            ))}
            {!data.domains.length && <p className="muted-copy">도메인을 분석하고 있습니다.</p>}
          </div>
        </div>
        <div className="detail-section">
          <span className="eyebrow">RELATED PAPERS</span><h2>관련 논문 Top 3</h2>
          <div className="related-list">
            {data.related_papers.map((related, index) => (
              <button
                key={related.paper_id}
                onClick={() => onNavigate({ kind: "child", parentId, paperId: related.paper_id })}
              >
                <span>0{index + 1}</span><strong>{related.title}</strong><small>{related.year || "—"} · {Math.round((related.score || 0) * 100)}%</small>
              </button>
            ))}
            {!data.related_papers.length && <p className="muted-copy">관련 논문을 계산하고 있습니다.</p>}
          </div>
        </div>
      </section>
    </article>
  );
}

export default function ReaderPane({
  paneId,
  view,
  focused,
  isProcessing,
  onFocus,
  onClose,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigate,
  onExpandParent,
  onDocumentState,
  onReaderRef,
}: {
  paneId: PaneId;
  view: ReaderView;
  focused: boolean;
  isProcessing: boolean;
  onFocus: () => void;
  onClose?: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (view: ReaderView) => void;
  onExpandParent: (paperId: string) => void;
  onDocumentState: (state: PaneDocumentState) => void;
  onReaderRef: (element: HTMLElement | null) => void;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const [activeHeading, setActiveHeading] = useState("");
  const isParent = view.kind === "parent";
  const isPdf = view.kind === "pdf";

  const paper = useQuery({
    queryKey: ["paper", view.paperId],
    queryFn: () => api.paper(view.paperId),
    enabled: true,
    retry: 1,
    refetchInterval: (query) => {
      if (query.state.status === "error") return 5_000;
      return isProcessing ? 2_000 : false;
    },
  });
  const content = useQuery({
    queryKey: ["content", view.paperId, isParent ? view.language : ""],
    queryFn: () => api.content(view.paperId, isParent ? view.language : "ko"),
    enabled: isParent,
    retry: isProcessing ? 3 : 1,
    refetchInterval: (query) => {
      if (query.state.status === "error") return 5_000;
      return isProcessing ? 2_000 : false;
    },
  });
  const citationLinks = useQuery({
    queryKey: ["citation-links", view.paperId, isParent ? view.language : ""],
    queryFn: () => api.citationLinks(view.paperId, isParent ? view.language : "ko"),
    enabled: isParent && Boolean(content.data),
    refetchInterval: isProcessing ? 2_000 : false,
  });
  const highlights = useQuery({
    queryKey: ["highlights", view.paperId],
    queryFn: () => api.highlights(view.paperId),
    enabled: isParent,
  });
  const headings = useMemo(
    () => isParent ? extractMarkdownHeadings(content.data || "") : [],
    [content.data, isParent],
  );
  const visibleHighlights = useMemo(
    () => isParent
      ? (highlights.data?.items || []).filter((item) => item.language === view.language)
      : [],
    [highlights.data?.items, isParent, view],
  );
  const handleCitationSelect = useCallback((target: { paper_id: string }) => {
    if (view.kind !== "parent") return;
    onExpandParent(view.paperId);
    onNavigate({ kind: "child", parentId: view.paperId, paperId: target.paper_id });
  }, [onExpandParent, onNavigate, view]);

  useEffect(() => {
    onReaderRef(readerRef.current);
    return () => onReaderRef(null);
  }, [onReaderRef, view]);

  useEffect(() => {
    setActiveHeading("");
    readerRef.current?.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    const root = readerRef.current;
    if (!isParent || !root || !content.data) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>(
      ".markdown-preview h1, .markdown-preview h2, .markdown-preview h3",
    ));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveHeading((visible.target as HTMLElement).id);
      },
      { root, rootMargin: "-10% 0px -72% 0px" },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [content.data, isParent]);

  useEffect(() => {
    onDocumentState({
      view,
      headings,
      activeHeading,
      paper: paper.data,
    });
  }, [activeHeading, headings, onDocumentState, paper.data, view]);

  const paneTitle = paper.data?.title || (paper.isError ? "논문 연결 오류" : "논문 불러오는 중");
  const paneType = isParent
    ? view.language === "ko" ? "한국어" : "ENGLISH"
    : isPdf ? "PDF" : "REFERENCE";

  return (
    <section
      className={`document-pane ${focused ? "focused" : ""}`}
      data-pane={paneId}
      onMouseDown={focused ? undefined : onFocus}
    >
      <header className="pane-bar">
        <nav className="pane-history-controls" aria-label="페이지 이동 기록">
          <button aria-label="페이지 뒤로가기" disabled={!canGoBack} onClick={onBack} title="뒤로">←</button>
          <button aria-label="페이지 앞으로가기" disabled={!canGoForward} onClick={onForward} title="앞으로">→</button>
        </nav>
        <span className="pane-type">{paneType}</span>
        <strong title={paneTitle}>{paneTitle}</strong>
        {isPdf && (
          <a
            className="pdf-external-link"
            href={api.pdfUrl(view.paperId)}
            onClick={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title="새 탭에서 PDF 열기"
          >
            ↗
          </a>
        )}
        {onClose && <button aria-label="분할 창 닫기" className="pane-close" onClick={onClose}>×</button>}
      </header>
      <div className="pane-content">
        {isParent && (
          <section className="reader-scroll" ref={readerRef}>
            <header className="reader-header">
              <div className="paper-kicker">
                <span>상위 논문</span><span>{paper.data?.venue || "LOCAL LIBRARY"}</span>
                <span>{paper.data?.year || "—"}</span>
              </div>
              <h1>
                {paper.data?.title || (paper.isError
                  ? "논문 정보를 불러오지 못했습니다."
                  : "논문을 불러오는 중…")}
              </h1>
              <p className="authors">{paper.data?.authors?.join(" · ") || "저자 정보 없음"}</p>
              <div className="reader-toolbar">
                <div className="language-switch">
                  <button
                    className={view.language === "ko" ? "active" : ""}
                    onClick={() => onNavigate({ ...view, language: "ko" })}
                  >
                    한국어
                  </button>
                  <button
                    className={view.language === "en" ? "active" : ""}
                    onClick={() => onNavigate({ ...view, language: "en" })}
                  >
                    English
                  </button>
                </div>
                <span>{activeHeading ? `§ ${activeHeading.replace("paper-heading-", "")}` : "TOP"}</span>
              </div>
            </header>
            {content.isLoading && <div className="reader-loading">본문을 불러오는 중…</div>}
            {content.error && (
              <LoadError
                title="본문을 불러오지 못했습니다."
                onRetry={() => {
                  void paper.refetch();
                  void content.refetch();
                }}
              />
            )}
            {content.data && (
              <MarkdownPreview
                source={content.data}
                paperId={view.paperId}
                highlights={visibleHighlights}
                citationLinks={citationLinks.data?.links || []}
                onCitationSelect={handleCitationSelect}
              />
            )}
          </section>
        )}
        {view.kind === "child" && (
          <section className="child-detail-scroll" ref={readerRef}>
            <ChildDetail parentId={view.parentId} childId={view.paperId} onNavigate={onNavigate} />
          </section>
        )}
        {isPdf && (
          <div className="pdf-pane">
            {paper.isLoading ? (
              <div className="reader-loading">PDF를 준비하는 중…</div>
            ) : paper.isError ? (
              <LoadError
                title="PDF 정보를 불러오지 못했습니다."
                onRetry={() => void paper.refetch()}
              />
            ) : paper.data?.pdf_available ? (
              <iframe
                className="pdf-viewer"
                src={`${api.pdfUrl(view.paperId)}#view=FitH`}
                title={`${paper.data.title} PDF`}
              />
            ) : (
              <div className="pdf-unavailable">
                <strong>PDF를 사용할 수 없습니다.</strong>
                <span>파일이 이동되었거나 메타데이터만 확보된 논문입니다.</span>
              </div>
            )}
          </div>
        )}
        {!isPdf && <ScrollControls scrollRef={readerRef} />}
      </div>
    </section>
  );
}
