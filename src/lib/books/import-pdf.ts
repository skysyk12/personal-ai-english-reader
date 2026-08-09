import "server-only";

import { withPdfDocument } from "@/lib/books/pdf-server";

type PdfMetadata = {
  title: string;
  author: string;
  pageCount: number;
  parseScore: number;
};

function metadataText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\0/g, "").trim();
  return normalized || undefined;
}

function samplePageNumbers(pageCount: number): number[] {
  const pages = new Set<number>();
  for (let page = 1; page <= Math.min(5, pageCount); page += 1) pages.add(page);
  pages.add(Math.max(1, Math.floor(pageCount / 2)));
  pages.add(Math.max(1, Math.ceil(pageCount / 2)));
  pages.add(Math.max(1, pageCount - 1));
  pages.add(pageCount);
  return [...pages].filter((page) => page <= pageCount).sort((a, b) => a - b);
}

export async function readPdfMetadata(
  bytes: Uint8Array,
  fallbackTitle: string,
): Promise<PdfMetadata> {
  if (new TextDecoder("latin1").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("The selected file is not a valid PDF document.");
  }

  return withPdfDocument(bytes, async (document) => {
    const metadata = await document.getMetadata();
    const info = metadata.info as Record<string, unknown>;
    const sampledPages = samplePageNumbers(document.numPages);
    const sampledText = await Promise.all(
      sampledPages.map(async (pageNumber) => {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        return content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }),
    );
    const pagesWithText = sampledText.filter((text) => text.length >= 24).length;

    return {
      title: metadataText(info.Title) || fallbackTitle,
      author: metadataText(info.Author) || "Unknown author",
      pageCount: document.numPages,
      parseScore: sampledPages.length
        ? Math.round((pagesWithText / sampledPages.length) * 100)
        : 0,
    };
  });
}
