import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = sqlite
    .prepare(`
      SELECT
        b.*,
        COALESCE(p.percentage, 0) AS progress,
        p.epub_cfi AS epubCfi,
        p.pdf_page AS pdfPage,
        COUNT(DISTINCT n.id) AS noteCount
      FROM books b
      LEFT JOIN reading_progress p ON p.book_id = b.id
      LEFT JOIN notes n ON n.book_id = b.id
      GROUP BY b.id
      ORDER BY COALESCE(b.last_opened_at, b.created_at) DESC
    `)
    .all();
  return NextResponse.json(rows);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) return NextResponse.json({ error: "缺少书籍 ID。" }, { status: 400 });

  const book = sqlite.prepare("SELECT id FROM books WHERE id = ?").get(bookId);
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });

  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM reading_progress WHERE book_id = ?").run(bookId);
    sqlite.prepare("DELETE FROM highlights WHERE book_id = ?").run(bookId);
    sqlite.prepare("DELETE FROM notes WHERE book_id = ?").run(bookId);
    sqlite
      .prepare("DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE book_id = ?)")
      .run(bookId);
    sqlite.prepare("DELETE FROM ai_conversations WHERE book_id = ?").run(bookId);
    sqlite.prepare("DELETE FROM books WHERE id = ?").run(bookId);
  })();
  await fs.rm(path.join(process.cwd(), "data", "books", bookId), {
    recursive: true,
    force: true,
  });
  return NextResponse.json({ ok: true });
}
