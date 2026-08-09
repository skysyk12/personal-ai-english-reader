"use client";

import { BookOpen, ChevronRight, Clock3, FileUp, NotebookPen, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LearningRole } from "@/lib/types";

type LibraryBook = {
  id: string;
  title: string;
  author: string;
  format: "epub" | "pdf";
  cover_path?: string | null;
  import_status: string;
  progress: number;
  noteCount: number;
  last_opened_at?: string | null;
};

export function LibraryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [roles, setRoles] = useState<LearningRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [roleId, setRoleId] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasDialogOpenRef = useRef(false);

  const load = useCallback(async () => {
    const [bookResponse, roleResponse] = await Promise.all([
      fetch("/api/books"),
      fetch("/api/roles"),
    ]);
    const [bookData, roleData] = await Promise.all([bookResponse.json(), roleResponse.json()]);
    setBooks(bookData);
    setRoles(roleData);
    const defaultRole = (roleData as LearningRole[]).find((role) => role.isDefault);
    setRoleId((current) => current || defaultRole?.id || roleData[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    // Loading from the local API is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openImportDialog = useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : importButtonRef.current;
    setDialogOpen(true);
    router.replace("/library?import=1", { scroll: false });
  }, [router]);

  const closeImportDialog = useCallback(() => {
    setDialogOpen(false);
    setError("");
    if (searchParams.get("import") === "1") router.replace("/library", { scroll: false });
  }, [router, searchParams]);

  async function importBook() {
    if (!file) return;
    setImporting(true);
    setError("");
    const body = new FormData();
    body.set("file", file);
    if (roleId) body.set("roleId", roleId);
    try {
      const response = await fetch("/api/books/import", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) {
        throw new Error([result.error, result.details].filter(Boolean).join(" ") || "导入失败。");
      }
      closeImportDialog();
      setFile(null);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "导入失败。");
    } finally {
      setImporting(false);
    }
  }

  async function deleteBook(book: LibraryBook) {
    if (!window.confirm(`删除《${book.title}》及其本地笔记和进度？此操作无法撤销。`)) return;
    const response = await fetch(`/api/books?bookId=${encodeURIComponent(book.id)}`, { method: "DELETE" });
    if (response.ok) setBooks((current) => current.filter((item) => item.id !== book.id));
  }

  const recent = books[0];
  const importDialogOpen = dialogOpen || searchParams.get("import") === "1";
  const defaultRole = roles.find((role) => role.isDefault) ?? roles[0];
  const visibleBooks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return books;
    return books.filter((book) => `${book.title} ${book.author} ${book.format}`.toLowerCase().includes(normalized));
  }, [books, query]);

  useEffect(() => {
    if (!importDialogOpen) return;
    if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    const background = [
      document.querySelector(".app-nav"),
      ...document.querySelectorAll(".library-page > :not(.dialog-backdrop)"),
    ].filter(Boolean) as HTMLElement[];
    background.forEach((element) => element.setAttribute("inert", ""));
    window.requestAnimationFrame(() => dialogCloseRef.current?.focus());

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImportDialog();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      background.forEach((element) => element.removeAttribute("inert"));
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeImportDialog, importDialogOpen]);

  useEffect(() => {
    if (importDialogOpen) {
      wasDialogOpenRef.current = true;
      return;
    }
    if (!wasDialogOpenRef.current) return;
    wasDialogOpenRef.current = false;
    window.requestAnimationFrame(() => (previousFocusRef.current ?? importButtonRef.current)?.focus());
  }, [importDialogOpen]);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="page-shell library-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Library · Local workspace</p>
          <h1>阅读工作区</h1>
          <p>继续阅读、回顾批注，并用当前学习角色理解英文原文。</p>
        </div>
        <button ref={importButtonRef} className="button primary" onClick={openImportDialog}>
          <Plus size={17} aria-hidden="true" /> 导入书籍
        </button>
      </section>

      <section className="workspace-status" aria-label="工作区状态">
        <div><span>书库</span><strong>{loading ? "—" : `${books.length} 本`}</strong></div>
        <div><span>阅读进度</span><strong>{recent ? `${recent.progress}%` : "—"}</strong></div>
        <div><span>已保存笔记</span><strong>{books.reduce((total, book) => total + Number(book.noteCount || 0), 0)} 条</strong></div>
        <div><span>默认学习角色</span><strong>{defaultRole?.name || "读取中"}</strong></div>
      </section>

      {loading ? (
        <LibrarySkeleton />
      ) : books.length === 0 ? (
        <section className="empty-library">
          <div className="empty-glyph"><BookOpen size={30} /></div>
          <p className="eyebrow">Library is quiet</p>
          <h2>导入第一本英文书</h2>
          <p>支持 EPUB 连续阅读与 PDF 原版阅读，文件只保存在本机。</p>
          <button className="button primary" onClick={openImportDialog}>
            <FileUp size={17} /> 选择 EPUB 或 PDF
          </button>
        </section>
      ) : (
        <>
          {recent ? (
            <section className="recent-book" aria-labelledby="recent-title">
              <div className="section-label"><Clock3 size={14} /><span id="recent-title">最近阅读</span></div>
              <BookCover book={recent} featured />
              <div className="recent-copy">
                <span className="book-format">{recent.format.toUpperCase()}</span>
                <h2>{recent.title}</h2>
                <p>{recent.author}</p>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="阅读进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={recent.progress}
                >
                  <span style={{ width: `${recent.progress}%` }} />
                </div>
                <small>已读 {recent.progress}% · {recent.noteCount} 条笔记</small>
              </div>
              <Link href={`/reader/${recent.id}`} className="continue-link">
                继续阅读 <ChevronRight size={18} />
              </Link>
            </section>
          ) : null}

          <section className="all-books" aria-labelledby="all-books-title">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">All books</p>
                <h2 id="all-books-title">全部书籍 <span>{books.length}</span></h2>
              </div>
              <label className="search-field book-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">搜索书籍</span><input name="book-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名或作者…" /></label>
            </div>
            {visibleBooks.length ? <div className="book-table">
              <div className="book-table-head" aria-hidden="true"><span>书籍</span><span>进度</span><span>笔记</span><span>操作</span></div>
              {visibleBooks.map((book) => (
                <article className="book-row" key={book.id}>
                  <Link className="book-row-main" href={`/reader/${book.id}`} aria-label={`阅读 ${book.title}`}>
                    <BookCover book={book} compact />
                    <span className="book-row-copy"><strong>{book.title}</strong><small>{book.author} · {book.format.toUpperCase()}</small></span>
                  </Link>
                  <div className="book-row-progress"><span>{book.progress}%</span><div role="progressbar" aria-label={`${book.title} 阅读进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={book.progress}><i style={{ width: `${book.progress}%` }} /></div></div>
                  <span className="book-note-count"><NotebookPen size={14} aria-hidden="true" />{book.noteCount}</span>
                  <div className="book-row-actions"><Link className="icon-button subtle" aria-label={`继续阅读 ${book.title}`} href={`/reader/${book.id}`}><ChevronRight size={16} /></Link><button className="icon-button subtle" aria-label={`删除 ${book.title}`} onClick={() => void deleteBook(book)}><Trash2 size={15} /></button></div>
                </article>
              ))}
            </div> : <div className="book-search-empty"><Search size={20} /><strong>没有匹配的书籍</strong><span>换一个书名或作者关键词。</span></div>}
          </section>
        </>
      )}

      {importDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeImportDialog()}>
          <section ref={dialogRef} className="dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" onKeyDown={handleDialogKeyDown}>
            <button ref={dialogCloseRef} type="button" className="icon-button dialog-close" aria-label="关闭" onClick={closeImportDialog}><X size={18} /></button>
            <p className="eyebrow">Add to library</p>
            <h2 id="import-title">导入一本英文书</h2>
            <p>文件会被复制到应用数据目录；原文件移动或删除后仍能继续阅读。</p>
            <button type="button" className="file-drop" onClick={() => inputRef.current?.click()}>
              <FileUp size={24} />
              <strong>{file?.name || "选择 EPUB 或 PDF 文件"}</strong>
              <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "EPUB / PDF · 最大 100 MB"}</span>
            </button>
            <input ref={inputRef} className="visually-hidden" name="book-file" aria-label="选择 EPUB 或 PDF 文件" type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <label className="field">
              <span>默认学习角色</span>
              <select name="default-role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                {roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
              </select>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button className="button secondary" onClick={closeImportDialog}>取消</button>
              <button className="button primary" disabled={!file || importing} onClick={() => void importBook()}>
                {importing ? "正在校验并提取元数据…" : "导入并加入书库"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function BookCover({ book, featured = false, compact = false }: { book: LibraryBook; featured?: boolean; compact?: boolean }) {
  return (
    <div className={`book-cover ${featured ? "is-featured" : ""} ${compact ? "is-compact" : ""}`}>
      <div className="cover-rule" />
      <small>{book.author}</small>
      <strong>{book.title}</strong>
      <span>{book.format.toUpperCase()}</span>
    </div>
  );
}

function LibrarySkeleton() {
  return <div className="library-skeleton" aria-label="正在加载书库"><span /><span /><span /></div>;
}
