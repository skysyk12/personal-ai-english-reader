import "server-only";

import { sqlite } from "@/db";

export type GoalMetric = "reading_minutes" | "review_count" | "new_words";

type SessionRow = {
  book_id: string;
  started_at: string;
  duration_seconds: number;
};

type VocabularyRow = {
  id: string;
  created_at: string;
  updated_at: string;
  due_at: string;
  status: string;
};

type ReviewRow = { reviewed_at: string };
type NoteRow = { created_at: string };

export type LearningInsights = ReturnType<typeof getLearningInsights>;

export function getLearningInsights(weekOffset = 0) {
  const safeOffset = Math.min(0, Math.max(-52, Math.trunc(weekOffset)));
  const today = startOfLocalDay(new Date());
  const currentWeekStart = startOfWeek(today);
  const selectedWeekStart = addDays(currentWeekStart, safeOffset * 7);
  const selectedWeekEnd = addDays(selectedWeekStart, 7);
  const previousWeekStart = addDays(selectedWeekStart, -7);
  const trendStart = addDays(selectedWeekStart, -77);

  const sessions = sqlite.prepare(`
    SELECT book_id, started_at, duration_seconds
    FROM reading_sessions
    WHERE started_at >= ? AND started_at < ?
  `).all(trendStart.toISOString(), selectedWeekEnd.toISOString()) as SessionRow[];
  const words = sqlite.prepare(`
    SELECT id, created_at, updated_at, due_at, status
    FROM vocabulary
  `).all() as VocabularyRow[];
  const reviews = sqlite.prepare(`
    SELECT reviewed_at FROM vocabulary_reviews
    WHERE reviewed_at >= ? AND reviewed_at < ?
  `).all(trendStart.toISOString(), selectedWeekEnd.toISOString()) as ReviewRow[];
  const notes = sqlite.prepare(`
    SELECT created_at FROM notes
    WHERE created_at >= ? AND created_at < ?
  `).all(previousWeekStart.toISOString(), selectedWeekEnd.toISOString()) as NoteRow[];

  const selectedSessions = within(sessions, "started_at", selectedWeekStart, selectedWeekEnd);
  const selectedWords = within(words, "created_at", selectedWeekStart, selectedWeekEnd);
  const selectedReviews = within(reviews, "reviewed_at", selectedWeekStart, selectedWeekEnd);
  const selectedNotes = within(notes, "created_at", selectedWeekStart, selectedWeekEnd);
  const previousSessions = within(sessions, "started_at", previousWeekStart, selectedWeekStart);
  const previousWords = within(words, "created_at", previousWeekStart, selectedWeekStart);
  const previousReviews = within(reviews, "reviewed_at", previousWeekStart, selectedWeekStart);
  const previousNotes = within(notes, "created_at", previousWeekStart, selectedWeekStart);

  const report = summarizeWeek(selectedSessions, selectedWords, selectedReviews, selectedNotes);
  const previous = summarizeWeek(previousSessions, previousWords, previousReviews, previousNotes);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(selectedWeekStart, index);
    const dayStart = date;
    const dayEnd = addDays(dayStart, 1);
    return {
      date: localDateKey(date),
      label: date.toLocaleDateString("zh-CN", { weekday: "short" }),
      seconds: within(selectedSessions, "started_at", dayStart, dayEnd)
        .reduce((total, row) => total + row.duration_seconds, 0),
      added: within(selectedWords, "created_at", dayStart, dayEnd).length,
      reviewed: within(selectedReviews, "reviewed_at", dayStart, dayEnd).length,
    };
  });

  const trend = Array.from({ length: 12 }, (_, index) => {
    const start = addDays(trendStart, index * 7);
    const end = addDays(start, 7);
    const weekSessions = within(sessions, "started_at", start, end);
    return {
      start: localDateKey(start),
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      readingSeconds: weekSessions.reduce((total, row) => total + row.duration_seconds, 0),
      activeDays: new Set(weekSessions.map((row) => localDateKey(new Date(row.started_at)))).size,
      reviewed: within(reviews, "reviewed_at", start, end).length,
      added: within(words, "created_at", start, end).length,
    };
  });

  const goalRows = sqlite.prepare(`
    SELECT id, metric, target_value, period, is_active, created_at, updated_at
    FROM learning_goals ORDER BY rowid
  `).all() as Array<{
    id: string;
    metric: GoalMetric;
    target_value: number;
    period: "weekly";
    is_active: number;
    created_at: string;
    updated_at: string;
  }>;
  const actualByMetric: Record<GoalMetric, number> = {
    reading_minutes: Math.round(report.readingSeconds / 60),
    review_count: report.reviewed,
    new_words: report.wordsAdded,
  };
  const goals = goalRows.map((goal) => ({
    ...goal,
    actual: actualByMetric[goal.metric],
    progress: goal.target_value > 0
      ? Math.min(100, Math.round(actualByMetric[goal.metric] / goal.target_value * 100))
      : 0,
  }));

  const allSessionDates = sqlite.prepare(`
    SELECT DISTINCT substr(started_at, 1, 10) AS date FROM reading_sessions
  `).all() as Array<{ date: string }>;
  const now = new Date().toISOString();
  const totalSeconds = (sqlite.prepare(`
    SELECT COALESCE(SUM(duration_seconds), 0) AS value FROM reading_sessions
  `).get() as { value: number }).value || 0;
  const vocabulary = {
    total: words.length,
    due: words.filter((word) => word.status !== "mastered" && word.due_at <= now).length,
    mastered: words.filter((word) => word.status === "mastered").length,
    addedWeek: selectedWords.length,
    reviewedWeek: selectedReviews.length,
  };

  const sessionSecondsByBook = new Map<string, number>();
  for (const session of selectedSessions) {
    sessionSecondsByBook.set(
      session.book_id,
      (sessionSecondsByBook.get(session.book_id) || 0) + session.duration_seconds,
    );
  }
  const books = (sqlite.prepare(`
    SELECT b.id, b.title, b.author, b.format, COALESCE(p.percentage, 0) AS progress
    FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id
  `).all() as Array<{ id: string; title: string; author: string; format: string; progress: number }>)
    .map((book) => ({ ...book, seconds: sessionSecondsByBook.get(book.id) || 0 }))
    .filter((book) => book.seconds > 0)
    .toSorted((left, right) => right.seconds - left.seconds)
    .slice(0, 8);

  const bestDay = daily.toSorted((left, right) => right.seconds - left.seconds)[0];
  const summary = buildSummary(report, previous, bestDay);

  return {
    range: {
      offset: safeOffset,
      start: localDateKey(selectedWeekStart),
      end: localDateKey(addDays(selectedWeekEnd, -1)),
      label: formatWeekLabel(selectedWeekStart, selectedWeekEnd),
      isCurrent: safeOffset === 0,
    },
    overview: {
      secondsToday: daily.find((day) => day.date === localDateKey(today))?.seconds || 0,
      secondsWeek: report.readingSeconds,
      secondsTotal: totalSeconds,
      sessionsWeek: report.sessions,
      booksWeek: report.books,
      streak: calculateStreak(allSessionDates.map((row) => row.date)),
    },
    vocabulary,
    report,
    previous,
    comparison: {
      reading: compare(report.readingSeconds, previous.readingSeconds),
      reviews: compare(report.reviewed, previous.reviewed),
      words: compare(report.wordsAdded, previous.wordsAdded),
      activeDays: compare(report.activeDays, previous.activeDays),
    },
    summary,
    daily,
    trend,
    goals,
    books,
  };
}

