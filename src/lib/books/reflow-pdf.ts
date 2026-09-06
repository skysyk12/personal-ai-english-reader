import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import type {
  PdfReflowBlock,
  PdfReflowBlockKind,
  PdfReflowDocument,
  PdfReflowImageBlock,
  PdfReflowLayout,
  PdfReflowPage,
  PdfReflowTextBlock,
} from "@/lib/books/pdf-reflow-types";
import { withPdfDocument } from "@/lib/books/pdf-server";

type TextItemLike = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
};

type TextLine = PositionedText;

type ExtractedImage = PdfReflowImageBlock;

type LayoutItem =
  | { type: "line"; line: TextLine; layout: PdfReflowLayout }
  | { type: "image"; image: ExtractedImage; layout: PdfReflowLayout };

type Matrix = [number, number, number, number, number, number];

type RawPdfImage = {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
};

type PdfObjectStore = {
  get: (id: string, callback?: (value: RawPdfImage) => void) => RawPdfImage | undefined;
};

type ReflowOptions = {
  assetDirectory: string;
  assetUrlBase: string;
};

const CACHE_VERSION = 6 as const;
const LIST_PATTERN = /^(?:[•◦▪–—-]|\d+[.)]|[A-Za-z][.)])\s+/;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export async function extractPdfReflow(
  bytes: Uint8Array,
  options: ReflowOptions,
): Promise<PdfReflowDocument> {
  await fs.mkdir(options.assetDirectory, { recursive: true });
  return withPdfDocument(bytes, async (document) => {
    const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pages = await extractPages(document, options, OPS as Record<string, number>);
    return {
      version: CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      pageCount: document.numPages,
      textPageCount: pages.filter((page) => page.blocks.some((block) => block.kind !== "image")).length,
      imageCount: pages.reduce(
        (total, page) => total + page.blocks.filter((block) => block.kind === "image").length,
        0,
      ),
      pages,
    };
  });
}

async function extractPages(
  document: PDFDocumentProxy,
  options: ReflowOptions,
  ops: Record<string, number>,
): Promise<PdfReflowPage[]> {
  const pages: PdfReflowPage[] = [];
  const batchSize = 4;
  for (let start = 1; start <= document.numPages; start += batchSize) {
    const pageNumbers = Array.from(
      { length: Math.min(batchSize, document.numPages - start + 1) },
      (_, index) => start + index,
    );
    pages.push(...await Promise.all(
      pageNumbers.map((pageNumber) => extractPage(document, pageNumber, options, ops)),
    ));
  }
  return pages;
}

async function extractPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  options: ReflowOptions,
  ops: Record<string, number>,
): Promise<PdfReflowPage> {
  const page = await document.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const [content, images] = await Promise.all([
      page.getTextContent(),
      extractPageImages(page, pageNumber, viewport.width, viewport.height, options, ops),
    ]);
    const items = content.items.flatMap((item) => {
      if (!("str" in item) || !("transform" in item)) return [];
      const value = item as TextItemLike;
      const text = normalizeInlineText(value.str);
      if (!text) return [];
      const transform = value.transform;
      const fontSize = Math.max(
        Math.hypot(Number(transform[0] || 0), Number(transform[1] || 0)),
        Math.abs(Number(value.height || 0)),
        1,
      );
      return [{
        text,
        x: Number(transform[4] || 0),
        y: Number(transform[5] || 0),
        width: Math.max(0, Number(value.width || 0)),
        fontSize,
        bold: /bold|black|heavy|semibold/i.test(value.fontName || ""),
      } satisfies PositionedText];
    });

    if (!items.length) return { pageNumber, blocks: images };

    const medianFontSize = weightedMedianFontSize(items) || 12;
    const lines = buildLines(items);
    const layoutItems = orderPageContent(lines, images, viewport.width, viewport.height);
    return {
      pageNumber,
      blocks: buildBlocks(layoutItems, medianFontSize, pageNumber),
    };
  } finally {
    page.cleanup();
  }
}

