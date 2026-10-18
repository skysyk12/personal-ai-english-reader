import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { sqlite } from "@/db";
import type { PdfReflowDocument, ReflowPolicy } from "@/lib/books/pdf-reflow-types";
import { extractPdfReflow, mergeOcrPages } from "@/lib/books/reflow-pdf";
import { ensureBookSearchIndex } from "@/lib/books/search-index";
import { extractPdfWithLocalOcr } from "@/lib/ocr/local-tesseract";
import {
  extractPdfWithPaddleOcr,
  getPaddleOcrConfig,
  PaddleOcrNotConfiguredError,
} from "@/lib/ocr/paddle-ocr-vl";

export const runtime = "nodejs";
export const maxDuration = 300;

const CACHE_FILENAME = "reflow-v8.json";
const ASSET_DIRECTORY = "reflow-assets-v8";
const activeJobs = new Map<string, Promise<PdfReflowDocument>>();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const book = sqlite
    .prepare(
      "SELECT format, original_file_path, pdf_parse_score, COALESCE(reflow_policy, 'auto') AS policy FROM books WHERE id = ?",
    )
    .get(bookId) as {
      format: string;
      original_file_path: string;
      pdf_parse_score: number | null;
      policy: ReflowPolicy;
    } | undefined;
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  if (book.format !== "pdf") {
    return NextResponse.json({ error: "只有 PDF 支持文本重排。" }, { status: 415 });
  }

  const cachePath = path.join(path.dirname(book.original_file_path), CACHE_FILENAME);
  const assetDirectory = path.join(path.dirname(book.original_file_path), ASSET_DIRECTORY);
  try {
    if (new URL(request.url).searchParams.get("refresh") === "1") {
      await Promise.all([
        fs.rm(cachePath, { force: true }),
        fs.rm(assetDirectory, { recursive: true, force: true }),
      ]);
    }
    const cached = await readCache(cachePath);
    if (cached && cacheMatchesPlan(cached, resolveReflowPlan(book.policy, book.pdf_parse_score))) {
      await ensureSearchIndexIfStale(bookId, cached);
      return NextResponse.json(cached, { headers: privateCacheHeaders() });
    }

    let job = activeJobs.get(bookId);
    if (!job) {
      job = createReflow(
        bookId,
        book.original_file_path,
        book.pdf_parse_score,
        cachePath,
        assetDirectory,
        book.policy,
      );
      activeJobs.set(bookId, job);
    }
    const document = await job;
    return NextResponse.json(document, { headers: privateCacheHeaders() });
  } catch (error) {
    const notConfigured = error instanceof PaddleOcrNotConfiguredError;
    return NextResponse.json(
      {
        error: notConfigured
          ? "这份扫描 PDF 需要 PaddleOCR-VL 才能重排。"
          : "PDF 文本重排失败，请切换到 PDF 原版阅读。",
        details: error instanceof Error ? error.message : "Unknown reflow error",
        code: notConfigured ? error.code : "PDF_REFLOW_FAILED",
      },
      { status: notConfigured ? 503 : 422 },
    );
  } finally {
    activeJobs.delete(bookId);
  }
}

type OcrEngine = "paddle" | "tesseract";

type ReflowPlan = {
  // Engine for whole-book OCR of scanned PDFs; null = start from native text.
  wholeBookEngine: OcrEngine | null;
  // Engine that fills image-only pages of an otherwise text-based PDF.
  mergeEngine: OcrEngine | null;
};

function resolveReflowPlan(policy: ReflowPolicy, parseScore: number | null): ReflowPlan {
  const scanned = parseScore !== null && parseScore < 35;
  const paddleReady = getPaddleOcrConfig().configured;
  switch (policy) {
    case "local":
      return scanned
        ? { wholeBookEngine: "tesseract", mergeEngine: null }
        : { wholeBookEngine: null, mergeEngine: "tesseract" };
    case "api":
      return scanned
        ? { wholeBookEngine: "paddle", mergeEngine: null }
        : { wholeBookEngine: null, mergeEngine: paddleReady ? "paddle" : null };
    case "none":
      // "不重排" books default to the original view, but a manual switch to
      // reflow still works: prefer the configured cloud engine, else local.
      return {
        wholeBookEngine: scanned ? (paddleReady ? "paddle" : "tesseract") : null,
        mergeEngine: paddleReady ? "paddle" : "tesseract",
      };
    default:
      // auto — the behavior from before reflow policies existed.
      return scanned
        ? { wholeBookEngine: "paddle", mergeEngine: null }
        : { wholeBookEngine: null, mergeEngine: paddleReady ? "paddle" : null };
  }
}

