"use client";

import { BookOpen, Check, Clock3, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Word = {
  id: string;
  book_id: string;
  term: string;
  definition: string;
  phonetic: string;
  part_of_speech: string;
  context: string;
  anchor_json: string;
  status: "new" | "learning" | "mastered";
  due_at: string;
  interval_days: number;
  book_title: string;
};

type Counts = { total: number; due: number; learning: number; mastered: number };

export function VocabularyClient() {
  const [words, setWords] = useState<Word[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, due: 0, learning: 0, mastered: 0 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Word["status"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [definition, setDefinition] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/vocabulary");
    if (!response.ok) return;
    const result = await response.json() as { words: Word[]; counts: Counts };
    setWords(result.words);
    setCounts(result.counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The local API owns the initial vocabulary synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return words.filter((word) => (
      (filter === "all" || word.status === filter)
      && (!normalized || `${word.term} ${word.definition} ${word.context} ${word.book_title}`.toLocaleLowerCase().includes(normalized))
    ));
  }, [filter, query, words]);
  const selected = words.find((word) => word.id === selectedId) || null;

  function selectWord(word: Word) {
    setSelectedId(word.id);
    setDefinition(word.definition);
  }

  async function saveDefinition() {
    if (!selected) return;
    setSaving(true);
    const response = await fetch("/api/vocabulary", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, definition }),
    });
    if (response.ok) {
      setWords((current) => current.map((word) => word.id === selected.id ? { ...word, definition } : word));
    }
    setSaving(false);
  }

  async function changeStatus(id: string, status: Word["status"]) {
    const response = await fetch("/api/vocabulary", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (response.ok) await load();
  }

  async function deleteWord(word: Word) {
    if (!window.confirm(`从生词本移除“${word.term}”？`)) return;
    const response = await fetch(`/api/vocabulary?id=${encodeURIComponent(word.id)}`, { method: "DELETE" });
    if (response.ok) {
      if (selectedId === word.id) setSelectedId(null);
      await load();
    }
  }

  return (
    <div className="page-shell learning-page vocabulary-page page-enter">
      <section className="page-heading learning-heading">
        <div>
          <p className="eyebrow">Vocabulary · Context first</p>
          <h1>生词不是清单，是阅读留下的线索</h1>
          <p>保留原文语境，按复习节奏把陌生表达变成熟悉语言。</p>
        </div>
        <Link className="button primary" href="/review"><Clock3 size={16} />复习 {counts.due || 0} 个到期词</Link>
      </section>

      <section className="learning-pulse" aria-label="生词学习状态">
        <div className="pulse-orbit" aria-hidden="true"><i /><i /><span>{counts.total}</span></div>
        <div><small>Vocabulary pulse</small><strong>{counts.due ? `${counts.due} 个词正在等你` : "今天的复习已经清空"}</strong><p>学习中 {counts.learning || 0} · 已掌握 {counts.mastered || 0}</p></div>
      </section>

      <section className="learning-toolbar">
        <label className="search-field"><Search size={15} /><span className="visually-hidden">搜索生词</span><input name="vocabulary-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词、释义、书名或语境…" /></label>
        <div className="segmented-control" role="group" aria-label="生词状态筛选">
          {(["all", "new", "learning", "mastered"] as const).map((value) => <button type="button" aria-pressed={filter === value} className={filter === value ? "is-active" : ""} key={value} onClick={() => setFilter(value)}>{statusLabel(value)}</button>)}
        </div>
      </section>

      <div className="vocabulary-layout">
        <section className="vocabulary-list" aria-label="生词列表">
          {loading ? <LearningSkeleton /> : visible.length ? visible.map((word) => (
            <article className={`vocabulary-row ${selectedId === word.id ? "is-selected" : ""}`} key={word.id}>
              <button type="button" className="vocabulary-main" onClick={() => selectWord(word)}>
                <span className={`status-dot is-${word.status}`} aria-label={statusLabel(word.status)} />
                <span><strong>{word.term}</strong><small>{word.definition || word.context.slice(0, 110) || "尚未添加释义"}</small></span>
              </button>
              <span className="vocabulary-source">{word.book_title}</span>
              <span className="vocabulary-due">{dueLabel(word)}</span>
              <button type="button" className="icon-button subtle" aria-label={`删除 ${word.term}`} onClick={() => void deleteWord(word)}><Trash2 size={14} /></button>
            </article>
          )) : <LearningEmpty title="没有匹配的生词" detail="阅读时选择单词或短语，点击“生词”即可加入这里。" />}
        </section>

        <aside className="vocabulary-detail" aria-label="生词详情">
          {selected ? <>
            <header><div><small>{selected.part_of_speech || "Expression"}</small><h2>{selected.term}</h2><p>{selected.phonetic}</p></div><span className={`status-chip is-${selected.status}`}>{statusLabel(selected.status)}</span></header>
            <blockquote>{selected.context || "没有保存语境。"}</blockquote>
            <label className="field"><span>你的释义或记忆提示</span><textarea name="word-definition" rows={6} value={definition} onChange={(event) => setDefinition(event.target.value)} placeholder="写下当前语境义、搭配或记忆提示…" /></label>
            <div className="detail-status-actions" role="group" aria-label="设置掌握状态">
              {(["new", "learning", "mastered"] as const).map((status) => <button type="button" aria-pressed={selected.status === status} key={status} onClick={() => void changeStatus(selected.id, status)}>{status === "mastered" ? <Check size={13} /> : null}{statusLabel(status)}</button>)}
            </div>
            <div className="detail-actions"><Link className="button secondary" href={readerHref(selected)}><BookOpen size={15} />回到原文</Link><button type="button" className="button primary" disabled={saving || definition === selected.definition} onClick={() => void saveDefinition()}>{saving ? "保存中…" : "保存释义"}</button></div>
          </> : <LearningEmpty title="选择一个词查看语境" detail="你可以补充释义、调整学习状态，或一键回到原文。" />}
        </aside>
      </div>
    </div>
  );
}

function statusLabel(status: "all" | Word["status"]) {
  return status === "all" ? "全部" : status === "new" ? "新词" : status === "learning" ? "学习中" : "已掌握";
}

function dueLabel(word: Word) {
  if (word.status === "mastered") return "已掌握";
  const due = new Date(word.due_at);
  if (due <= new Date()) return "现在复习";
  return `${Math.max(1, Math.ceil((due.getTime() - Date.now()) / 86_400_000))} 天后`;
}

function readerHref(word: Word) {
  try {
    const anchor = JSON.parse(word.anchor_json) as { type?: string; page?: number; cfiRange?: string };
    if (anchor.type === "pdf" && anchor.page) return `/reader/${word.book_id}?page=${anchor.page}`;
    if (anchor.type === "epub" && anchor.cfiRange) return `/reader/${word.book_id}?cfi=${encodeURIComponent(anchor.cfiRange)}`;
  } catch { /* fall through */ }
  return `/reader/${word.book_id}`;
}

function LearningSkeleton() { return <div className="learning-skeleton"><span /><span /><span /><span /></div>; }
function LearningEmpty({ title, detail }: { title: string; detail: string }) { return <div className="learning-empty"><BookOpen size={22} /><strong>{title}</strong><span>{detail}</span></div>; }