async function extractPageImages(
  page: PDFPageProxy,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  options: ReflowOptions,
  ops: Record<string, number>,
): Promise<ExtractedImage[]> {
  const operatorList = await page.getOperatorList();
  const stack: Matrix[] = [];
  let matrix: Matrix = [...IDENTITY_MATRIX];
  const images: ExtractedImage[] = [];
  const objectStore = (page as PDFPageProxy & { objs: PdfObjectStore }).objs;

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] || [];
    if (fn === ops.save) {
      stack.push([...matrix]);
      continue;
    }
    if (fn === ops.restore) {
      matrix = stack.pop() || [...IDENTITY_MATRIX];
      continue;
    }
    if (fn === ops.transform) {
      matrix = multiplyMatrices(matrix, Array.from(args, Number) as Matrix);
      continue;
    }

    const isStoredImage = fn === ops.paintImageXObject || fn === ops.paintJpegXObject;
    const isInlineImage = fn === ops.paintInlineImageXObject;
    if (!isStoredImage && !isInlineImage) continue;

    const rawImage = isInlineImage
      ? args[0] as RawPdfImage
      : await resolvePdfImage(objectStore, String(args[0] || ""));
    if (!rawImage?.data || !rawImage.width || !rawImage.height) continue;

    const bounds = transformedUnitBounds(matrix);
    if (bounds.width < 48 || bounds.height < 32) continue;
    const layout = normalizeLayout(bounds, pageWidth, pageHeight);
    if (layout.width < 0.08 || layout.height < 0.025) continue;

    const imageNumber = images.length + 1;
    const filename = `page-${pageNumber}-image-${imageNumber}.webp`;
    const assetPath = path.join(options.assetDirectory, filename);
    const encoded = await encodePdfImage(rawImage);
    if (!encoded) continue;
    await fs.writeFile(assetPath, encoded);

    images.push({
      id: `pdf-page-${pageNumber}-image-${imageNumber}`,
      kind: "image",
      src: `${options.assetUrlBase}/${filename}`,
      alt: `PDF 第 ${pageNumber} 页配图`,
      intrinsicWidth: rawImage.width,
      intrinsicHeight: rawImage.height,
      layout,
    });
  }

  return images;
}

async function resolvePdfImage(store: PdfObjectStore, id: string): Promise<RawPdfImage | null> {
  if (!id) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RawPdfImage | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 5000);
    try {
      const value = store.get(id, (image) => finish(image || null));
      if (value) finish(value);
    } catch {
      finish(null);
    }
  });
}

async function encodePdfImage(image: RawPdfImage) {
  const rgba = toRgba(image);
  if (!rgba || !image.width || !image.height) return null;
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return canvas.encode("webp", 82);
}

function toRgba(image: RawPdfImage) {
  const { data, width, height, kind } = image;
  if (!data || !width || !height) return null;
  const pixels = width * height;
  if (kind === 3 && data.length >= pixels * 4) {
    return new Uint8ClampedArray(data.buffer, data.byteOffset, pixels * 4);
  }
  const rgba = new Uint8ClampedArray(pixels * 4);
  if (kind === 2 && data.length >= pixels * 3) {
    for (let source = 0, target = 0; target < rgba.length; source += 3, target += 4) {
      rgba[target] = data[source];
      rgba[target + 1] = data[source + 1];
      rgba[target + 2] = data[source + 2];
      rgba[target + 3] = 255;
    }
    return rgba;
  }
  if (kind === 1) {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const target = (y * width + x) * 4;
        const value = bit ? 0 : 255;
        rgba[target] = value;
        rgba[target + 1] = value;
        rgba[target + 2] = value;
        rgba[target + 3] = 255;
      }
    }
    return rgba;
  }
  return null;
}

function buildLines(items: PositionedText[]): TextLine[] {
  const ordered = items.toSorted((left, right) => {
    const rowDifference = right.y - left.y;
    return Math.abs(rowDifference) > 1.5 ? rowDifference : left.x - right.x;
  });
  const rows: PositionedText[][] = [];

  for (const item of ordered) {
    const row = rows.at(-1);
    const reference = row?.[0];
    const tolerance = Math.max(2, item.fontSize * 0.34, (reference?.fontSize || 0) * 0.34);
    if (!row || !reference || Math.abs(reference.y - item.y) > tolerance) rows.push([item]);
    else row.push(item);
  }

  return rows.flatMap((row) => {
    const sorted = row.toSorted((left, right) => left.x - right.x);
    const lines: PositionedText[][] = [];
    for (const item of sorted) {
      const line = lines.at(-1);
      const previous = line?.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const splitThreshold = Math.max(item.fontSize * 2.8, 28);
      if (!line || (previous && gap > splitThreshold)) lines.push([item]);
      else line.push(item);
    }
    return lines.map(joinLine);
  }).filter((line) => line.text.length > 0);
}

function joinLine(items: PositionedText[]): TextLine {
  let text = "";
  let previous: PositionedText | undefined;
  for (const item of items) {
    if (previous && shouldInsertSpace(previous, item)) text += " ";
    text += item.text;
    previous = item;
  }
  return {
    text: normalizeInlineText(text),
    x: Math.min(...items.map((item) => item.x)),
    y: items.reduce((total, item) => total + item.y, 0) / items.length,
    width: Math.max(...items.map((item) => item.x + item.width))
      - Math.min(...items.map((item) => item.x)),
    fontSize: Math.max(...items.map((item) => item.fontSize)),
    bold: items.filter((item) => item.bold).length >= Math.ceil(items.length / 2),
  };
}

