import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function GET() {
  const today = startOfLocalDay(new Date());
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);

  const overview = sqlite.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN started_at >= ? THEN duration_seconds ELSE 0 END), 0) AS seconds_today,
      COALESCE(SUM(CASE WHEN started_at >= ? THEN duration_seconds ELSE 0 END), 0) AS seconds_week,
      COALESCE(SUM(duration_seconds), 0) AS seconds_total,
      COUNT(CASE WHEN started_at >= ? THEN 1 END) AS sessions_week,
      COUNT(DISTINCT CASE WHEN started_at >= ? THEN book_id END) AS books_week
    FROM reading_sessions
  `).get(today.toISOString(), weekStart.toISOString(), weekStart.toISOString(), weekStart.toISOString()) as Record<string, number>;
  const vocabulary = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'mastered' AND due_at <= ? THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS added_week
    FROM vocabulary
  `).get(new Date().toISOString(), weekStart.toISOString()) as Record<string, number>;
  const reviewCount = sqlite.prepare(`
    SELECT COUNT(*) AS count FROM vocabulary_reviews WHERE reviewed_at >= ?
  `).get(weekStart.toISOString()) as { count: number };
  const dailyRows = sqlite.prepare(`
    SELECT substr(started_at, 1, 10) AS date, SUM(duration_seconds) AS seconds
    FROM reading_sessions
    WHERE started_at >= ?
    GROUP BY substr(started_at, 1, 10)
  `).all(weekStart.toISOString()) as Array<{ date: string; seconds: number }>;
  const addedRows = sqlite.prepare(`
    SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count
    FROM vocabulary WHERE created_at >= ?
    GROUP BY substr(created_at, 1, 10)
  `).all(weekStart.toISOString()) as Array<{ date: string; count: number }>;
  const reviewRows = sqlite.prepare(`
    SELECT substr(reviewed_at, 1, 10) AS date, COUNT(*) AS count
    FROM vocabulary_reviews WHERE reviewed_at >= ?
    GROUP BY substr(reviewed_at, 1, 10)
  `).all(weekStart.toISOString()) as Array<{ date: string; count: number }>;
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    const key = localDateKey(date);
    return {
      date: key,
      label: date.toLocaleDateString("zh-CN", { weekday: "short" }),
      seconds: dailyRows.find((row) => row.date === key)?.seconds || 0,
      added: addedRows.find((row) => row.date === key)?.count || 0,
      reviewed: reviewRows.find((row) => row.date === key)?.count || 0,
    };
  });
  const bookRows = sqlite.prepare(`
    SELECT b.id, b.title, b.author, b.format,
      COALESCE(SUM(s.duration_seconds), 0) AS seconds,
      COALESCE(p.percentage, 0) AS progress
    FROM books b
    LEFT JOIN reading_sessions s ON s.book_id = b.id
    LEFT JOIN reading_progress p ON p.book_id = b.id
    GROUP BY b.id
    ORDER BY seconds DESC, b.last_opened_at DESC
    LIMIT 8
  `).all();

  return NextResponse.json({
    overview: {
      secondsToday: overview.seconds_today || 0,
      secondsWeek: overview.seconds_week || 0,
      secondsTotal: overview.seconds_total || 0,
      sessionsWeek: overview.sessions_week || 0,
      booksWeek: overview.books_week || 0,
      streak: calculateStreak(dailyRows.map((row) => row.date)),
    },
    vocabulary: {
      total: vocabulary.total || 0,
      due: vocabulary.due || 0,
      mastered: vocabulary.mastered || 0,
      addedWeek: vocabulary.added_week || 0,
      reviewedWeek: reviewCount.count || 0,
    },
    daily,
    books: bookRows,
  });
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
