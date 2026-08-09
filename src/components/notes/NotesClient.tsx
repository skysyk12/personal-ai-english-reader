"use client";

import { ArrowUpRight, Bot, Highlighter, NotebookPen, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Note = {
  id: string;
  book_id: string;
  note_type: string;
  title: string;
  selected_text: string;
  content_markdown: string;
  anchor_json: string;
  created_at: string;
  bookTitle: string;
  roleName?: string | null;
};

type NoteAnchor =
  | { type?: "epub"; cfiRange?: string }
  | { type: "pdf"; page: number; textQuote?: string };

function readerHref(bookId: string, anchorJson: string) {
  try {
    const anchor = JSON.parse(anchorJson) as NoteAnchor;
    if (anchor.type === "pdf" && Number.isInteger(anchor.page)) {
      return `/reader/${bookId}?page=${anchor.page}`;
    }
    if ("cfiRange" in anchor && anchor.cfiRange) {
      return `/reader/${bookId}?cfi=${encodeURIComponent(anchor.cfiRange)}`;
    }
  } catch {
    // Old or malformed anchors still open the book at its saved progress.
  }
  return `/reader/${bookId}`;
}

export function NotesClient() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/notes?type=${encodeURIComponent(type)}`);
    setNotes(await response.json());
    setLoading(false);
  }, [type]);
  useEffect(() => {
    // Loading from the local API is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return notes;
    return notes.filter((note) => `${note.title} ${note.selected_text} ${note.content_markdown} ${note.bookTitle}`.toLowerCase().includes(normalized));
  }, [notes, query]);

  async function remove(id: string) {
    if (!window.confirm("删除这条笔记？")) return;
    const response = await fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) setNotes((current) => current.filter((note) => note.id !== id));
  }

  return (
    <div className="page-shell notes-page">
      <section className="page-heading compact">
        <div><p className="eyebrow">Notes · Reading memory</p><h1>阅读笔记</h1><p>集中检索个人笔记与 AI 回答，并从每条记录返回原文位置。</p></div>
      </section>
      <div className="notes-toolbar">
        <div className="segmented-control" role="group" aria-label="笔记类型">
          {[['all','全部'], ['personal','个人笔记'], ['ai-answer','AI 回答']].map(([value,label]) => <button className={type === value ? "is-active" : ""} key={value} onClick={() => setType(value)}>{label}</button>)}
        </div>
        <label className="search-field"><Search size={16} aria-hidden="true" /><span className="visually-hidden">搜索笔记</span><input name="note-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索原文、书名或笔记…" /></label>
      </div>
      {loading ? <div className="notes-loading">正在读取笔记…</div> : filtered.length ? (
        <div className="notes-list">
          {filtered.map((note) => {
            return (
              <article className="note-card" key={note.id}>
                <div className="note-icon">{note.note_type === "ai-answer" ? <Bot size={17} /> : note.note_type === "personal" ? <NotebookPen size={17} /> : <Highlighter size={17} />}</div>
                <div className="note-body">
                  <div className="note-meta"><span>{note.bookTitle}</span><span>{note.roleName || "个人记录"}</span><time>{new Date(note.created_at).toLocaleDateString("zh-CN")}</time></div>
                  <blockquote>{note.selected_text}</blockquote>
                  <div className="note-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content_markdown}</ReactMarkdown></div>
                  <div className="note-actions">
                    <Link href={readerHref(note.book_id, note.anchor_json)}>返回原文 <ArrowUpRight size={14} /></Link>
                    <button onClick={() => void remove(note.id)}><Trash2 size={14} /> 删除</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : <div className="empty-notes"><NotebookPen size={24} /><strong>还没有符合条件的笔记</strong><span>阅读时选择英文内容，即可添加个人笔记或保存 AI 回答。</span></div>}
    </div>
  );
}
