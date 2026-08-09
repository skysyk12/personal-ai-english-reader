import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const row = sqlite.prepare("SELECT cover_path FROM books WHERE id = ?").get(bookId) as { cover_path?: string } | undefined;
  if (!row?.cover_path) return new NextResponse(null, { status: 404 });
  try {
    const bytes = await fs.readFile(row.cover_path);
    const extension = path.extname(row.cover_path).toLowerCase();
    const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return new Response(bytes, { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new NextResponse(null, { status: 410 });
  }
}
