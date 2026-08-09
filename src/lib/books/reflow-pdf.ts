import "server-only";

import type { PDFDocumentProxy } from "pdfjs-dist";

import type {
  PdfReflowBlock,
  PdfReflowBlockKind,
  PdfReflowDocument,
  PdfReflowPage,
} from "@/lib/books/pdf-reflow-types";
import { withPdfDocument } from "@/lib/books/pdf-server";

type TextItemLike = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
};

type TextLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
};

const CACHE_VERSION = 5 as const;
const LIST_PATTERN = /^(?:[•◦▪–—-]|\d+[.)]|[A-Za-z][.)])\s+/;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

export async function extractPdfReflow(bytes: Uint8Array): Promise<PdfReflowDocument> {
  return withPdfDocument(bytes, async (document) => {
    const pages = await extractPages(document);
    return {
      version: CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      pageCount: document.numPages,
      textPageCount: pages.filter((page) => page.blocks.length > 0).length,
      pages,
    };
  });
}

async function extractPages(document: PDFDocumentProxy): Promise<PdfReflowPage[]> {
  const pages: PdfReflowPage[] = [];
  const batchSize = 4;
  for (let start = 1; start <= document.numPages; start += batchSize) {
    const pageNumbers = Array.from(
      { length: Math.min(batchSize, document.numPages - start + 1) },
      (_, index) => start + index,
    );
    pages.push(...await Promise.all(pageNumbers.map((pageNumber) => extractPage(document, pageNumber))));
  }
  return pages;
}

async function extractPage(document: PDFDocumentProxy, pageNumber: number): Promise<PdfReflowPage> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
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
  if (!items.length) return { pageNumber, blocks: [] };

  // Weight by character count so fragmented navigation labels do not make the
  // body copy look like a heading on text-heavy magazine/article exports.
  const medianFontSize = weightedMedianFontSize(items) || 12;
  const lines = buildLines(items);
  return {
    pageNumber,
    blocks: buildBlocks(lines, medianFontSize, pageNumber),
  };
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

  const lines = rows.flatMap((row) => {
    const sorted = row.toSorted((left, right) => left.x - right.x);
    const lines: PositionedText[][] = [];
    for (const item of sorted) {
      const line = lines.at(-1);
      const previous = line?.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      // A PDF text row can contain fragments from two visual columns. A gap of
      // roughly three em is uncommon inside a sentence but common at a gutter.
      const splitThreshold = Math.max(item.fontSize * 2.8, 28);
      if (!line || (previous && gap > splitThreshold)) lines.push([item]);
      else line.push(item);
    }
    return lines.map(joinLine);
  }).filter((line) => line.text.length > 0);

  return orderLinesForReading(lines);
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

function orderLinesForReading(lines: TextLine[]) {
  if (lines.length < 8) return lines;
  const pageLeft = Math.min(...lines.map((line) => line.x));
  const pageRight = Math.max(...lines.map((line) => line.x + line.width));
  const pageWidth = pageRight - pageLeft;
  if (pageWidth < 180) return lines;

  const midpoint = pageLeft + pageWidth / 2;
  const wideThreshold = pageWidth * 0.58;
  const narrowLines = lines.filter((line) => line.width < wideThreshold);
  const leftLines = narrowLines.filter((line) => line.x + line.width / 2 < midpoint);
  const rightLines = narrowLines.filter((line) => line.x + line.width / 2 >= midpoint);

  // Only switch to column ordering when both sides contain a meaningful body.
  // Short datelines and page numbers on a single-column page should not trigger it.
  if (leftLines.length < 4 || rightLines.length < 4 || narrowLines.length < lines.length * 0.45) {
    return lines;
  }

  const separators = lines
    .filter((line) => line.width >= wideThreshold)
    .toSorted((left, right) => right.y - left.y);
  const output: TextLine[] = [];
  let ceiling = Number.POSITIVE_INFINITY;

  for (const separator of separators) {
    const band = narrowLines.filter((line) => line.y <= ceiling && line.y > separator.y);
    output.push(...orderColumnBand(band, midpoint), separator);
    ceiling = separator.y;
  }
  output.push(...orderColumnBand(narrowLines.filter((line) => line.y <= ceiling), midpoint));
  return output;
}

function orderColumnBand(lines: TextLine[], midpoint: number) {
  const byY = (values: TextLine[]) => values.toSorted((left, right) => right.y - left.y);
  return [
    ...byY(lines.filter((line) => line.x + line.width / 2 < midpoint)),
    ...byY(lines.filter((line) => line.x + line.width / 2 >= midpoint)),
  ];
}

function shouldInsertSpace(previous: PositionedText, current: PositionedText) {
  const previousLast = previous.text.at(-1) || "";
  const currentFirst = current.text[0] || "";
  if (/\s/.test(previousLast) || /^[,.;:!?%)\]}]/.test(currentFirst)) return false;
  if (CJK_PATTERN.test(previousLast) && CJK_PATTERN.test(currentFirst)) return false;
  const gap = current.x - (previous.x + previous.width);
  return gap > Math.max(previous.fontSize, current.fontSize) * 0.12;
}

function buildBlocks(lines: TextLine[], medianFontSize: number, pageNumber: number): PdfReflowBlock[] {
  const blocks: Array<{ kind: PdfReflowBlockKind; text: string; line: TextLine }> = [];

  for (const line of lines) {
    const kind = classifyLine(line, medianFontSize);
    const previous = blocks.at(-1);
    const verticalGap = previous ? Math.max(0, previous.line.y - line.y) : Number.POSITIVE_INFINITY;
    const indentation = previous ? Math.abs(previous.line.x - line.x) : Number.POSITIVE_INFINITY;
    const joinsParagraph = previous?.kind === "paragraph"
      && kind === "paragraph"
      && verticalGap <= Math.max(medianFontSize * 1.8, previous.line.fontSize * 1.7)
      && indentation <= medianFontSize * 3.2;
    const joinsHeading = previous?.kind === "heading"
      && kind === "heading"
      && verticalGap <= Math.max(medianFontSize * 2.2, previous.line.fontSize * 1.75)
      && indentation <= medianFontSize * 4
      && line.fontSize >= previous.line.fontSize * 0.82;

    if ((joinsParagraph || joinsHeading) && previous) {
      previous.text = joinsHeading
        ? joinDisplayLines(previous.text, line.text)
        : joinWrappedLines(previous.text, line.text);
      previous.line = line;
    } else {
      blocks.push({ kind, text: line.text, line });
    }
  }

  return blocks
    .filter((block) => block.text.length > 0)
    .map((block, index) => ({
      id: `pdf-page-${pageNumber}-block-${index + 1}`,
      kind: block.kind,
      text: block.kind === "list-item" ? block.text.replace(LIST_PATTERN, "") : block.text,
    }));
}

function classifyLine(line: TextLine, medianFontSize: number): PdfReflowBlockKind {
  if (LIST_PATTERN.test(line.text)) return "list-item";
  const isLarge = line.fontSize >= medianFontSize * 1.14;
  const isEmphasized = line.bold && line.fontSize >= medianFontSize * 1.06;
  if (line.text.length <= 180 && (isLarge || isEmphasized)) return "heading";
  return "paragraph";
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
