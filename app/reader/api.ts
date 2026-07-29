export type Paper = {
  paper_id: string;
  title: string;
  abstract?: string;
  abstract_ko?: string;
  year?: number;
  authors?: string[];
  venue?: string;
  doi?: string;
  arxiv_id?: string;
  status: string;
  availability?: "FULLTEXT" | "METADATA_ONLY";
  active_library?: boolean;
  is_library_root?: boolean;
  promotion_state?: string;
  pdf_available?: boolean;
  sections?: Array<{
    section_id: string;
    title: string;
    level: number;
    order: number;
  }>;
};

export type LibraryChild = Pick<
  Paper,
  "paper_id" | "title" | "year" | "authors" | "status" | "availability" | "is_library_root" | "promotion_state" | "pdf_available"
> & {
  reference_number: number;
  reference_id: string;
};

export type LibraryRoot = {
  paper: Paper;
  children: LibraryChild[];
};

export type ProcessingJob = {
  job_id: string;
  paper_id: string;
  job_type: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage?: string;
  progress?: number;
  completed_items?: number;
  total_items?: number;
  message?: string;
  error_message?: string;
  warnings?: string[];
  warnings_json?: string;
};

export type LibraryTree = {
  roots: LibraryRoot[];
  active_jobs: ProcessingJob[];
};

export type CitationContext = {
  citation_context_id: string;
  text: string;
  text_ko?: string;
  marker?: string;
  section_id?: string;
};

export type CitationTarget = {
  paper_id: string;
  title: string;
  year?: number;
  availability?: "FULLTEXT" | "METADATA_ONLY";
  reference_id?: string;
  reference_number?: number;
};

export type CitationLink = {
  citation_id: string;
  identity: string;
  marker: string;
  start_offset: number;
  end_offset: number;
  targets: CitationTarget[];
  confidence: number;
  resolution: string;
};

export type CitationLinkMap = {
  language: "ko" | "en";
  canonical_language: "en";
  links: CitationLink[];
  english_detected_count: number;
  english_linked_count: number;
  projected_count: number | null;
};

export type ChildDetail = {
  parent: Paper;
  child: Paper;
  reference: {
    number?: number;
    title?: string;
    summary?: string;
    status?: string;
  };
  citation: {
    relationship_summary_ko?: string;
    relationship_uncertainty?: string;
    relationship_mode?: "CITATION_CONTEXT" | "KEYWORD_SIMILARITY";
    relationship_evidence_ko?: string;
    relationship_connection_ko?: string;
    relationship_keyword_matches?: Array<{
      child_keyword_en: string;
      child_keyword_ko: string;
      parent_keyword_en: string;
      reason_ko: string;
      similarity: number;
    }>;
  };
  contexts: CitationContext[];
  domains: Array<{ name: string; name_en?: string; confidence?: number }>;
  related_papers: Array<{ paper_id: string; title: string; year?: number; score?: number }>;
};

export type HighlightColor = "yellow" | "red" | "blue";

export type Highlight = {
  annotation_id: string;
  paper_id: string;
  annotation_type: "HIGHLIGHT";
  color: HighlightColor;
  language: "ko" | "en";
  quote: string;
  start_offset?: number;
  end_offset?: number;
  prefix?: string;
  suffix?: string;
  source_hash?: string;
  section_id?: string;
  created_at?: string;
};

export type Health = {
  status: "ok" | "degraded";
  neo4j: string;
  models: Record<string, string>;
  generation?: number;
  updated_at?: string;
};

const API = "/api/v1";
const API_TIMEOUT_MS = 12_000;

function requestSignal(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, {
      ...init,
      signal: requestSignal(init?.signal),
    });
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.reload();
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("배포 사이트의 응답 시간이 초과되었습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    throw error;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API}${path}`, {
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string };
    } | null;
    const error = new Error(data?.error?.message ?? `요청 실패 (${response.status})`);
    Object.assign(error, { code: data?.error?.code, status: response.status });
    throw error;
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: async () => {
    const response = await apiFetch(`${API}/health`);
    const body = await response.json().catch(() => null) as Health | null;
    if (!body || !["ok", "degraded"].includes(body.status)) {
      throw new Error("상태 응답을 확인하지 못했습니다.");
    }
    return body as Health;
  },
  tree: () => request<LibraryTree>("/library/tree"),
  paper: (paperId: string) => request<Paper>(`/papers/${encodeURIComponent(paperId)}`),
  child: (parentId: string, childId: string) =>
    request<ChildDetail>(
      `/library/parents/${encodeURIComponent(parentId)}/children/${encodeURIComponent(childId)}`,
    ),
  content: async (paperId: string, language: "ko" | "en") => {
    const response = await apiFetch(
      `${API}/papers/${encodeURIComponent(paperId)}/content?language=${language}`,
    );
    if (!response.ok) throw new Error("논문 본문을 불러오지 못했습니다.");
    return response.text();
  },
  pdfUrl: (paperId: string) =>
    `${API}/papers/${encodeURIComponent(paperId)}/pdf`,
  citationLinks: (paperId: string, language: "ko" | "en") =>
    request<CitationLinkMap>(
      `/papers/${encodeURIComponent(paperId)}/citation-links?language=${language}`,
    ),
  highlights: (paperId: string) =>
    request<{ items: Highlight[] }>(
      `/papers/${encodeURIComponent(paperId)}/annotations`,
    ),
};