function orderPageContent(
  lines: TextLine[],
  images: ExtractedImage[],
  pageWidth: number,
  pageHeight: number,
): LayoutItem[] {
  const lineItems: LayoutItem[] = lines.map((line) => ({
    type: "line",
    line,
    layout: lineLayout(line, pageWidth, pageHeight),
  }));
  const imageItems: LayoutItem[] = images.map((image) => ({
    type: "image",
    image,
    layout: image.layout,
  }));
  const all = [...lineItems, ...imageItems];
  const byPosition = (values: LayoutItem[]) => values.toSorted((left, right) => (
    left.layout.top - right.layout.top || left.layout.left - right.layout.left
  ));
  if (lines.length < 8) return byPosition(all);

  const pageLeft = Math.min(...lines.map((line) => line.x));
  const pageRight = Math.max(...lines.map((line) => line.x + line.width));
  const contentWidth = pageRight - pageLeft;
  if (contentWidth < 180) return byPosition(all);

  const midpoint = (pageLeft + contentWidth / 2) / pageWidth;
  const wideThreshold = contentWidth * 0.58 / pageWidth;
  const narrowLines = lineItems.filter((item) => item.layout.width < wideThreshold);
  const leftLines = narrowLines.filter((item) => center(item.layout) < midpoint);
  const rightLines = narrowLines.filter((item) => center(item.layout) >= midpoint);
  if (leftLines.length < 4 || rightLines.length < 4 || narrowLines.length < lines.length * 0.45) {
    return byPosition(all);
  }

  const narrowItems = all.filter((item) => item.layout.width < wideThreshold);
  const separators = all
    .filter((item) => item.layout.width >= wideThreshold)
    .toSorted((left, right) => left.layout.top - right.layout.top);
  const output: LayoutItem[] = [];
  const used = new Set<LayoutItem>();
  let topBoundary = Number.NEGATIVE_INFINITY;

  for (const separator of separators) {
    const band = narrowItems.filter((item) => (
      !used.has(item) && item.layout.top >= topBoundary && item.layout.top < separator.layout.top
    ));
    output.push(...orderColumnBand(band, midpoint));
    band.forEach((item) => used.add(item));
    output.push(separator);
    used.add(separator);
    topBoundary = separator.layout.top;
  }
  output.push(...orderColumnBand(
    narrowItems.filter((item) => !used.has(item)),
    midpoint,
  ));
  return output;
}

function orderColumnBand(items: LayoutItem[], midpoint: number) {
  const byTop = (values: LayoutItem[]) => values.toSorted((left, right) => (
    left.layout.top - right.layout.top || left.layout.left - right.layout.left
  ));
  return [
    ...byTop(items.filter((item) => center(item.layout) < midpoint)),
    ...byTop(items.filter((item) => center(item.layout) >= midpoint)),
  ];
}

function buildBlocks(
  items: LayoutItem[],
  medianFontSize: number,
  pageNumber: number,
): PdfReflowBlock[] {
  type WorkingBlock = {
    kind: PdfReflowBlockKind;
    text: string;
    firstLine: TextLine;
    lastLine: TextLine;
    layout: PdfReflowLayout;
  };
  const output: Array<WorkingBlock | ExtractedImage> = [];

  for (const item of items) {
    if (item.type === "image") {
      output.push(item.image);
      continue;
    }
    const { line, layout } = item;
    const kind = classifyLine(line, medianFontSize);
    const previous = output.at(-1);
    const previousText = previous && previous.kind !== "image" ? previous : null;
    const verticalGap = previousText
      ? Math.max(0, previousText.lastLine.y - line.y)
      : Number.POSITIVE_INFINITY;
    const indentation = previousText
      ? Math.abs(previousText.lastLine.x - line.x)
      : Number.POSITIVE_INFINITY;
    const joinsParagraph = previousText?.kind === "paragraph"
      && kind === "paragraph"
      && verticalGap <= Math.max(medianFontSize * 1.8, previousText.lastLine.fontSize * 1.7)
      && indentation <= medianFontSize * 3.2;
    const joinsHeading = previousText?.kind === "heading"
      && kind === "heading"
      && verticalGap <= Math.max(medianFontSize * 2.2, previousText.lastLine.fontSize * 1.75)
      && indentation <= medianFontSize * 4
      && line.fontSize >= previousText.lastLine.fontSize * 0.82;

    if ((joinsParagraph || joinsHeading) && previousText) {
      previousText.text = joinsHeading
        ? joinDisplayLines(previousText.text, line.text)
        : joinWrappedLines(previousText.text, line.text);
      previousText.lastLine = line;
      previousText.layout = unionLayouts(previousText.layout, layout);
    } else {
      output.push({ kind, text: line.text, firstLine: line, lastLine: line, layout });
    }
  }

  let textIndex = 0;
  return output.flatMap((block): PdfReflowBlock[] => {
    if (block.kind === "image") return [block];
    if (!block.text) return [];
    textIndex += 1;
    return [{
      id: `pdf-page-${pageNumber}-block-${textIndex}`,
      kind: block.kind,
      text: block.kind === "list-item" ? block.text.replace(LIST_PATTERN, "") : block.text,
      layout: block.layout,
    } satisfies PdfReflowTextBlock];
  });
}

