import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { sqlite } from "@/db";
import type { PdfReflowDocument } from "@/lib/books/pdf-reflow-types";
import { extractPdfReflow } from "@/lib/books/reflow-pdf";

export const runtime = "nodejs";
export const maxDuration = 120;

const CACHE_FILENAME = "reflow-v5.json";
const activeJobs = new Map<string, Promise<PdfReflowDocument>>();

export async function GET(
  _: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const book = sqlite
    .prepare("SELECT format, original_file_path FROM books WHERE id = ?")
    .get(bookId) as { format: string; original_file_path: string } | undefined;
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  if (book.format !== "pdf") {
    return NextResponse.json({ error: "只有 PDF 支持文本重排。" }, { status: 415 });
  }

  const cachePath = path.join(path.dirname(book.original_file_path), CACHE_FILENAME);
  try {
    const cached = await readCache(cachePath);
    if (cached) return NextResponse.json(cached, { headers: privateCacheHeaders() });

    let job = activeJobs.get(bookId);
    if (!job) {
      job = createReflow(book.original_file_path, cachePath);
      activeJobs.set(bookId, job);
    }
    const document = await job;
    return NextResponse.json(document, { headers: privateCacheHeaders() });
  } catch (error) {
    return NextResponse.json(
      {
        error: "PDF 文本重排失败，请切换到 PDF 原版阅读。",
        details: error instanceof Error ? error.message : "Unknown reflow error",
      },
      { status: 422 },
    );
  } finally {
    activeJobs.delete(bookId);
  }
}

async function createReflow(originalPath: string, cachePath: string) {
  const bytes = new Uint8Array(await fs.readFile(originalPath));
  const document = await extractPdfReflow(bytes);
  const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(document));
  await fs.rename(temporaryPath, cachePath);
  return document;
}

async function readCache(cachePath: string): Promise<PdfReflowDocument | null> {
  try {
    const value = JSON.parse(await fs.readFile(cachePath, "utf8")) as PdfReflowDocument;
    return value.version === 5 && Array.isArray(value.pages) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function privateCacheHeaders() {
  return { "Cache-Control": "private, max-age=3600" };
}
