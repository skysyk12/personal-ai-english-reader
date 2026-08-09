import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const progressInput = z.object({
  epubCfi: z.string().max(4000).nullable().optional(),
  pdfPage: z.number().int().min(1).nullable().optional(),
  pdfViewMode: z.enum(["reflow", "original"]).optional(),
  percentage: z.number().min(0).max(100),
  roleId: z.string().nullable().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const parsed = progressInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "阅读进度无效。" }, { status: 400 });
  }
  const book = sqlite
    .prepare("SELECT format FROM books WHERE id = ?")
    .get(bookId) as { format: "epub" | "pdf" } | undefined;
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  const now = new Date().toISOString();
  sqlite
    .prepare(`
      INSERT INTO reading_progress (
        id, book_id, source_type, epub_cfi, pdf_page, percentage, role_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        source_type = excluded.source_type,
        epub_cfi = excluded.epub_cfi,
        pdf_page = excluded.pdf_page,
        percentage = excluded.percentage,
        role_id = COALESCE(excluded.role_id, reading_progress.role_id),
        updated_at = excluded.updated_at
    `)
    .run(
      `progress_${crypto.randomUUID()}`,
      bookId,
      book.format,
      parsed.data.epubCfi ?? null,
      parsed.data.pdfPage ?? null,
      Math.round(parsed.data.percentage),
      parsed.data.roleId ?? null,
      now,
    );
  sqlite
    .prepare(`
      UPDATE books SET
        pdf_default_mode = CASE WHEN format = 'pdf' THEN COALESCE(?, pdf_default_mode) ELSE pdf_default_mode END,
        last_opened_at = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .run(parsed.data.pdfViewMode ?? null, now, now, bookId);
  return NextResponse.json({ ok: true });
}
