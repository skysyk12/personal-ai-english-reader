export type PdfViewMode = "reflow" | "original";

export type PdfReflowBlockKind = "heading" | "paragraph" | "list-item";

export type PdfReflowBlock = {
  id: string;
  kind: PdfReflowBlockKind;
  text: string;
};

export type PdfReflowPage = {
  pageNumber: number;
  blocks: PdfReflowBlock[];
};

export type PdfReflowDocument = {
  version: 5;
  generatedAt: string;
  pageCount: number;
  textPageCount: number;
  pages: PdfReflowPage[];
};
