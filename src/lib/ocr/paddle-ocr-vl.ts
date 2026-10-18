import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";

import type {
  PdfReflowBlock,
  PdfReflowDocument,
  PdfReflowImageBlock,
  PdfReflowLayout,
  PdfReflowPage,
  PdfReflowTableBlock,
} from "@/lib/books/pdf-reflow-types";

const DEFAULT_MODEL = "PaddleOCR-VL-1.6";

export class PaddleOcrNotConfiguredError extends Error {
  readonly code = "OCR_NOT_CONFIGURED";

  constructor() {
    super("PaddleOCR-VL 尚未配置。请在 .env.local 中添加 PADDLEOCR_ACCESS_TOKEN，重启应用后再试；PDF 原版仍可直接阅读。");
    this.name = "PaddleOcrNotConfiguredError";
  }
}

export function getPaddleOcrConfig() {
  return {
    configured: Boolean(process.env.PADDLEOCR_ACCESS_TOKEN?.trim()),
    model: process.env.PADDLEOCR_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: process.env.PADDLEOCR_BASE_URL?.trim() || undefined,
    provider: "PaddleOCR-VL" as const,
    language: "auto" as const,
  };
}

export async function extractPdfWithPaddleOcr(
  filePath: string,
  options: { assetDirectory: string; assetUrlBase: string },
): Promise<PdfReflowDocument> {
  const config = getPaddleOcrConfig();
  const token = process.env.PADDLEOCR_ACCESS_TOKEN?.trim();
  if (!token) throw new PaddleOcrNotConfiguredError();

  await fs.mkdir(options.assetDirectory, { recursive: true });
  // Keep the hosted SDK out of the normal reader bundle. It is loaded only
  // when a scanned PDF actually requests OCR/reflow.
  const { PaddleOCRClient } = await import("@paddleocr/api-sdk");
  const client = new PaddleOCRClient({
    token,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    requestTimeout: 300_000,
    pollTimeout: 1_800_000,
  });
  const result = await client.parseDocument({
    filePath,
    model: config.model,
    options: {
      useDocOrientationClassify: true,
      useDocUnwarping: true,
      useLayoutDetection: true,
      useChartRecognition: true,
      useOcrForImageBlock: true,
      mergeLayoutBlocks: true,
      prettifyMarkdown: true,
      restructurePages: true,
      relevelTitles: true,
      returnMarkdownImages: true,
    },
  });

  const pages: PdfReflowPage[] = [];
  for (let index = 0; index < result.pages.length; index += 1) {
    const parsed = result.pages[index];
    const pageNumber = index + 1;
    const images = await savePageImages(
      client,
      parsed.markdownImages,
      pageNumber,
      options,
    );
    const blocks = markdownToBlocks(parsed.markdownText, pageNumber, images);
    pages.push({
      pageNumber,
      blocks,
      analysis: {
        source: blocks.some((block) => block.kind !== "image") ? "ocr" : "image-only",
        confidence: null,
        columnCount: 1,
        tableCount: blocks.filter((block) => block.kind === "table").length,
        captionCount: blocks.filter((block) => block.kind === "caption").length,
      },
    });
  }

  return buildDocument(pages, result.jobId, config.model);
}

function buildDocument(pages: PdfReflowPage[], jobId: string | undefined, model: string): PdfReflowDocument {
  return {
    version: 8,
    generatedAt: new Date().toISOString(),
    pageCount: pages.length,
    textPageCount: pages.filter((page) => page.analysis.source !== "image-only").length,
    ocrPageCount: pages.filter((page) => page.analysis.source === "ocr").length,
    imageCount: pages.reduce(
      (total, page) => total + page.blocks.filter((block) => block.kind === "image").length,
      0,
    ),
    tableCount: pages.reduce((total, page) => total + page.analysis.tableCount, 0),
    captionCount: pages.reduce((total, page) => total + page.analysis.captionCount, 0),
    ocr: {
      provider: "PaddleOCR-VL",
      model,
      language: "auto",
      jobId,
    },
    pages,
  };
}

type PaddleClient = {
  saveResource: (
    resourceUrl: string,
    destination: string,
    options?: { overwrite?: boolean },
  ) => Promise<string>;
};

type SavedImage = PdfReflowImageBlock & { aliases: string[] };

