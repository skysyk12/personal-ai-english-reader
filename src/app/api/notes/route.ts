import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const noteInput = z.object({
  bookId: z.string().min(1),
  highlightId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  noteType: z.enum(["personal", "ai-answer", "vocabulary", "grammar", "expression", "bookmark"]),
  title: z.string().trim().max(160).default(""),
  selectedText: z.string().trim().max(2000).default(""),
  contentMarkdown: z.string().trim().min(1).max(100_000),
  anchor: z.record(z.string(), z.unknown()),
  roleId: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const bookId = params.get("bookId");
  const type = params.get("type");
  const filters: string[] = [];
  const values: string[] = [];
  if (bookId) {
    filters.push("n.book_id = ?");
    values.push(bookId);
  }
  if (type && type !== "all") {
    filters.push("n.note_type = ?");
    values.push(type);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = sqlite
    .prepare(`
      SELECT
        n.*,
        b.title AS bookTitle,
        r.name AS roleName
      FROM notes n
      JOIN books b ON b.id = n.book_id
      LEFT JOIN learning_roles r ON r.id = n.role_id
      ${where}
      ORDER BY n.created_at DESC
    `)
    .all(...values);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const parsed = noteInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "笔记内容无效。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const value = parsed.data;
  const id = `note_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  sqlite
    .prepare(`
      INSERT INTO notes (
        id, book_id, highlight_id, conversation_id, note_type, title,
        selected_text, content_markdown, anchor_json, role_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      value.bookId,
      value.highlightId ?? null,
      value.conversationId ?? null,
      value.noteType,
      value.title,
      value.selectedText,
      value.contentMarkdown,
      JSON.stringify(value.anchor),
      value.roleId ?? null,
      now,
      now,
    );
  return NextResponse.json({ id, createdAt: now }, { status: 201 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少笔记 ID。" }, { status: 400 });
  sqlite.prepare("DELETE FROM notes WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
