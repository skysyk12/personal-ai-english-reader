export type PdfViewMode = "reflow" | "original";

export type PdfReflowBlockKind = "heading" | "paragraph" | "list-item";

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
  layout: PdfReflowLayout;
};

export type PdfReflowBlock = PdfReflowTextBlock | PdfReflowImageBlock;

export type PdfReflowPage = {
  pageNumber: number;
  blocks: PdfReflowBlock[];
};

export type PdfReflowDocument = {
  version: 6;
  generatedAt: string;
  pageCount: number;
  textPageCount: number;
  imageCount: number;
  pages: PdfReflowPage[];
};