function engineProvider(engine: OcrEngine): "PaddleOCR-VL" | "Tesseract.js" {
  return engine === "tesseract" ? "Tesseract.js" : "PaddleOCR-VL";
}

// A cached document stays valid when it was produced by the engine the current
// policy asks for; otherwise it is regenerated with the right engine.
function cacheMatchesPlan(cached: PdfReflowDocument, plan: ReflowPlan): boolean {
  if (plan.wholeBookEngine) {
    return cached.ocr?.provider === engineProvider(plan.wholeBookEngine);
  }
  if (plan.mergeEngine) {
    // This engine already ran (even if every scanned page stayed empty).
    if (cached.ocr?.provider === engineProvider(plan.mergeEngine)) return true;
    // No OCR pages yet: keep the cache only if there is nothing left to merge.
    return !cached.pages.some((page) => page.analysis.source === "image-only");
  }
  return true;
}

async function createReflow(
  bookId: string,
  originalPath: string,
  parseScore: number | null,
  cachePath: string,
  assetDirectory: string,
  policy: ReflowPolicy,
) {
  const reflowOptions = {
    assetDirectory,
    assetUrlBase: `/api/books/${encodeURIComponent(bookId)}/reflow-assets`,
  };
  const plan = resolveReflowPlan(policy, parseScore);
  let document: PdfReflowDocument;

  if (plan.wholeBookEngine === "tesseract") {
    const bytes = new Uint8Array(await fs.readFile(originalPath));
    document = await extractPdfWithLocalOcr(bytes, reflowOptions);
  } else if (plan.wholeBookEngine === "paddle") {
    document = await extractPdfWithPaddleOcr(originalPath, reflowOptions);
  } else {
    const bytes = new Uint8Array(await fs.readFile(originalPath));
    document = await extractPdfReflow(bytes, reflowOptions);
    const imageOnlyPages = document.pages
      .filter((page) => page.analysis.source === "image-only")
      .map((page) => page.pageNumber);
    if (imageOnlyPages.length && plan.mergeEngine) {
      try {
        const ocrDocument = plan.mergeEngine === "tesseract"
          ? await extractPdfWithLocalOcr(bytes, { ...reflowOptions, pages: imageOnlyPages, saveScans: false })
          : await extractPdfWithPaddleOcr(originalPath, reflowOptions);
        document = mergeOcrPages(document, ocrDocument);
      } catch (error) {
        // A mixed PDF remains useful with its native text even if hosted OCR
        // is temporarily unavailable for a small number of scanned pages.
        if (plan.mergeEngine !== "paddle") throw error;
      }
    }
  }
  const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(document));
  await fs.rename(temporaryPath, cachePath);
  // Rebuild the PDF search documents after v8 OCR/reflow so newly recognized
  // scan text becomes searchable without waiting for a separate search visit.
  await ensureBookSearchIndex({ id: bookId, format: "pdf" });
  return document;
}

async function ensureSearchIndexIfStale(bookId: string, document: PdfReflowDocument) {
  const latest = sqlite.prepare(`
    SELECT MAX(updated_at) AS updated_at
    FROM search_documents
    WHERE book_id = ? AND source_type = 'pdf-page'
  `).get(bookId) as { updated_at?: string | null } | undefined;
  if (!latest?.updated_at || latest.updated_at < document.generatedAt) {
    await ensureBookSearchIndex({ id: bookId, format: "pdf" });
  }
}

async function readCache(cachePath: string): Promise<PdfReflowDocument | null> {
  try {
    const value = JSON.parse(await fs.readFile(cachePath, "utf8")) as PdfReflowDocument;
    return value.version === 8 && Array.isArray(value.pages) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function privateCacheHeaders() {
  return { "Cache-Control": "private, max-age=3600" };
}
