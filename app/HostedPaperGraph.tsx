"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import PaperGraphApp from "./reader/App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
    mutations: { retry: 0 },
  },
});

export default function HostedPaperGraph() {
  const [status, setStatus] = useState<"loading" | "signed-out" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" })
      .then((response) => setStatus(response.ok ? "ready" : "signed-out"))
      .catch(() => setStatus("signed-out"));
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "로그인하지 못했습니다.");
      }
      setPassword("");
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") {
    return <div className="auth-screen"><div className="auth-card"><span className="auth-mark">PG</span><p>라이브러리를 확인하는 중…</p></div></div>;
  }

  if (status === "signed-out") {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={login}>
          <span className="auth-mark">PG</span>
          <p className="auth-eyebrow">PAPER GRAPH</p>
          <h1>Research Library</h1>
          <p>동기화된 논문 라이브러리를 열려면 비밀번호를 입력하세요.</p>
          <label>
            <span>비밀번호</span>
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button disabled={!password || submitting} type="submit">
            {submitting ? "확인 중…" : "라이브러리 열기"}
          </button>
          {error && <small role="alert">{error}</small>}
          <em>로그인은 1시간 동안 유지됩니다.</em>
        </form>
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PaperGraphApp />
    </QueryClientProvider>
  );
}
