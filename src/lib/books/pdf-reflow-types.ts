export type PdfViewMode = "reflow" | "original";

export type ReflowPolicy = "auto" | "none" | "local" | "api";

export type PdfReflowBlockKind = "heading" | "paragraph" | "list-item" | "caption";

export type PdfReflowLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PdfReflowTextBlock = {
  id: string;
  kind: PdfReflowBlockKind;
  text: string;
  layout?: PdfReflowLayout;
};

export type PdfReflowImageBlock = {
  id: string;
  kind: "image";
  src: string;
  alt: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  role?: "figure" | "page-scan";
  layout: PdfReflowLayout;
};

export type PdfReflowTableBlock = {
  id: string;
  kind: "table";
  rows: string[][];
  layout: PdfReflowLayout;
};

export type PdfReflowBlock = PdfReflowTextBlock | PdfReflowImageBlock | PdfReflowTableBlock;

export type PdfReflowPage = {
  pageNumber: number;
  blocks: PdfReflowBlock[];
  analysis: {
    source: "native" | "ocr" | "image-only";
    confidence: number | null;
    columnCount: number;
    tableCount: number;
    captionCount: number;
  };
};

export type PdfReflowDocument = {
  version: 8;
  generatedAt: string;
  pageCount: number;
  textPageCount: number;
  ocrPageCount: number;
  imageCount: number;
  tableCount: number;
  captionCount: number;
  ocr?: {
    provider: "PaddleOCR-VL" | "Tesseract.js";
    model: string;
    language: "auto" | "eng";
    jobId?: string;
  };
  pages: PdfReflowPage[];
};