async function savePageImages(
  client: PaddleClient,
  resources: Record<string, string>,
  pageNumber: number,
  options: { assetDirectory: string; assetUrlBase: string },
) {
  const saved: SavedImage[] = [];
  const entries = Object.entries(resources);
  for (let index = 0; index < entries.length; index += 1) {
    const [key, resourceUrl] = entries[index];
    if (!/^https?:\/\//i.test(resourceUrl)) continue;
    const extension = imageExtension(key) || imageExtension(resourceUrl) || "png";
    const filename = `paddle-page-${pageNumber}-image-${index + 1}.${extension}`;
    const destination = path.join(options.assetDirectory, filename);
    try {
      await client.saveResource(resourceUrl, destination, { overwrite: true });
      const image = await loadImage(destination);
      saved.push({
        id: `pdf-${pageNumber}-paddle-image-${index + 1}`,
        kind: "image",
        src: `${options.assetUrlBase}/${encodeURIComponent(filename)}`,
        alt: `第 ${pageNumber} 页图片 ${index + 1}`,
        intrinsicWidth: image.width,
        intrinsicHeight: image.height,
        role: "figure",
        layout: defaultImageLayout(index, entries.length),
        aliases: [key, resourceUrl],
      });
    } catch {
      // One expired/malformed image URL must not discard the recognized text.
    }
  }
  return saved;
}

function markdownToBlocks(markdown: string, pageNumber: number, images: SavedImage[]): PdfReflowBlock[] {
  const blocks: PdfReflowBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let blockNumber = 0;

  const nextId = () => `pdf-${pageNumber}-paddle-${++blockNumber}`;
  const flushParagraph = () => {
    const text = cleanMarkdownText(paragraph.join(" "));
    paragraph = [];
    if (text) blocks.push({ id: nextId(), kind: "paragraph", text });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const imageMatches = [...line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    if (imageMatches.length) {
      flushParagraph();
      for (const match of imageMatches) {
        const reference = match[2].trim();
        const image = images.find((candidate) => candidate.aliases.includes(reference));
        if (image) blocks.push({ ...image, alt: cleanMarkdownText(match[1]) || image.alt });
      }
      const remainder = cleanMarkdownText(line.replace(/!\[[^\]]*\]\([^)]+\)/g, " "));
      if (remainder) blocks.push({ id: nextId(), kind: "caption", text: remainder });
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ id: nextId(), kind: "heading", text: cleanMarkdownText(heading[1]) });
      continue;
    }

    if (/^\s*(?:[-*+] |\d+[.)]\s+)/.test(line)) {
      flushParagraph();
      blocks.push({
        id: nextId(),
        kind: "list-item",
        text: cleanMarkdownText(line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/, "")),
      });
      continue;
    }

    if (line.includes("|") && lines[index + 1]?.trim().match(/^\|?\s*:?-{2,}/)) {
      flushParagraph();
      const tableLines = [line];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      blocks.push({
        id: nextId(),
        kind: "table",
        rows: tableLines.map(parseTableRow).filter((row) => row.some(Boolean)),
        layout: defaultLayout(),
      } satisfies PdfReflowTableBlock);
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();

  // Paddle may return image resources separately even when the markdown omits
  // explicit image syntax. Preserve them instead of silently losing magazine art.
  const usedImageIds = new Set(blocks.flatMap((block) => block.kind === "image" ? [block.id] : []));
  for (const image of images) {
    if (!usedImageIds.has(image.id)) blocks.push(image);
  }
  return blocks;
}

function parseTableRow(line: string) {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cleanMarkdownText(cell));
}

function cleanMarkdownText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\\([#$%&])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function imageExtension(value: string) {
  const clean = value.split(/[?#]/)[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  const extension = match?.[1]?.toLowerCase();
  return extension && ["png", "jpg", "jpeg", "webp", "gif"].includes(extension)
    ? extension
    : "";
}

function defaultLayout(): PdfReflowLayout {
  return { left: 0.13, top: 0.1, width: 0.74, height: 0.2 };
}

function defaultImageLayout(index: number, count: number): PdfReflowLayout {
  return {
    left: 0.13,
    top: Math.min(0.82, 0.08 + index / Math.max(1, count) * 0.72),
    width: 0.74,
    height: Math.min(0.72, 0.72 / Math.max(1, count)),
  };
}
