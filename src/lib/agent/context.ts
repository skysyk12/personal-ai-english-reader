import "server-only";

import { sqlite } from "@/db";
import { getLearningInsights } from "@/lib/learning/insights";
import { getActiveAgentSession } from "./sessions";
import type { AgentBookContext, AgentSnapshot } from "./types";

type BookRow = {
  id: string;
  title: string;
  author: string;
  format: "epub" | "pdf";
  progress: number;
  pdf_page: number | null;
  last_opened_at: string | null;
};

export function getAgentSnapshot(): AgentSnapshot {
  const insights = getLearningInsights(0);
  const bookRows = sqlite.prepare(`
    SELECT
      b.id,
      b.title,
      b.author,
      b.format,
      COALESCE(p.percentage, 0) AS progress,
      p.pdf_page,
      b.last_opened_at
    FROM books b
    LEFT JOIN reading_progress p ON p.book_id = b.id
    ORDER BY COALESCE(b.last_opened_at, b.created_at) DESC
    LIMIT 12
  `).all() as BookRow[];
  const books = bookRows.map(toBookContext);
  const role = sqlite.prepare(`
    SELECT id, name, current_level, goal
    FROM learning_roles
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `).get() as {
    id: string;
    name: string;
    current_level: string;
    goal: string;
  } | undefined;
  const noteCount = (sqlite.prepare("SELECT COUNT(*) AS value FROM notes").get() as { value: number }).value;
  const recentNotes = sqlite.prepare(`
    SELECT n.id, n.title, n.selected_text, n.anchor_json, n.created_at, n.book_id, b.title AS book_title
    FROM notes n
    JOIN books b ON b.id = n.book_id
    ORDER BY n.updated_at DESC
    LIMIT 3
  `).all() as Array<{
    id: string;
    title: string;
    selected_text: string;
    anchor_json: string;
    created_at: string;
    book_id: string;
    book_title: string;
  }>;

  return {
    generatedAt: new Date().toISOString(),
    activeBook: books[0] ?? null,
    books,
    role: role ? {
      id: role.id,
      name: role.name,
      currentLevel: role.current_level,
      goal: role.goal,
    } : null,
    signals: {
      dueCount: insights.vocabulary.due,
      secondsToday: insights.overview.secondsToday,
      secondsWeek: insights.overview.secondsWeek,
      noteCount,
      vocabularyCount: insights.vocabulary.total,
      streak: insights.overview.streak,
    },
    recentNotes: recentNotes.map((note) => ({
      id: note.id,
      title: note.title || "阅读笔记",
      bookTitle: note.book_title,
      selectedText: note.selected_text,
      createdAt: note.created_at,
      href: readerHref(note.book_id, note.anchor_json),
    })),
    activeSession: getActiveAgentSession(),
    aiConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
  };
}

function toBookContext(row: BookRow): AgentBookContext {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format,
    progress: Math.round(row.progress || 0),
    pdfPage: row.pdf_page,
    lastOpenedAt: row.last_opened_at,
  };
}

function readerHref(bookId: string, anchorJson: string) {
  try {
    const anchor = JSON.parse(anchorJson) as { type?: string; page?: number; cfiRange?: string };
    if (anchor.type === "pdf" && anchor.page) return `/reader/${bookId}?page=${anchor.page}`;
    if (anchor.type === "epub" && anchor.cfiRange) return `/reader/${bookId}?cfi=${encodeURIComponent(anchor.cfiRange)}`;
  } catch {
    // A note with a legacy anchor can still return to the book.
  }
  return `/reader/${bookId}`;
}
