import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const book = sqlite
    .prepare(`
      SELECT b.*, p.epub_cfi AS epubCfi, p.pdf_page AS pdfPage,
        p.percentage, p.role_id AS roleId
      FROM books b
      LEFT JOIN reading_progress p ON p.book_id = b.id
      WHERE b.id = ?
    `)
    .get(bookId);
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  return NextResponse.json(book);
}
