"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Check,
  Clock3,
  Download,
  Flame,
  Pencil,
  Sparkles,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type GoalMetric = "reading_minutes" | "review_count" | "new_words";

type Insights = {
  range: { offset: number; start: string; end: string; label: string; isCurrent: boolean };
  overview: { secondsToday: number; secondsWeek: number; secondsTotal: number; sessionsWeek: number; booksWeek: number; streak: number };
  vocabulary: { total: number; due: number; mastered: number; addedWeek: number; reviewedWeek: number };
  report: { readingSeconds: number; sessions: number; books: number; activeDays: number; wordsAdded: number; reviewed: number; notes: number; mastered: number };
  comparison: Record<"reading" | "reviews" | "words" | "activeDays", { delta: number; percent: number }>;
  summary: string[];
  daily: Array<{ date: string; label: string; seconds: number; added: number; reviewed: number }>;
  trend: Array<{ start: string; label: string; readingSeconds: number; activeDays: number; reviewed: number; added: number }>;
  goals: Array<{ id: string; metric: GoalMetric; target_value: number; actual: number; progress: number }>;
  books: Array<{ id: string; title: string; author: string; format: string; seconds: number; progress: number }>;
};

export function InsightsClient() {
  const [data, setData] = useState<Insights | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [editingGoals, setEditingGoals] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Record<GoalMetric, number>>({
    reading_minutes: 180,
    review_count: 50,
    new_words: 30,
  });
  const [savingGoals, setSavingGoals] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/insights?week=${weekOffset}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("阅读数据加载失败。");
        const result = await response.json() as Insights;
        setError("");
        setData(result);
        setGoalDraft(Object.fromEntries(
          result.goals.map((goal) => [goal.metric, goal.target_value]),
        ) as Record<GoalMetric, number>);
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "阅读数据加载失败。");
        }
      });
    return () => controller.abort();
  }, [reloadToken, weekOffset]);

  const maxSeconds = useMemo(
    () => Math.max(60, ...(data?.daily.map((day) => day.seconds) || [])),
    [data],
  );
  const maxTrendSeconds = useMemo(
    () => Math.max(60, ...(data?.trend.map((week) => week.readingSeconds) || [])),
    [data],
  );

  async function saveGoals() {
    setSavingGoals(true);
    setError("");
    const goals = (Object.entries(goalDraft) as Array<[GoalMetric, number]>).map(
      ([metric, targetValue]) => ({ metric, targetValue: Math.max(1, Math.round(targetValue || 1)) }),
    );
    try {
      const response = await fetch("/api/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals }),
      });
      if (!response.ok) throw new Error("学习目标保存失败。");
      setEditingGoals(false);
      setReloadToken((value) => value + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "学习目标保存失败。");
    } finally {
      setSavingGoals(false);
    }
  }

  return (
    <div className="page-shell learning-page insights-page page-enter">
      <section className="page-heading learning-heading">
        <div>
          <p className="eyebrow">Reading signal · Weekly review</p>
          <h1>让阅读进度变成看得见的成长</h1>
          <p>设定每周目标，回看投入与复习节奏，而不是用页数制造虚假的成就感。</p>
        </div>
        <Link className="button primary" href="/review"><BrainCircuit size={16} />开始今日复习</Link>
      </section>

      <section className="week-switcher" aria-label="选择周报周期">
        <button type="button" className="icon-button" aria-label="查看上一周" onClick={() => setWeekOffset((value) => Math.max(-52, value - 1))}><ArrowLeft size={16} /></button>
        <div><small>{data?.range.isCurrent ? "Current week" : "Weekly archive"}</small><strong>{data?.range.label || "正在读取…"}</strong></div>
        <button type="button" className="icon-button" aria-label="查看下一周" disabled={weekOffset >= 0} onClick={() => setWeekOffset((value) => Math.min(0, value + 1))}><ArrowRight size={16} /></button>
        <a className="button secondary week-download" href={`/api/reports/weekly?week=${weekOffset}`} download><Download size={15} />导出周报</a>
      </section>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {!data ? <div className="insights-skeleton"><span /><span /><span /></div> : <>
        <section className="insight-hero-grid">
          <article className="insight-hero-card is-primary"><div><small>This week</small><strong>{formatDuration(data.overview.secondsWeek)}</strong><p>{data.overview.sessionsWeek} 次阅读 · {data.overview.booksWeek} 本书</p></div><div className="reading-orbit" aria-hidden="true"><i /><i /><span>{Math.round(data.overview.secondsWeek / 3600 * 10) / 10}<small>hours</small></span></div></article>
          <article className="metric-card"><Clock3 size={16} /><small>活跃天数</small><strong>{data.report.activeDays} 天</strong><span>{comparisonLabel(data.comparison.activeDays, "比上周")}</span></article>
          <article className="metric-card"><Flame size={16} /><small>连续阅读</small><strong>{data.overview.streak} 天</strong><span>{data.overview.streak ? "稳定比冲刺更重要" : "今天可以成为第 1 天"}</span></article>
          <article className="metric-card"><Sparkles size={16} /><small>本周回忆</small><strong>{data.vocabulary.reviewedWeek} 次</strong><span>{data.vocabulary.due} 个词待复习</span></article>
        </section>

        <div className="insight-report-grid">
          <section className="insight-panel weekly-report-card">
            <header><div><p className="eyebrow">Weekly report</p><h2>本周观察</h2></div><span>{data.report.notes} 条笔记</span></header>
            <ul>{data.summary.map((item) => <li key={item}>{item}</li>)}</ul>
            <div className="report-metrics" role="group" aria-label="本周数据摘要">
              <span><small>阅读</small><strong>{comparisonLabel(data.comparison.reading)}</strong></span>
              <span><small>复习</small><strong>{comparisonLabel(data.comparison.reviews)}</strong></span>
              <span><small>新词</small><strong>{comparisonLabel(data.comparison.words)}</strong></span>
            </div>
          </section>

          <section className="insight-panel goals-panel">
            <header>
              <div><p className="eyebrow">Weekly goals</p><h2>学习目标</h2></div>
              <button type="button" className="text-button" onClick={() => editingGoals ? void saveGoals() : setEditingGoals(true)} disabled={savingGoals}>
                {editingGoals ? <Check size={14} /> : <Pencil size={14} />}{savingGoals ? "保存中…" : editingGoals ? "保存" : "调整"}
              </button>
            </header>
            <div className="goal-list">{data.goals.map((goal) => {
              const meta = goalMeta(goal.metric);
              return <article className="goal-row" key={goal.metric}>
                <div className="goal-row-heading"><span><Target size={14} /><strong>{meta.label}</strong></span>{editingGoals ? <label><span className="visually-hidden">{meta.label}目标</span><input name={`goal-${goal.metric}`} autoComplete="off" type="number" min="1" max="100000" value={goalDraft[goal.metric]} onChange={(event) => setGoalDraft((current) => ({ ...current, [goal.metric]: Number(event.target.value) }))} /><small>{meta.unit}</small></label> : <span>{goal.actual} / {goal.target_value} {meta.unit}</span>}</div>
                <div className="goal-progress" role="progressbar" aria-label={`${meta.label}完成度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={goal.progress}><i style={{ width: `${goal.progress}%` }} /></div>
              </article>;
            })}</div>
          </section>
        </div>

        <section className="insight-panel trend-panel">
          <header><div><p className="eyebrow">12 week trend</p><h2>长期阅读趋势</h2></div><span>最近 12 周</span></header>
          <div className="trend-chart" role="img" aria-label="最近十二周阅读时长图表">{data.trend.map((week) => <div className="trend-week" key={week.start}><div className="trend-track"><i style={{ height: `${Math.max(week.readingSeconds ? 7 : 2, week.readingSeconds / maxTrendSeconds * 100)}%` }}><span>{formatDuration(week.readingSeconds)} · {week.activeDays} 天</span></i></div><small>{week.label}</small></div>)}</div>
        </section>

        <section className="insight-panel reading-chart-panel">
          <header><div><p className="eyebrow">Reading rhythm</p><h2>一周阅读节奏</h2></div><span>总计 {formatDuration(data.overview.secondsWeek)}</span></header>
          <div className="reading-chart" role="img" aria-label="本周每日阅读时长图表">{data.daily.map((day) => <div className="chart-day" key={day.date}><div className="chart-track"><i style={{ height: `${Math.max(day.seconds ? 8 : 2, day.seconds / maxSeconds * 100)}%` }}><span>{day.seconds ? formatDuration(day.seconds) : "0"}</span></i></div><small>{day.label}</small></div>)}</div>
        </section>

        <div className="insight-lower-grid">
          <section className="insight-panel vocabulary-signal"><header><div><p className="eyebrow">Vocabulary loop</p><h2>词汇学习信号</h2></div><Link href="/vocabulary">查看全部 <ArrowUpRight size={14} /></Link></header><div className="vocabulary-ring"><div style={{ "--mastery": `${data.vocabulary.total ? data.vocabulary.mastered / data.vocabulary.total * 100 : 0}%` } as React.CSSProperties}><span>{data.vocabulary.total ? Math.round(data.vocabulary.mastered / data.vocabulary.total * 100) : 0}%</span><small>mastered</small></div><ul><li><i className="is-added" /><span>本周新增</span><strong>{data.vocabulary.addedWeek}</strong></li><li><i className="is-reviewed" /><span>本周复习</span><strong>{data.vocabulary.reviewedWeek}</strong></li><li><i className="is-due" /><span>当前到期</span><strong>{data.vocabulary.due}</strong></li></ul></div></section>
          <section className="insight-panel book-signal"><header><div><p className="eyebrow">Library focus</p><h2>本周阅读分布</h2></div></header>{data.books.length ? <div>{data.books.map((book) => <Link href={`/reader/${book.id}`} className="book-signal-row" key={book.id}><span className="mini-book" aria-hidden="true">{book.format.toUpperCase()}</span><span><strong>{book.title}</strong><small>{book.author} · {formatDuration(book.seconds)}</small></span><span>{Math.round(book.progress)}%</span></Link>)}</div> : <div className="insight-empty"><BookOpen size={21} /><span>这一周还没有阅读记录。</span></div>}</section>
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

function comparisonLabel(value: { delta: number; percent: number }, prefix = "较上周") {
  if (!value.delta) return `${prefix}持平`;
  return `${prefix}${value.delta > 0 ? "+" : ""}${value.percent}%`;
}

function goalMeta(metric: GoalMetric) {
  if (metric === "reading_minutes") return { label: "阅读投入", unit: "分钟" };
  if (metric === "review_count") return { label: "词汇复习", unit: "次" };
  return { label: "新增生词", unit: "个" };
}
