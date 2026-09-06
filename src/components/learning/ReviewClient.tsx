"use client";

import { ArrowLeft, BookOpen, BrainCircuit, Check, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ReviewWord = {
  id: string;
  book_id: string;
  term: string;
  definition: string;
  context: string;
  anchor_json: string;
  repetitions: number;
  book_title: string;
};

const RATINGS = [
  { value: "again", label: "重来", hint: "10 分钟", key: "1" },
  { value: "hard", label: "困难", hint: "约 1 天", key: "2" },
  { value: "good", label: "记得", hint: "按计划", key: "3" },
  { value: "easy", label: "简单", hint: "延长间隔", key: "4" },
] as const;

export function ReviewClient() {
  const [queue, setQueue] = useState<ReviewWord[]>([]);
  const [initialCount, setInitialCount] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/vocabulary?due=1");
    if (!response.ok) return;
    const result = await response.json() as { words: ReviewWord[] };
    setQueue(result.words);
    setInitialCount(result.words.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The local API owns the initial review queue synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const word = queue[0];
  const completed = Math.max(0, initialCount - queue.length);

  async function rate(value: typeof RATINGS[number]["value"]) {
    if (!word || rating) return;
    setRating(true);
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vocabularyId: word.id, rating: value }),
    });
    if (response.ok) {
      setQueue((current) => current.slice(1));
      setRevealed(false);
    }
    setRating(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!word || (event.target as HTMLElement | null)?.matches("input, textarea, select")) return;
      if (event.key === " " && !revealed) { event.preventDefault(); setRevealed(true); return; }
      const option = RATINGS.find((item) => item.key === event.key);
      if (revealed && option) { event.preventDefault(); void rate(option.value); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="review-page page-enter">
      <header className="review-header">
        <Link href="/library" className="icon-button" aria-label="返回书库"><ArrowLeft size={17} /></Link>
        <div><small>Daily recall</small><strong>复习队列</strong></div>
        <span>{queue.length} remaining</span>
      </header>
      <main className="review-stage">
        {loading ? <div className="review-loader"><i /><strong>正在整理今天的记忆队列…</strong></div> : word ? <>
          <div className="review-progress-line" role="progressbar" aria-label="今日复习进度" aria-valuemin={0} aria-valuemax={initialCount} aria-valuenow={completed}><i style={{ width: `${initialCount ? completed / initialCount * 100 : 0}%` }} /></div>
          <p className="review-count">{completed + 1} / {initialCount} · {word.book_title}</p>
          <article className={`review-card ${revealed ? "is-revealed" : ""}`}>
            <div className="review-card-mark"><BrainCircuit size={18} /></div>
            <div className="review-prompt"><small>Recall the meaning</small><h1>{word.term}</h1><blockquote>{highlightTerm(word.context, word.term)}</blockquote></div>
            {revealed ? <div className="review-answer"><small>你的答案</small><p>{word.definition || "还没有自定义释义。根据上方语境先口头解释，再回到生词本补充。"}</p><Link href={readerHref(word)}><BookOpen size={14} />查看原文</Link></div> : <button type="button" className="reveal-answer" onClick={() => setRevealed(true)}><Sparkles size={15} />显示答案 <kbd>Space</kbd></button>}
          </article>
          {revealed ? <div className="rating-grid" role="group" aria-label="评价回忆难度">{RATINGS.map((option) => <button type="button" disabled={rating} className={`rating-${option.value}`} key={option.value} onClick={() => void rate(option.value)}><kbd>{option.key}</kbd><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div> : null}
        </> : <section className="review-complete"><div className="complete-orbit"><Check size={26} /></div><p className="eyebrow">Queue cleared</p><h1>{initialCount ? "今天的记忆回路已完成" : "今天没有到期生词"}</h1><p>{initialCount ? `你刚刚完成了 ${initialCount} 次主动回忆。下一批词会按记忆间隔出现。` : "阅读时把真正影响理解的词加入生词本，复习计划会自动生成。"}</p><div><Link className="button primary" href="/library"><BookOpen size={15} />继续阅读</Link><Link className="button secondary" href="/vocabulary"><RotateCcw size={15} />查看生词本</Link></div></section>}
      </main>
    </div>
  );
}

function highlightTerm(context: string, term: string) {
  if (!context) return "回想它在原文中的含义和用法。";
  const index = context.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (index < 0) return context.slice(0, 420);
  return `${context.slice(Math.max(0, index - 170), index)}_____ ${context.slice(index + term.length, index + term.length + 220)}`;
}

function readerHref(word: ReviewWord) {
  try {
    const anchor = JSON.parse(word.anchor_json) as { type?: string; page?: number; cfiRange?: string };
    if (anchor.type === "pdf" && anchor.page) return `/reader/${word.book_id}?page=${anchor.page}`;
    if (anchor.type === "epub" && anchor.cfiRange) return `/reader/${word.book_id}?cfi=${encodeURIComponent(anchor.cfiRange)}`;
  } catch { /* use book start */ }
  return `/reader/${word.book_id}`;
}
