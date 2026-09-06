"use client";

import { ArrowUpRight, BookOpen, BrainCircuit, Clock3, Flame, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Insights = {
  overview: { secondsToday: number; secondsWeek: number; secondsTotal: number; sessionsWeek: number; booksWeek: number; streak: number };
  vocabulary: { total: number; due: number; mastered: number; addedWeek: number; reviewedWeek: number };
  daily: Array<{ date: string; label: string; seconds: number; added: number; reviewed: number }>;
  books: Array<{ id: string; title: string; author: string; format: string; seconds: number; progress: number }>;
};

export function InsightsClient() {
  const [data, setData] = useState<Insights | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/insights", { signal: controller.signal }).then(async (response) => {
      if (response.ok) setData(await response.json() as Insights);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Failed to load reading insights", error);
      }
    });
    return () => controller.abort();
  }, []);

  const maxSeconds = useMemo(() => Math.max(60, ...(data?.daily.map((day) => day.seconds) || [])), [data]);

  return (
    <div className="page-shell learning-page insights-page page-enter">
      <section className="page-heading learning-heading">
        <div><p className="eyebrow">Reading signal · Last 7 days</p><h1>让阅读进度变成看得见的成长</h1><p>这里记录的是投入、回忆与持续性，不用页数制造虚假的成就感。</p></div>
        <Link className="button primary" href="/review"><BrainCircuit size={16} />开始今日复习</Link>
      </section>

      {!data ? <div className="insights-skeleton"><span /><span /><span /></div> : <>
        <section className="insight-hero-grid">
          <article className="insight-hero-card is-primary"><div><small>This week</small><strong>{formatDuration(data.overview.secondsWeek)}</strong><p>{data.overview.sessionsWeek} 次阅读 · {data.overview.booksWeek} 本书</p></div><div className="reading-orbit" aria-hidden="true"><i /><i /><span>{Math.round(data.overview.secondsWeek / 3600 * 10) / 10}<small>hours</small></span></div></article>
          <article className="metric-card"><Clock3 size={16} /><small>今天阅读</small><strong>{formatDuration(data.overview.secondsToday)}</strong><span>把 30 分钟留给一本书</span></article>
          <article className="metric-card"><Flame size={16} /><small>连续阅读</small><strong>{data.overview.streak} 天</strong><span>{data.overview.streak ? "稳定比冲刺更重要" : "今天可以成为第 1 天"}</span></article>
          <article className="metric-card"><Sparkles size={16} /><small>本周回忆</small><strong>{data.vocabulary.reviewedWeek} 次</strong><span>{data.vocabulary.due} 个词待复习</span></article>
        </section>

        <section className="insight-panel reading-chart-panel">
          <header><div><p className="eyebrow">Reading rhythm</p><h2>7 天阅读节奏</h2></div><span>总计 {formatDuration(data.overview.secondsWeek)}</span></header>
          <div className="reading-chart" aria-label="最近七天阅读时长图表">{data.daily.map((day) => <div className="chart-day" key={day.date}><div className="chart-track"><i style={{ height: `${Math.max(day.seconds ? 8 : 2, day.seconds / maxSeconds * 100)}%` }}><span>{day.seconds ? formatDuration(day.seconds) : "0"}</span></i></div><small>{day.label}</small></div>)}</div>
        </section>

        <div className="insight-lower-grid">
          <section className="insight-panel vocabulary-signal"><header><div><p className="eyebrow">Vocabulary loop</p><h2>词汇学习信号</h2></div><Link href="/vocabulary">查看全部 <ArrowUpRight size={14} /></Link></header><div className="vocabulary-ring"><div style={{ "--mastery": `${data.vocabulary.total ? data.vocabulary.mastered / data.vocabulary.total * 100 : 0}%` } as React.CSSProperties}><span>{data.vocabulary.total ? Math.round(data.vocabulary.mastered / data.vocabulary.total * 100) : 0}%</span><small>mastered</small></div><ul><li><i className="is-added" /><span>本周新增</span><strong>{data.vocabulary.addedWeek}</strong></li><li><i className="is-reviewed" /><span>本周复习</span><strong>{data.vocabulary.reviewedWeek}</strong></li><li><i className="is-due" /><span>当前到期</span><strong>{data.vocabulary.due}</strong></li></ul></div></section>
          <section className="insight-panel book-signal"><header><div><p className="eyebrow">Library focus</p><h2>阅读投入分布</h2></div></header>{data.books.length ? <div>{data.books.map((book) => <Link href={`/reader/${book.id}`} className="book-signal-row" key={book.id}><span className="mini-book" aria-hidden="true">{book.format.toUpperCase()}</span><span><strong>{book.title}</strong><small>{book.author} · {formatDuration(book.seconds)}</small></span><span>{Math.round(book.progress)}%</span></Link>)}</div> : <div className="insight-empty"><BookOpen size={21} /><span>打开一本书，阅读信号会从这里开始。</span></div>}</section>
        </div>
      </>}
    </div>
  );
}

function formatDuration(seconds: number) {
  if (seconds < 60) return seconds ? "< 1 分钟" : "0 分钟";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}
