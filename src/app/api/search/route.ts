import { NextResponse } from "next/server";

import { sqlite } from "@/db";
import { ensureLibrarySearchIndex } from "@/lib/books/search-index";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.replace(/\s+/g, " ").trim() || "";
  if (query.length < 2) return NextResponse.json({ query, results: [] });
  await ensureLibrarySearchIndex();
  const pattern = `%${escapeLike(query)}%`;

  const books = sqlite.prepare(`
    SELECT id, title, author, format
    FROM books
    WHERE title LIKE ? ESCAPE '\\' COLLATE NOCASE OR author LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY COALESCE(last_opened_at, created_at) DESC
    LIMIT 12
  `).all(pattern, pattern) as Array<{ id: string; title: string; author: string; format: string }>;
  const documents = sqlite.prepare(`
    SELECT d.id, d.book_id, d.title, d.content, d.anchor_json, b.title AS book_title
    FROM search_documents d
    JOIN books b ON b.id = d.book_id
    WHERE d.content LIKE ? ESCAPE '\\' COLLATE NOCASE OR d.title LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY b.last_opened_at DESC, d.location_key
    LIMIT 36
  `).all(pattern, pattern) as Array<{
    id: string; book_id: string; title: string; content: string; anchor_json: string; book_title: string;
  }>;
  const vocabulary = sqlite.prepare(`
    SELECT v.id, v.book_id, v.term, v.definition, v.context, v.anchor_json, b.title AS book_title
    FROM vocabulary v
    JOIN books b ON b.id = v.book_id
    WHERE v.term LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR v.definition LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR v.context LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY v.updated_at DESC
    LIMIT 16
  `).all(pattern, pattern, pattern) as Array<{
    id: string; book_id: string; term: string; definition: string; context: string; anchor_json: string; book_title: string;
  }>;
  const notes = sqlite.prepare(`
    SELECT n.id, n.book_id, n.title, n.selected_text, n.content_markdown, n.anchor_json, b.title AS book_title
    FROM notes n
    JOIN books b ON b.id = n.book_id
    WHERE n.title LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR n.selected_text LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR n.content_markdown LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY n.updated_at DESC
    LIMIT 16
  `).all(pattern, pattern, pattern) as Array<{
    id: string; book_id: string; title: string; selected_text: string; content_markdown: string; anchor_json: string; book_title: string;
  }>;

  const results = [
    ...books.map((book) => ({
      id: `book:${book.id}`,
      type: "book",
      bookId: book.id,
      title: book.title,
      meta: `${book.author} · ${book.format.toUpperCase()}`,
      snippet: "打开书籍",
      href: `/reader/${book.id}`,
    })),
    ...documents.map((document) => {
      const anchor = parseAnchor(document.anchor_json);
      return {
        id: `content:${document.id}`,
        type: "content",
        bookId: document.book_id,
        title: document.title,
        meta: document.book_title,
        snippet: snippetAround(document.content, query),
        href: readerHref(document.book_id, anchor),
      };
    }),
    ...vocabulary.map((word) => {
      const anchor = parseAnchor(word.anchor_json);
      return {
        id: `vocabulary:${word.id}`,
        type: "vocabulary",
        bookId: word.book_id,
        title: word.term,
        meta: `${word.book_title} · 生词`,
        snippet: snippetAround(word.definition || word.context, query),
        href: readerHref(word.book_id, anchor),
      };
    }),
    ...notes.map((note) => {
      const anchor = parseAnchor(note.anchor_json);
      return {
        id: `note:${note.id}`,
        type: "note",
        bookId: note.book_id,
        title: note.title || "阅读笔记",
        meta: `${note.book_title} · 笔记`,
        snippet: snippetAround(`${note.selected_text} ${note.content_markdown}`, query),
        href: readerHref(note.book_id, anchor),
      };
    }),
  ];
  return NextResponse.json({ query, results });
}

function parseAnchor(value: string) {
  try {
    return JSON.parse(value) as { type?: string; page?: number; cfiRange?: string };
  } catch {
    return {};
  }
}

function readerHref(bookId: string, anchor: { type?: string; page?: number; cfiRange?: string }) {
  if (anchor.type === "pdf" && anchor.page) return `/reader/${bookId}?page=${anchor.page}`;
  if (anchor.type === "epub" && anchor.cfiRange) {
    return `/reader/${bookId}?cfi=${encodeURIComponent(anchor.cfiRange)}`;
  }
  return `/reader/${bookId}`;
}

function snippetAround(content: string, query: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, 180);
  const start = Math.max(0, index - 74);
  const end = Math.min(normalized.length, index + query.length + 106);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
