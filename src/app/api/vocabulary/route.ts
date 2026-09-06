import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const createVocabularySchema = z.object({
  bookId: z.string().min(1),
  term: z.string().trim().min(1).max(200),
  definition: z.string().max(4000).optional().default(""),
  phonetic: z.string().max(200).optional().default(""),
  partOfSpeech: z.string().max(100).optional().default(""),
  context: z.string().max(5000).optional().default(""),
  anchor: z.record(z.string(), z.unknown()),
});

const updateVocabularySchema = z.object({
  id: z.string().min(1),
  definition: z.string().max(4000).optional(),
  phonetic: z.string().max(200).optional(),
  partOfSpeech: z.string().max(100).optional(),
  status: z.enum(["new", "learning", "mastered"]).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const dueOnly = url.searchParams.get("due") === "1";
  const bookId = url.searchParams.get("bookId");
  const query = url.searchParams.get("q")?.trim() || "";
  const conditions: string[] = [];
  const parameters: unknown[] = [];
  if (status && ["new", "learning", "mastered"].includes(status)) {
    conditions.push("v.status = ?");
    parameters.push(status);
  }
  if (dueOnly) {
    conditions.push("v.status != 'mastered' AND v.due_at <= ?");
    parameters.push(new Date().toISOString());
  }
  if (bookId) {
    conditions.push("v.book_id = ?");
    parameters.push(bookId);
  }
  if (query) {
    conditions.push("(v.term LIKE ? COLLATE NOCASE OR v.definition LIKE ? COLLATE NOCASE OR v.context LIKE ? COLLATE NOCASE)");
    parameters.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = sqlite.prepare(`
    SELECT v.*, b.title AS book_title, b.format AS book_format
    FROM vocabulary v
    JOIN books b ON b.id = v.book_id
    ${where}
    ORDER BY
      CASE WHEN v.status != 'mastered' AND v.due_at <= datetime('now') THEN 0 ELSE 1 END,
      v.due_at ASC,
      v.updated_at DESC
    LIMIT 500
  `).all(...parameters);
  const counts = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'mastered' AND due_at <= ? THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN status = 'learning' THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) AS mastered
    FROM vocabulary
  `).get(new Date().toISOString());
  return NextResponse.json({ words: rows, counts });
}

export async function POST(request: Request) {
  const parsed = createVocabularySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "生词内容不完整。", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const book = sqlite.prepare("SELECT id FROM books WHERE id = ?").get(input.bookId);
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  const normalizedTerm = normalizeTerm(input.term);
  const now = new Date().toISOString();
  const id = `word_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO vocabulary (
      id, book_id, term, normalized_term, definition, phonetic, part_of_speech,
      context, anchor_json, status, due_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
    ON CONFLICT(book_id, normalized_term) DO UPDATE SET
      term = excluded.term,
      context = CASE WHEN excluded.context != '' THEN excluded.context ELSE vocabulary.context END,
      anchor_json = excluded.anchor_json,
      definition = CASE WHEN excluded.definition != '' THEN excluded.definition ELSE vocabulary.definition END,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.bookId,
    input.term,
    normalizedTerm,
    input.definition,
    input.phonetic,
    input.partOfSpeech,
    input.context,
    JSON.stringify(input.anchor),
    now,
    now,
    now,
  );
  const word = sqlite.prepare(`
    SELECT v.*, b.title AS book_title, b.format AS book_format
    FROM vocabulary v JOIN books b ON b.id = v.book_id
    WHERE v.book_id = ? AND v.normalized_term = ?
  `).get(input.bookId, normalizedTerm);
  return NextResponse.json(word, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateVocabularySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "更新内容无效。" }, { status: 400 });
  const current = sqlite.prepare("SELECT * FROM vocabulary WHERE id = ?").get(parsed.data.id) as Record<string, unknown> | undefined;
  if (!current) return NextResponse.json({ error: "没有找到该生词。" }, { status: 404 });
  const next = parsed.data;
  sqlite.prepare(`
    UPDATE vocabulary SET
      definition = COALESCE(?, definition),
      phonetic = COALESCE(?, phonetic),
      part_of_speech = COALESCE(?, part_of_speech),
      status = COALESCE(?, status),
      updated_at = ?
    WHERE id = ?
  `).run(
    next.definition ?? null,
    next.phonetic ?? null,
    next.partOfSpeech ?? null,
    next.status ?? null,
    new Date().toISOString(),
    next.id,
  );
  return NextResponse.json(sqlite.prepare("SELECT * FROM vocabulary WHERE id = ?").get(next.id));
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少生词 ID。" }, { status: 400 });
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM vocabulary_reviews WHERE vocabulary_id = ?").run(id);
    sqlite.prepare("DELETE FROM vocabulary WHERE id = ?").run(id);
  })();
  return NextResponse.json({ ok: true });
}

function normalizeTerm(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