function classifyLine(line: TextLine, medianFontSize: number): PdfReflowBlockKind {
  if (LIST_PATTERN.test(line.text)) return "list-item";
  const isLarge = line.fontSize >= medianFontSize * 1.14;
  const isEmphasized = line.bold && line.fontSize >= medianFontSize * 1.06;
  if (line.text.length <= 180 && (isLarge || isEmphasized)) return "heading";
  return "paragraph";
}

function lineLayout(line: TextLine, pageWidth: number, pageHeight: number): PdfReflowLayout {
  const top = pageHeight - line.y - line.fontSize;
  return normalizeLayout({
    left: line.x,
    top,
    width: line.width,
    height: line.fontSize * 1.25,
  }, pageWidth, pageHeight);
}

function normalizeLayout(
  layout: PdfReflowLayout,
  pageWidth: number,
  pageHeight: number,
): PdfReflowLayout {
  return {
    left: clamp(layout.left / pageWidth, 0, 1),
    top: clamp(layout.top / pageHeight, 0, 1),
    width: clamp(layout.width / pageWidth, 0, 1),
    height: clamp(layout.height / pageHeight, 0, 1),
  };
}

function transformedUnitBounds(matrix: Matrix): PdfReflowLayout {
  const points = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, 1, 0),
    transformPoint(matrix, 0, 1),
    transformPoint(matrix, 1, 1),
  ];
  const left = Math.min(...points.map(([x]) => x));
  const right = Math.max(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const bottom = Math.max(...points.map(([, y]) => y));
  return { left, top, width: right - left, height: bottom - top };
}

function transformPoint(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function unionLayouts(left: PdfReflowLayout, right: PdfReflowLayout): PdfReflowLayout {
  const x = Math.min(left.left, right.left);
  const y = Math.min(left.top, right.top);
  const maxX = Math.max(left.left + left.width, right.left + right.width);
  const maxY = Math.max(left.top + left.height, right.top + right.height);
  return { left: x, top: y, width: maxX - x, height: maxY - y };
}

function center(layout: PdfReflowLayout) {
  return layout.left + layout.width / 2;
}

function shouldInsertSpace(previous: PositionedText, current: PositionedText) {
  const previousLast = previous.text.at(-1) || "";
  const currentFirst = current.text[0] || "";
  if (/\s/.test(previousLast) || /^[,.;:!?%)\]}]/.test(currentFirst)) return false;
  if (CJK_PATTERN.test(previousLast) && CJK_PATTERN.test(currentFirst)) return false;
  const gap = current.x - (previous.x + previous.width);
  return gap > Math.max(previous.fontSize, current.fontSize) * 0.12;
}

function joinWrappedLines(previous: string, current: string) {
  if (/[-­]$/.test(previous) && /^[a-z]/.test(current)) {
    const trailingWord = previous.match(/([A-Za-z]+)-$/)?.[1] || "";
    if (trailingWord.length <= 4 && trailingWord === trailingWord.toUpperCase()) {
      return `${previous}${current}`;
    }
    return `${previous.slice(0, -1)}${current}`;
  }
  if (CJK_PATTERN.test(previous.at(-1) || "") && CJK_PATTERN.test(current[0] || "")) {
    return `${previous}${current}`;
  }
  return `${previous} ${current}`;
}

function joinDisplayLines(previous: string, current: string) {
  return /[-–—]$/.test(previous) ? `${previous}${current}` : `${previous} ${current}`;
}

function normalizeInlineText(value: string) {
  return value
    .replace(/[\u0000\u00ad]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function weightedMedianFontSize(items: PositionedText[]) {
  if (!items.length) return 0;
  const ordered = items.toSorted((left, right) => left.fontSize - right.fontSize);
  const totalWeight = ordered.reduce((total, item) => total + Math.max(1, item.text.length), 0);
  let weight = 0;
  for (const item of ordered) {
    weight += Math.max(1, item.text.length);
    if (weight >= totalWeight / 2) return item.fontSize;
  }
  return ordered.at(-1)?.fontSize || 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
