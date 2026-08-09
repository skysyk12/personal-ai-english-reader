import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const book = sqlite
    .prepare("SELECT title, format, original_file_path FROM books WHERE id = ?")
    .get(bookId) as
    | { title: string; format: string; original_file_path: string }
    | undefined;
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });

  try {
    const bytes = await fs.readFile(book.original_file_path);
    return new Response(bytes, {
      headers: {
        "Content-Type": book.format === "epub" ? "application/epub+zip" : "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(book.title)}.${book.format}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "本地书籍文件已丢失。" }, { status: 410 });
  }
}