export function formatWeeklyReportMarkdown(insights: LearningInsights) {
  const { range, report, previous, goals, summary } = insights;
  const goalLines = goals.map((goal) => (
    `- ${goalLabel(goal.metric)}：${goal.actual}/${goal.target_value}（${goal.progress}%）`
  ));
  return [
    `# Margin 阅读周报｜${range.label}`,
    "",
    "## 本周投入",
    "",
    `- 阅读时长：${formatDuration(report.readingSeconds)}`,
    `- 阅读次数：${report.sessions} 次，覆盖 ${report.books} 本书`,
    `- 活跃天数：${report.activeDays} 天`,
    `- 新增生词：${report.wordsAdded} 个`,
    `- 完成复习：${report.reviewed} 次`,
    `- 新增笔记：${report.notes} 条`,
    "",
    "## 与上周相比",
    "",
    `- 阅读时长：${signedDelta(report.readingSeconds - previous.readingSeconds, "duration")}`,
    `- 复习次数：${signedDelta(report.reviewed - previous.reviewed)}`,
    `- 新增生词：${signedDelta(report.wordsAdded - previous.wordsAdded)}`,
    "",
    "## 目标进度",
    "",
    ...goalLines,
    "",
    "## 本周观察",
    "",
    ...summary.map((item) => `- ${item}`),
    "",
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
  ].join("\n");
}

