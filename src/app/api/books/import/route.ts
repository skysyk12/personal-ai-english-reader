import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";
import type { ReflowPolicy } from "@/lib/books/pdf-reflow-types";
import { readEpubMetadata } from "@/lib/books/import-epub";
import { readPdfMetadata } from "@/lib/books/import-pdf";
import { ensureBookSearchIndex } from "@/lib/books/search-index";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const reflowPolicyInput = z.enum(["auto", "none", "local", "api"]);

// 不重排 → 原版；选了引擎 → 重排；自动沿用解析质量启发式。
function defaultModeForPolicy(policy: ReflowPolicy, parseScore: number | null): "reflow" | "original" {
  if (policy === "none") return "original";
  if (policy === "local" || policy === "api") return "reflow";
  return parseScore !== null && parseScore < 35 ? "original" : "reflow";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const requestedRoleId = formData.get("roleId");
  const requestedPolicy = formData.get("reflowPolicy");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择一个 EPUB 或 PDF 文件。" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "文件超过第一版的 100MB 限制。" }, { status: 413 });
  }
  const lowerName = file.name.toLowerCase();
  const format = lowerName.endsWith(".epub")
    ? "epub"
    : lowerName.endsWith(".pdf")
      ? "pdf"
      : null;
  if (!format) {
    return NextResponse.json(
      { error: "只支持 EPUB 或 PDF 文件。" },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = `book_${crypto.randomUUID()}`;
  const bookDirectory = path.join(process.cwd(), "data", "books", id);
  const originalPath = path.join(bookDirectory, `original.${format}`);
  const fallbackTitle = file.name.replace(/\.(epub|pdf)$/i, "");
  const now = new Date().toISOString();

  await fs.mkdir(bookDirectory, { recursive: true });
  await fs.writeFile(originalPath, bytes);

  try {
    const metadata = format === "epub"
      ? await readEpubMetadata(bytes, fallbackTitle)
      : await readPdfMetadata(bytes, fallbackTitle);
    let coverPath: string | null = null;
    if (format === "epub" && "cover" in metadata && metadata.cover) {
      coverPath = path.join(bookDirectory, `cover.${metadata.cover.extension}`);
      await fs.writeFile(coverPath, metadata.cover.bytes);
    }
    const pageCount = format === "pdf" && "pageCount" in metadata ? metadata.pageCount : null;
    const parseScore = format === "pdf" && "parseScore" in metadata ? metadata.parseScore : null;

    const roleId =
      typeof requestedRoleId === "string" && requestedRoleId
        ? requestedRoleId
        : ((sqlite
            .prepare("SELECT id FROM learning_roles WHERE is_default = 1 LIMIT 1")
            .get() as { id?: string } | undefined)?.id ?? null);

    const parsedPolicy = reflowPolicyInput.safeParse(requestedPolicy);
    const policy: ReflowPolicy = format === "pdf" && parsedPolicy.success
      ? parsedPolicy.data
      : "auto";

    sqlite.transaction(() => {
      sqlite
        .prepare(`
          INSERT INTO books (
            id, title, author, format, original_file_path, cover_path,
            import_status, pdf_parse_score, pdf_default_mode, reflow_policy,
            total_locations, default_role_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          metadata.title,
          metadata.author,
          format,
          originalPath,
          coverPath,
          parseScore,
          format === "pdf" ? defaultModeForPolicy(policy, parseScore) : null,
          format === "pdf" ? policy : "auto",
          pageCount,
          roleId,
          now,
          now,
        );
      sqlite
        .prepare(`
          INSERT INTO reading_progress (
            id, book_id, source_type, percentage, role_id, updated_at
          ) VALUES (?, ?, ?, 0, ?, ?)
        `)
        .run(`progress_${crypto.randomUUID()}`, id, format, roleId, now);
    })();

    if (format === "epub") {
      await ensureBookSearchIndex({ id, format });
    }

    return NextResponse.json(
      { id, title: metadata.title, author: metadata.author, format },
      { status: 201 },
    );
  } catch (error) {
    await fs.rm(bookDirectory, { recursive: true, force: true });
    return NextResponse.json(
      {
        error: format === "pdf" ? "PDF 文件无法读取。" : "EPUB 结构无法读取。",
        details: error instanceof Error ? error.message : "Unknown import error",
      },
      { status: 422 },
    );
  }
}
