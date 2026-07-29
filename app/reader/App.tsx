import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CSSProperties,
  PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  Highlight,
  HighlightColor,
  LibraryChild,
  LibraryRoot,
} from "./api";
import ReaderPane, { PaneDocumentState } from "./ReaderPane";
import { PaneId, ReaderView, useUiStore } from "./store";

const highlightOptions: Array<{ color: HighlightColor; label: string }> = [
  { color: "yellow", label: "노란색" },
  { color: "red", label: "빨간색" },
  { color: "blue", label: "파란색" },
];

const highlightColorHex: Record<HighlightColor, string> = {
  yellow: "#e5c84c",
  red: "#e36b67",
  blue: "#62a8e8",
};

function StatusPill({ value }: { value?: string }) {
  const text = value || "UNKNOWN";
  return <span className={`status-pill status-${text.toLowerCase()}`}>{text}</span>;
}

function ChildRow({
  child,
  selected,
  onSelect,
}: {
  child: LibraryChild;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`child-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span className="reference-number">{String(child.reference_number).padStart(2, "0")}</span>
      <span className="child-copy">
        <strong>{child.title}</strong>
        <small>
          {child.year || "연도 미상"}
          <span className={`availability ${child.availability === "METADATA_ONLY" ? "metadata" : ""}`}>
            {child.pdf_available ? "PDF" : "메타데이터"}
          </span>
          {child.is_library_root && <span className="root-mini">상위</span>}
        </small>
      </span>
    </button>
  );
}

function viewIsValid(view: ReaderView, roots: LibraryRoot[]) {
  if (view.kind === "parent") {
    return roots.some((root) => root.paper.paper_id === view.paperId);
  }
  if (view.kind === "child") {
    return roots.some(
      (root) => root.paper.paper_id === view.parentId
        && root.children.some((child) => child.paper_id === view.paperId),
    );
  }
  return roots.some(
    (root) => (root.paper.paper_id === view.paperId && root.paper.pdf_available)
      || root.children.some((child) => child.paper_id === view.paperId && child.pdf_available),
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const {
    primaryPane,
    secondaryPane,
    paneHistory,
    splitRatio,
    focusedPane,
    panel,
    openView,
    setPaneView,
    replacePaneView,
    setFocusedPane,
    goBack,
    goForward,
    setSplitRatio,
    toggleSplit,
    closeSplit,
    setPanel,
  } = useUiStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");
  const [paneStates, setPaneStates] = useState<Partial<Record<PaneId, PaneDocumentState>>>({});
  const readerRefs = useRef<Record<PaneId, HTMLElement | null>>({
    primary: null,
    secondary: null,
  });
  const documentGridRef = useRef<HTMLDivElement>(null);
  const [splitStacked, setSplitStacked] = useState(false);
  const [resizingSplit, setResizingSplit] = useState(false);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    retry: 1,
    refetchInterval: 10_000,
  });
  const tree = useQuery({
    queryKey: ["library-tree"],
    queryFn: api.tree,
    retry: 1,
    refetchInterval: (query) => {
      if (query.state.status === "error") return 5_000;
      return query.state.data?.active_jobs.length ? 2_000 : false;
    },
  });
  const focusedView = focusedPane === "secondary" && secondaryPane ? secondaryPane : primaryPane;
  const focusedState = paneStates[focusedPane];
  const focusedParent = focusedView?.kind === "parent" ? focusedView : null;
  const focusedHighlightsQuery = useQuery({
    queryKey: ["highlights", focusedParent?.paperId || ""],
    queryFn: () => api.highlights(focusedParent?.paperId || ""),
    enabled: Boolean(focusedParent),
  });
  const visibleHighlights = useMemo(
    () => focusedParent
      ? (focusedHighlightsQuery.data?.items || []).filter(
          (item) => item.language === focusedParent.language,
        )
      : [],
    [focusedHighlightsQuery.data?.items, focusedParent],
  );
  const highlightCounts = useMemo(
    () => visibleHighlights.reduce(
      (counts, item) => {
        counts[item.color || "yellow"] += 1;
        return counts;
      },
      { yellow: 0, red: 0, blue: 0 } as Record<HighlightColor, number>,
    ),
    [visibleHighlights],
  );

  const filteredRoots = useMemo(() => {
    const roots = tree.data?.roots || [];
    const needle = searchText.trim().toLocaleLowerCase();
    if (!needle) return roots;
    return roots
      .map((root) => ({
        ...root,
        children: root.children.filter((child) => child.title.toLocaleLowerCase().includes(needle)),
      }))
      .filter((root) => root.paper.title.toLocaleLowerCase().includes(needle) || root.children.length);
  }, [searchText, tree.data?.roots]);
  const processingIds = useMemo(
    () => new Set((tree.data?.active_jobs || []).map((job) => job.paper_id)),
    [tree.data?.active_jobs],
  );

  useEffect(() => {
    const roots = tree.data?.roots;
    if (!roots?.length) return;
    const fallback: ReaderView = {
      kind: "parent",
      paperId: roots[0].paper.paper_id,
      language: "ko",
    };
    if (!primaryPane || !viewIsValid(primaryPane, roots)) {
      replacePaneView("primary", fallback);
    }
    if (secondaryPane && !viewIsValid(secondaryPane, roots)) closeSplit();
  }, [closeSplit, primaryPane, replacePaneView, secondaryPane, tree.data?.roots]);

  useEffect(() => {
    if (health.data?.status !== "ok") return;
    void queryClient.invalidateQueries({
      predicate: (query) => (
        query.state.status === "error"
        && ["library-tree", "paper", "content", "child", "citation-links", "highlights"]
          .includes(String(query.queryKey[0] || ""))
      ),
    });
  }, [health.data?.status, queryClient]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (primaryPane) toggleSplit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [primaryPane, toggleSplit]);

  useEffect(() => {
    const grid = documentGridRef.current;
    if (!grid) return;
    const updateDirection = () => setSplitStacked(grid.clientWidth <= 760);
    updateDirection();
    const observer = new ResizeObserver(updateDirection);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [secondaryPane]);

  const selectRoot = (root: LibraryRoot) => {
    const language = focusedView?.kind === "parent" && focusedView.paperId === root.paper.paper_id
      ? focusedView.language
      : "ko";
    openView({ kind: "parent", paperId: root.paper.paper_id, language });
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(root.paper.paper_id)) next.delete(root.paper.paper_id);
      else next.add(root.paper.paper_id);
      return next;
    });
  };

  const resizeSplit = (event: PointerEvent<HTMLDivElement>) => {
    const grid = documentGridRef.current;
    if (!grid) return;
    const bounds = grid.getBoundingClientRect();
    const position = splitStacked
      ? event.clientY - bounds.top
      : event.clientX - bounds.left;
    const total = splitStacked ? bounds.height : bounds.width;
    if (total > 0) setSplitRatio((position / total) * 100);
  };

  const onSplitPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSplit(true);
    resizeSplit(event);
  };

  const onSplitPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizingSplit || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizeSplit(event);
  };

  const onSplitPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingSplit(false);
  };

  const updatePaneState = useCallback((pane: PaneId, state: PaneDocumentState) => {
    setPaneStates((current) => ({ ...current, [pane]: state }));
  }, []);
  const registerReader = useCallback((pane: PaneId, element: HTMLElement | null) => {
    readerRefs.current[pane] = element;
  }, []);
  const updatePrimaryState = useCallback(
    (state: PaneDocumentState) => updatePaneState("primary", state),
    [updatePaneState],
  );
  const updateSecondaryState = useCallback(
    (state: PaneDocumentState) => updatePaneState("secondary", state),
    [updatePaneState],
  );
  const registerPrimaryReader = useCallback(
    (element: HTMLElement | null) => registerReader("primary", element),
    [registerReader],
  );
  const registerSecondaryReader = useCallback(
    (element: HTMLElement | null) => registerReader("secondary", element),
    [registerReader],
  );
  const navigatePrimary = useCallback(
    (view: ReaderView) => setPaneView("primary", view),
    [setPaneView],
  );
  const navigateSecondary = useCallback(
    (view: ReaderView) => setPaneView("secondary", view),
    [setPaneView],
  );
  const focusPrimary = useCallback(() => setFocusedPane("primary"), [setFocusedPane]);
  const focusSecondary = useCallback(() => setFocusedPane("secondary"), [setFocusedPane]);
  const expandParent = useCallback(
    (paperId: string) => setExpanded((current) => new Set(current).add(paperId)),
    [],
  );
  const backPrimary = useCallback(() => goBack("primary"), [goBack]);
  const backSecondary = useCallback(() => goBack("secondary"), [goBack]);
  const forwardPrimary = useCallback(() => goForward("primary"), [goForward]);
  const forwardSecondary = useCallback(() => goForward("secondary"), [goForward]);

  const scrollToHighlight = (highlight: Highlight) => {
    const mark = readerRefs.current[focusedPane]?.querySelector<HTMLElement>(
      `[data-annotation-id="${CSS.escape(highlight.annotation_id)}"]`,
    );
    mark?.scrollIntoView({ behavior: "smooth", block: "center" });
    mark?.animate(
      [
        { outlineColor: "transparent" },
        { outlineColor: highlightColorHex[highlight.color || "yellow"] },
        { outlineColor: "transparent" },
      ],
      { duration: 1_200 },
    );
  };

  const renderPane = (paneId: PaneId, view: ReaderView, closable = false) => (
    <ReaderPane
      focused={focusedPane === paneId}
      canGoBack={paneHistory[paneId].back.length > 0}
      canGoForward={paneHistory[paneId].forward.length > 0}
      isProcessing={processingIds.has(view.paperId)}
      key={paneId}
      onClose={closable ? closeSplit : undefined}
      onDocumentState={paneId === "primary" ? updatePrimaryState : updateSecondaryState}
      onExpandParent={expandParent}
      onFocus={paneId === "primary" ? focusPrimary : focusSecondary}
      onBack={paneId === "primary" ? backPrimary : backSecondary}
      onForward={paneId === "primary" ? forwardPrimary : forwardSecondary}
      onNavigate={paneId === "primary" ? navigatePrimary : navigateSecondary}
      onReaderRef={paneId === "primary" ? registerPrimaryReader : registerSecondaryReader}
      paneId={paneId}
      view={view}
    />
  );

  return (
    <div className="app-shell">
      <aside className="library-panel">
        <div className="brand">
          <div className="brand-mark">P<span>G</span></div>
          <div><strong>Paper Graph</strong></div>
          <button
            className="logout-button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
              window.location.reload();
            }}
            title="로그아웃"
            aria-label="로그아웃"
          >
            ↪
          </button>
        </div>
        <div className="system-line">
          <span className={`health-dot ${health.data?.status || "loading"}`} />
          <span>{health.isError ? "연결 확인 필요" : health.data?.status === "ok" ? "시스템 준비" : "제한 모드"}</span>
          <small title={health.data?.updated_at || ""}>
            {health.data?.updated_at
              ? `동기화 ${new Date(health.data.updated_at).toLocaleString("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "동기화 대기"}
          </small>
        </div>
        <div className="search-box">
          <span>⌕</span>
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="상위·참조 논문 검색" />
          {searchText && <button onClick={() => setSearchText("")}>×</button>}
        </div>
        <div className="library-heading"><span>LIBRARY STACK</span><span>{filteredRoots.length}</span></div>
        <nav className="library-tree" aria-label="계층형 논문 라이브러리">
          {tree.isError && !tree.data && (
            <div className="library-error" role="alert">
              <strong>라이브러리에 연결할 수 없습니다.</strong>
              <span>배포 사이트 연결을 확인한 뒤 다시 시도해 주세요.</span>
              <button onClick={() => void tree.refetch()}>다시 시도</button>
            </div>
          )}
          {filteredRoots.map((root) => {
            const isExpanded = expanded.has(root.paper.paper_id) || Boolean(searchText);
            const rootSelected = focusedView?.paperId === root.paper.paper_id;
            return (
              <section className="root-group" key={root.paper.paper_id}>
                <button
                  className={`root-row ${rootSelected ? "selected" : ""}`}
                  onClick={() => selectRoot(root)}
                >
                  <span className={`chevron ${isExpanded ? "open" : ""}`}>›</span>
                  <span className="root-copy">
                    <strong>{root.paper.title}</strong>
                    <small>{root.children.length} references · {root.paper.year || "연도 미상"}</small>
                  </span>
                  <StatusPill value={root.paper.promotion_state || root.paper.status} />
                </button>
                {isExpanded && (
                  <div className="children-list">
                    {root.children.map((child) => (
                      <ChildRow
                        child={child}
                        key={`${root.paper.paper_id}:${child.paper_id}`}
                        onSelect={() => openView({
                          kind: "child",
                          parentId: root.paper.paper_id,
                          paperId: child.paper_id,
                        })}
                        selected={focusedView?.paperId === child.paper_id && focusedView.kind !== "parent"}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {!tree.isError && !filteredRoots.length && (
            <div className="empty-panel">
              {tree.isLoading ? "라이브러리를 불러오는 중…" : "표시할 상위 논문이 없습니다."}
            </div>
          )}
        </nav>
      </aside>

      <main className="reader-column">
        <div className="workspace-toolbar">
          <div>
            <span className="workspace-label">READER WORKSPACE</span>
            <span>{secondaryPane ? "2 PANES" : "1 PANE"}</span>
          </div>
          <button
            aria-label={secondaryPane ? "분할 닫기" : "오른쪽으로 분할"}
            className={secondaryPane ? "active" : ""}
            disabled={!primaryPane}
            onClick={toggleSplit}
            title={`${secondaryPane ? "분할 닫기" : "오른쪽으로 분할"} (Ctrl + R)`}
          >
            <i className="split-view-icon"><b /><b /></i>
            <span>{secondaryPane ? "분할 닫기" : "분할"}</span>
            <kbd>Ctrl R</kbd>
          </button>
        </div>
        {primaryPane ? (
          <div
            className={`document-grid ${secondaryPane ? "split" : ""} ${resizingSplit ? "resizing" : ""}`}
            ref={documentGridRef}
            style={{
              "--split-primary": `${splitRatio}%`,
              "--split-secondary": `${100 - splitRatio}%`,
            } as CSSProperties}
          >
            {renderPane("primary", primaryPane)}
            {secondaryPane && (
              <>
                <div
                  aria-label="분할 화면 크기 조절"
                  aria-orientation={splitStacked ? "horizontal" : "vertical"}
                  aria-valuemax={80}
                  aria-valuemin={20}
                  aria-valuenow={Math.round(splitRatio)}
                  className="split-divider"
                  onDoubleClick={() => setSplitRatio(50)}
                  onKeyDown={(event) => {
                    const decrement = splitStacked ? event.key === "ArrowUp" : event.key === "ArrowLeft";
                    const increment = splitStacked ? event.key === "ArrowDown" : event.key === "ArrowRight";
                    if (decrement || increment) {
                      event.preventDefault();
                      setSplitRatio(splitRatio + (increment ? 2 : -2));
                    }
                    if (event.key === "Home") {
                      event.preventDefault();
                      setSplitRatio(50);
                    }
                  }}
                  onPointerCancel={onSplitPointerUp}
                  onPointerDown={onSplitPointerDown}
                  onPointerMove={onSplitPointerMove}
                  onPointerUp={onSplitPointerUp}
                  role="separator"
                  tabIndex={0}
                  title="드래그하여 창 크기 조절 · 더블클릭하면 50:50"
                >
                  <i />
                </div>
                {renderPane("secondary", secondaryPane, true)}
              </>
            )}
          </div>
        ) : (
          <div className="welcome"><span>PG</span><h1>상위 논문에서<br />연구의 계보를 펼치세요.</h1></div>
        )}
      </main>

      <aside className="context-panel">
        <div className="panel-tabs">
          <button className={panel === "outline" ? "active" : ""} onClick={() => setPanel("outline")}><span>¶</span>목차</button>
          <button className={panel === "highlights" ? "active" : ""} onClick={() => setPanel("highlights")}><span>▰</span>하이라이트</button>
        </div>
        <div className="panel-content">
          {panel === "outline" && (
            <>
              <div className="panel-title">
                <div><span className="eyebrow">DOCUMENT MAP</span><h2>목차</h2></div>
                <span>{focusedState?.headings.length || 0}</span>
              </div>
              {focusedParent ? (
                <nav className="outline-list">
                  {(focusedState?.headings || []).map((heading, index) => (
                    <button
                      className={`${focusedState?.activeHeading === heading.id ? "active" : ""} level-${heading.level}`}
                      key={heading.id}
                      onClick={() => readerRefs.current[focusedPane]
                        ?.querySelector(`#${CSS.escape(heading.id)}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>{heading.text}
                    </button>
                  ))}
                  {!focusedState?.headings.length && <div className="empty-panel">본문 목차가 없습니다.</div>}
                </nav>
              ) : (
                <div className="empty-panel">
                  {focusedView?.kind === "pdf"
                    ? "PDF에서는 내장 목차를 사용해 주세요."
                    : "하위 논문 상세에서는 목차를 사용하지 않습니다."}
                </div>
              )}
            </>
          )}
          {panel === "highlights" && (
            <>
              <div className="panel-title">
                <div><span className="eyebrow">READING MARKS</span><h2>하이라이트</h2></div>
                <span>{visibleHighlights.length}</span>
              </div>
              {focusedParent ? (
                <>
                  <div className="highlight-color-summary" aria-label="색상별 하이라이트 수">
                    {highlightOptions.map(({ color, label }) => (
                      <span className={`highlight-${color}`} key={color}>
                        <i />{label} {highlightCounts[color]}
                      </span>
                    ))}
                  </div>
                  <div className="highlight-list">
                    {visibleHighlights.map((highlight) => (
                      <article className={`highlight-card highlight-${highlight.color || "yellow"}`} key={highlight.annotation_id}>
                        <button onClick={() => scrollToHighlight(highlight)}><span>“</span>{highlight.quote}</button>
                        <div>
                          <small><i />{highlightOptions.find((item) => item.color === (highlight.color || "yellow"))?.label} · {highlight.language === "ko" ? "한국어" : "English"}</small>
                        </div>
                      </article>
                    ))}
                    {!visibleHighlights.length && <div className="empty-panel">본문을 드래그한 뒤 우클릭해 첫 하이라이트를 남겨보세요.</div>}
                  </div>
                </>
              ) : (
                <div className="empty-panel">상위 논문 전문에서 하이라이트를 사용할 수 있습니다.</div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