function summarizeWeek(
  sessions: SessionRow[],
  words: VocabularyRow[],
  reviews: ReviewRow[],
  notes: NoteRow[],
) {
  return {
    readingSeconds: sessions.reduce((total, session) => total + session.duration_seconds, 0),
    sessions: sessions.length,
    books: new Set(sessions.map((session) => session.book_id)).size,
    activeDays: new Set(sessions.map((session) => localDateKey(new Date(session.started_at)))).size,
    wordsAdded: words.length,
    reviewed: reviews.length,
    notes: notes.length,
    mastered: words.filter((word) => word.status === "mastered").length,
  };
}

function within<T extends Record<K, string>, K extends keyof T>(
  rows: T[],
  key: K,
  start: Date,
  end: Date,
) {
  const startTime = start.getTime();
  const endTime = end.getTime();
  return rows.filter((row) => {
    const timestamp = new Date(row[key]).getTime();
    return timestamp >= startTime && timestamp < endTime;
  });
}

function buildSummary(
  report: ReturnType<typeof summarizeWeek>,
  previous: ReturnType<typeof summarizeWeek>,
  bestDay: { label: string; seconds: number } | undefined,
) {
  const output: string[] = [];
  if (!report.sessions) {
    return ["本周还没有阅读记录。选择一本书，用一次短阅读启动本周节奏。"]; 
  }
  if (bestDay?.seconds) output.push(`${bestDay.label}投入最多，共阅读 ${formatDuration(bestDay.seconds)}。`);
  if (report.readingSeconds > previous.readingSeconds) {
    output.push(`阅读投入比上周增加 ${formatDuration(report.readingSeconds - previous.readingSeconds)}。`);
  } else if (previous.readingSeconds > report.readingSeconds) {
    output.push(`阅读投入比上周减少 ${formatDuration(previous.readingSeconds - report.readingSeconds)}，可以从缩短单次目标开始恢复。`);
  }
  if (report.reviewed) output.push(`完成 ${report.reviewed} 次词汇回忆，新增 ${report.wordsAdded} 个语境词。`);
  if (report.activeDays >= 4) output.push(`本周有 ${report.activeDays} 个活跃日，阅读节奏较稳定。`);
  return output.slice(0, 3);
}

function startOfWeek(date: Date) {
  const start = startOfLocalDay(date);
  const weekday = start.getDay();
  start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1));
  return start;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeekLabel(start: Date, end: Date) {
  const finalDay = addDays(end, -1);
  const startLabel = start.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  const endLabel = finalDay.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function calculateStreak(activeDates: string[]) {
  const dates = new Set(activeDates);
  const cursor = startOfLocalDay(new Date());
  if (!dates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function compare(current: number, previous: number) {
  const delta = current - previous;
  return {
    delta,
    percent: previous > 0 ? Math.round(delta / previous * 100) : current > 0 ? 100 : 0,
  };
}

function goalLabel(metric: GoalMetric) {
  if (metric === "reading_minutes") return "阅读分钟";
  if (metric === "review_count") return "词汇复习";
  return "新增生词";
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function signedDelta(value: number, type: "number" | "duration" = "number") {
  if (!value) return "持平";
  const label = type === "duration" ? formatDuration(Math.abs(value)) : String(Math.abs(value));
  return `${value > 0 ? "+" : "-"}${label}`;
}
