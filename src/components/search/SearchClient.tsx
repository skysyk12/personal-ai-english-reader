"use client";

import { BookMarked, BookOpen, FileText, NotebookPen, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type SearchResult = { id: string; type: "book" | "content" | "vocabulary" | "note"; title: string; meta: string; snippet: string; href: string };

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : { results: [] })
        .then((result: { results: SearchResult[] }) => setResults(result.results))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const visibleResults = query.trim().length >= 2 ? results : [];
  return <div className="page-shell search-page page-enter"><section className="page-heading"><div><p className="eyebrow">Library search</p><h1>在所有阅读痕迹中搜索</h1><p>同时搜索书名、全文、生词与笔记，并直接跳回原文位置。</p></div></section><form className="search-hero" onSubmit={(event) => { event.preventDefault(); router.replace(`/search?q=${encodeURIComponent(query)}`); }}><Search size={20} /><label><span className="visually-hidden">全局搜索</span><input name="global-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入至少两个字或一个英文单词…" /></label><kbd>Enter</kbd></form><section className="search-result-list" aria-live="polite">{loading ? <div className="search-loading"><i />正在建立或搜索本地索引…</div> : visibleResults.length ? <><p className="search-result-count">找到 {visibleResults.length} 个结果</p>{visibleResults.map((result) => <SearchResultRow result={result} key={result.id} />)}</> : query.trim().length >= 2 ? <div className="learning-empty"><Search size={22} /><strong>没有找到匹配内容</strong><span>试试原文中的另一种拼写，或更短的关键词。</span></div> : <div className="search-suggestions"><span>试试搜索：</span><button type="button" onClick={() => setQuery("love")}>love</button><button type="button" onClick={() => setQuery("economy")}>economy</button><button type="button" onClick={() => setQuery("Barney")}>Barney</button></div>}</section></div>;
}

function SearchResultRow({ result }: { result: SearchResult }) {
  return <Link href={result.href} className="search-result-row"><span className="search-result-icon"><SearchTypeIcon type={result.type} /></span><span><strong>{result.title}</strong><small>{result.meta}</small><p>{result.snippet}</p></span></Link>;
}

function SearchTypeIcon({ type }: { type: SearchResult["type"] }) {
  if (type === "book") return <BookOpen size={17} />;
  if (type === "vocabulary") return <BookMarked size={17} />;
  if (type === "note") return <NotebookPen size={17} />;
  return <FileText size={17} />;
}
