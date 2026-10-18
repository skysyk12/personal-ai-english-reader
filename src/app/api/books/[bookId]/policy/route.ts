import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";
import type { ReflowPolicy } from "@/lib/books/pdf-reflow-types";

export const runtime = "nodejs";

const policyInput = z.object({
  reflowPolicy: z.enum(["auto", "none", "local", "api"]),
});

// Mirrors the import-time mapping: 不重排 → 原版；选了引擎 → 重排；
// 自动沿用解析质量启发式。
function defaultModeForPolicy(policy: ReflowPolicy, parseScore: number | null): "reflow" | "original" {
  if (policy === "none") return "original";
  if (policy === "local" || policy === "api") return "reflow";
  return parseScore !== null && parseScore < 35 ? "original" : "reflow";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const parsed = policyInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "重排策略无效。" }, { status: 400 });
  }
  const book = sqlite
    .prepare("SELECT format, original_file_path, pdf_parse_score, COALESCE(reflow_policy, 'auto') AS policy FROM books WHERE id = ?")
    .get(bookId) as {
      format: string;
      original_file_path: string;
      pdf_parse_score: number | null;
      policy: ReflowPolicy;
    } | undefined;
  if (!book) return NextResponse.json({ error: "没有找到该书籍。" }, { status: 404 });
  if (book.format !== "pdf") {
    return NextResponse.json({ error: "只有 PDF 支持重排策略。" }, { status: 415 });
  }

  const nextPolicy = parsed.data.reflowPolicy;
  const nextMode = defaultModeForPolicy(nextPolicy, book.pdf_parse_score);
  const now = new Date().toISOString();
  sqlite
    .prepare("UPDATE books SET reflow_policy = ?, pdf_default_mode = ?, updated_at = ? WHERE id = ?")
    .run(nextPolicy, nextMode, now, bookId);

  // A policy change may switch the OCR engine, so the cached reflow document
  // (and its assets) must be regenerated with the new engine.
  if (nextPolicy !== book.policy) {
    const bookDirectory = path.dirname(book.original_file_path);
    await Promise.all([
      fs.rm(path.join(bookDirectory, "reflow-v8.json"), { force: true }),
      fs.rm(path.join(bookDirectory, "reflow-assets-v8"), { recursive: true, force: true }),
    ]);
  }

  return NextResponse.json({ ok: true, reflowPolicy: nextPolicy, pdfDefaultMode: nextMode });
}
