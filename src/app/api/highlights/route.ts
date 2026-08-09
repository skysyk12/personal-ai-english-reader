import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const highlightInput = z.object({
  bookId: z.string().min(1),
  anchor: z.discriminatedUnion("type", [
    z.object({ type: z.literal("epub"), cfiRange: z.string().min(1).max(4000) }),
    z.object({
      type: z.literal("pdf"),
      page: z.number().int().min(1),
      textQuote: z.string().trim().min(1).max(2000),
    }),
  ]),
  selectedText: z.string().trim().min(1).max(2000),
  color: z.enum(["yellow", "blue", "green", "red"]).default("yellow"),
});

export async function GET(request: Request) {
  const bookId = new URL(request.url).searchParams.get("bookId");
  if (!bookId) return NextResponse.json({ error: "缺少书籍 ID。" }, { status: 400 });
  const rows = sqlite
    .prepare("SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at")
    .all(bookId);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const parsed = highlightInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "高亮信息无效。" }, { status: 400 });
  const now = new Date().toISOString();
  const id = `highlight_${crypto.randomUUID()}`;
  sqlite
    .prepare(`
      INSERT INTO highlights (
        id, book_id, anchor_type, anchor_json, selected_text, color, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      parsed.data.bookId,
      parsed.data.anchor.type,
      JSON.stringify(parsed.data.anchor),
      parsed.data.selectedText,
      parsed.data.color,
      now,
      now,
    );
  return NextResponse.json({ id, ...parsed.data, createdAt: now }, { status: 201 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少高亮 ID。" }, { status: 400 });
  sqlite.prepare("DELETE FROM highlights WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
