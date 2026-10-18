import "server-only";

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";

import { buildReflowPageFromWords, type PositionedText } from "@/lib/books/reflow-pdf";
import { withPdfDocument } from "@/lib/books/pdf-server";
import type {
  PdfReflowDocument,
  PdfReflowPage,
} from "@/lib/books/pdf-reflow-types";
import type { PDFDocumentProxy } from "pdfjs-dist";

const MODEL_LABEL = "Tesseract.js 7.0.0";
const MIN_WORD_CONFIDENCE = 25;

type TesseractBbox = { x0: number; y0: number; x1: number; y1: number };
type TesseractWord = { text: string; confidence: number; bbox: TesseractBbox };

export function getLocalOcrConfig() {
  let available = false;
  try {
    createRequire(import.meta.url).resolve("tesseract.js");
    available = true;
  } catch {
    available = false;
  }
  return {
    available,
    provider: "Tesseract.js" as const,
    model: MODEL_LABEL,
    language: "eng" as const,
  };
}

export async function extractPdfWithLocalOcr(
  bytes: Uint8Array,
  options: {
    assetDirectory: string;
    assetUrlBase: string;
    // Page numbers to recognize; omitted = whole book. Other pages become
    // image-only placeholders so indexes stay aligned with the native document
    // for mergeOcrPages.
    pages?: number[];
    // Whole-book mode saves the rendered scan next to the recognized text;
    // merge mode reuses the native page images instead.
    saveScans?: boolean;
  },
): Promise<PdfReflowDocument> {
  await fs.mkdir(options.assetDirectory, { recursive: true });

  const require = createRequire(import.meta.url);
  const engData = require("@tesseract.js-data/eng") as {
    code: string;
    gzip: boolean;
    langPath: string;
  };
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    langPath: engData.langPath,
    gzip: true,
    legacyLang: false,
  });

  try {
    return await withPdfDocument(bytes, async (document) => {
      const requested = new Set(options.pages ?? []);
      const wholeBook = !options.pages?.length;
      const saveScans = options.saveScans ?? true;
      const pages: PdfReflowPage[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        if (!wholeBook && !requested.has(pageNumber)) {
          pages.push(placeholderPage(pageNumber));
          continue;
        }
        pages.push(await recognizePage(worker, document, pageNumber, {
          assetDirectory: options.assetDirectory,
          assetUrlBase: options.assetUrlBase,
          saveScans: wholeBook && saveScans,
        }));
      }
      return buildLocalOcrDocument(pages);
    });
  } finally {
    await worker.terminate();
  }
}

function placeholderPage(pageNumber: number): PdfReflowPage {
  return {
    pageNumber,
    blocks: [],
    analysis: {
      source: "image-only",
      confidence: null,
      columnCount: 0,
      tableCount: 0,
      captionCount: 0,
    },
  };
}

async function recognizePage(
  worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>>,
  document: PDFDocumentProxy,
  pageNumber: number,
  options: { assetDirectory: string; assetUrlBase: string; saveScans: boolean },
): Promise<PdfReflowPage> {
  const page = await document.getPage(pageNumber);
  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.4, Math.max(1.7, 1600 / baseViewport.width));
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    // pdf.js renders on a transparent background by default; scanned pages
    // need an opaque white ground or Tesseract sees inverted edges.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const { data } = await worker.recognize(
      canvas.toBuffer("image/png"),
      {},
      { blocks: true },
    );
    const words = collectWords(data);
    const items: PositionedText[] = [];
    for (const word of words) {
      const text = word.text.replace(/\s+/g, " ").trim();
      if (!text || word.confidence < MIN_WORD_CONFIDENCE) continue;
      items.push({
        text,
        x: word.bbox.x0 / scale,
        // Tesseract uses canvas pixels from the top-left; the reflow chain
        // expects a PDF-space baseline with y growing upward.
        y: (viewport.height - word.bbox.y1) / scale,
        width: (word.bbox.x1 - word.bbox.x0) / scale,
        fontSize: Math.max(1, (word.bbox.y1 - word.bbox.y0) / scale),
        bold: false,
        confidence: word.confidence / 100,
      });
    }

    const scanBlock = options.saveScans
      ? await savePageScan(canvas, pageNumber, options)
      : null;
    const built = items.length
      ? buildReflowPageFromWords({
          pageNumber,
          items,
          images: [],
          pageWidth: baseViewport.width,
          pageHeight: baseViewport.height,
        })
      : { blocks: [], columnCount: 0 };
    const blocks = built.blocks;
    const orderedBlocks = scanBlock ? [scanBlock, ...blocks] : blocks;
    const confidence = items.length
      ? items.reduce((total, item) => total + (item.confidence ?? 0), 0) / items.length
      : null;

    return {
      pageNumber,
      blocks: orderedBlocks,
      analysis: {
        source: items.length ? "ocr" : "image-only",
        confidence,
        columnCount: built.columnCount,
        tableCount: blocks.filter((block) => block.kind === "table").length,
        captionCount: blocks.filter((block) => block.kind === "caption").length,
      },
    };
  } finally {
    page.cleanup();
  }
}

function collectWords(data: unknown): TesseractWord[] {
  const page = data as {
    blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: TesseractWord[] }> }> }> | null;
    words?: TesseractWord[] | null;
  };
  if (Array.isArray(page.blocks)) {
    return page.blocks.flatMap((block) =>
      (block.paragraphs ?? []).flatMap((paragraph) => (paragraph.lines ?? []).flatMap((line) => line.words ?? [])),
    );
  }
  return Array.isArray(page.words) ? page.words : [];
}

async function savePageScan(
  canvas: Canvas,
  pageNumber: number,
  options: { assetDirectory: string; assetUrlBase: string },
) {
  const filename = `scan-page-${pageNumber}.webp`;
  await fs.writeFile(path.join(options.assetDirectory, filename), await canvas.encode("webp", 82));
  return {
    id: `pdf-page-${pageNumber}-scan`,
    kind: "image" as const,
    src: `${options.assetUrlBase}/${filename}`,
    alt: `第 ${pageNumber} 页扫描原图`,
    intrinsicWidth: canvas.width,
    intrinsicHeight: canvas.height,
    role: "page-scan" as const,
    layout: { left: 0.03, top: 0.02, width: 0.94, height: 0.96 },
  };
}

function buildLocalOcrDocument(pages: PdfReflowPage[]): PdfReflowDocument {
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
      provider: "Tesseract.js",
      model: MODEL_LABEL,
      language: "eng",
    },
    pages,
  };
}
