import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ bookId: string; filename: string }> },
) {
  const { bookId, filename } = await params;
  if (!/^page-\d+-image-\d+\.webp$/.test(filename) || path.basename(filename) !== filename) {
    return NextResponse.json({ error: "无效的图片路径。" }, { status: 400 });
  }
  const book = sqlite
    .prepare("SELECT original_file_path FROM books WHERE id = ? AND format = 'pdf'")
    .get(bookId) as { original_file_path: string } | undefined;
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });

  try {
    const imagePath = path.join(path.dirname(book.original_file_path), "reflow-assets-v6", filename);
    const bytes = await fs.readFile(imagePath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "图片尚未生成。" }, { status: 404 });
    }
    return NextResponse.json({ error: "读取 PDF 图片失败。" }, { status: 500 });
  }
}
