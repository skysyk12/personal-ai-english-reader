import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const startSchema = z.object({
  bookId: z.string().min(1),
  startPercentage: z.number().min(0).max(100).optional().default(0),
});

const updateSchema = z.object({
  id: z.string().min(1),
  durationSeconds: z.number().int().min(0).max(24 * 60 * 60),
  endPercentage: z.number().min(0).max(100).optional().default(0),
  ended: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "阅读会话参数无效。" }, { status: 400 });
  const book = sqlite.prepare("SELECT id FROM books WHERE id = ?").get(parsed.data.bookId);
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  const id = `session_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO reading_sessions (
      id, book_id, started_at, duration_seconds, start_percentage, end_percentage
    ) VALUES (?, ?, ?, 0, ?, ?)
  `).run(id, parsed.data.bookId, new Date().toISOString(), parsed.data.startPercentage, parsed.data.startPercentage);
  return NextResponse.json({ id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "阅读会话更新无效。" }, { status: 400 });
  const now = new Date().toISOString();
  const result = sqlite.prepare(`
    UPDATE reading_sessions SET
      duration_seconds = MAX(duration_seconds, ?),
      end_percentage = ?,
      ended_at = CASE WHEN ? = 1 THEN ? ELSE ended_at END
    WHERE id = ?
  `).run(
    parsed.data.durationSeconds,
    parsed.data.endPercentage,
    parsed.data.ended ? 1 : 0,
    now,
    parsed.data.id,
  );
  if (!result.changes) return NextResponse.json({ error: "没有找到阅读会话。" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
