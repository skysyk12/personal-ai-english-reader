import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import { sqlite } from "@/db";
import type { PdfReflowDocument } from "@/lib/books/pdf-reflow-types";

type SearchableBook = {
  id: string;
  format: "epub" | "pdf";
};

type SearchDocumentInput = {
  sourceType: "epub-chapter" | "pdf-page";
  locationKey: string;
  title: string;
  content: string;
  anchor: { type: "epub"; cfiRange: string } | { type: "pdf"; page: number; textQuote: string };
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
});

export async function ensureLibrarySearchIndex() {
  const books = sqlite.prepare(`
    SELECT b.id, b.format
    FROM books b
    LEFT JOIN search_documents d ON d.book_id = b.id
    GROUP BY b.id
    HAVING COUNT(d.id) = 0
  `).all() as SearchableBook[];
  await Promise.all(books.map((book) => ensureBookSearchIndex(book)));
}

export async function ensureBookSearchIndex(book: SearchableBook) {
  try {
    const originalPath = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "data",
      "books",
      book.id,
      `original.${book.format}`,
    );
    const documents = book.format === "epub"
      ? await extractEpubSearchDocuments(new Uint8Array(await fs.readFile(
          /*turbopackIgnore: true*/ originalPath,
        )))
      : await extractPdfSearchDocuments(originalPath);
    if (!documents.length) return;
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`
      INSERT INTO search_documents (
        id, book_id, source_type, location_key, title, content, anchor_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, source_type, location_key) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        anchor_json = excluded.anchor_json,
        updated_at = excluded.updated_at
    `);
    sqlite.transaction(() => {
      for (const document of documents) {
        insert.run(
          `search_${crypto.randomUUID()}`,
          book.id,
          document.sourceType,
          document.locationKey,
          document.title,
          document.content,
          JSON.stringify(document.anchor),
          now,
        );
      }
    })();
  } catch {
    // Search indexing is opportunistic. A malformed document must never make
    // the library or reader unavailable.
  }
}

async function extractPdfSearchDocuments(originalPath: string): Promise<SearchDocumentInput[]> {
  const directory = path.dirname(originalPath);
  const cacheNames = ["reflow-v8.json", "reflow-v7.json", "reflow-v6.json", "reflow-v5.json"];
  for (const cacheName of cacheNames) {
    try {
      const document = JSON.parse(
        await fs.readFile(/*turbopackIgnore: true*/ path.join(
          /*turbopackIgnore: true*/ directory,
          cacheName,
        ), "utf8"),
      ) as PdfReflowDocument;
      if (!Array.isArray(document.pages)) continue;
      return document.pages.flatMap((page) => {
        const content = page.blocks
          .flatMap((block) => {
            if (block.kind === "image") return [];
            if (block.kind === "table") {
              return [block.rows.flat().join(" ")];
            }
            return [block.text];
          })
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (!content) return [];
        return [{
          sourceType: "pdf-page",
          locationKey: String(page.pageNumber),
          title: `第 ${page.pageNumber} 页`,
          content,
          anchor: { type: "pdf", page: page.pageNumber, textQuote: "" },
        } satisfies SearchDocumentInput];
      });
    } catch {
      // Try the previous cache generation.
    }
  }
  return [];
}

async function extractEpubSearchDocuments(bytes: Uint8Array): Promise<SearchDocumentInput[]> {
  const zip = await JSZip.loadAsync(bytes);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return [];
  const container = xml.parse(await containerFile.async("string")) as {
    container?: { rootfiles?: { rootfile?: { "full-path"?: string } | Array<{ "full-path"?: string }> } };
  };
  const rootfile = asArray(container.container?.rootfiles?.rootfile)[0];
  const opfPath = rootfile?.["full-path"];
  if (!opfPath) return [];
  const opfFile = zip.file(opfPath);
  if (!opfFile) return [];
  const opf = xml.parse(await opfFile.async("string")) as {
    package?: {
      manifest?: { item?: ManifestItem | ManifestItem[] };
      spine?: { itemref?: SpineItem | SpineItem[] };
    };
  };
  const manifest = new Map(
    asArray(opf.package?.manifest?.item)
      .filter((item): item is ManifestItem & { id: string; href: string } => Boolean(item.id && item.href))
      .map((item) => [item.id, item]),
  );
  const base = path.posix.dirname(opfPath);
  const output: SearchDocumentInput[] = [];
  let chapterNumber = 0;
  for (const spineItem of asArray(opf.package?.spine?.itemref)) {
    const item = spineItem.idref ? manifest.get(spineItem.idref) : undefined;
    if (!item?.href) continue;
    const href = safeZipPath(base, item.href);
    const file = zip.file(href);
    if (!file) continue;
    const markup = await file.async("string");
    const content = htmlToText(markup);
    if (content.length < 20) continue;
    chapterNumber += 1;
    const title = htmlTitle(markup) || `章节 ${chapterNumber}`;
    output.push({
      sourceType: "epub-chapter",
      locationKey: href,
      title,
      content,
      anchor: { type: "epub", cfiRange: item.href },
    });
  }
  return output;
}

function htmlTitle(markup: string) {
  const match = markup.match(/<(?:h1|h2|title)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|title)>/i);
  return match ? htmlToText(match[1]).slice(0, 160) : "";
}

function htmlToText(markup: string) {
  return decodeEntities(
    markup
      .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : " ";
    }
    return named[entity.toLowerCase()] ?? " ";
  });
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function safeZipPath(base: string, relative: string) {
  const decoded = decodeURIComponent(relative.split("#")[0]);
  const resolved = path.posix.normalize(path.posix.join(base, decoded));
  if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new Error("EPUB contains an unsafe file path.");
  }
  return resolved;
}

type ManifestItem = { id?: string; href?: string; "media-type"?: string };
type SpineItem = { idref?: string };
