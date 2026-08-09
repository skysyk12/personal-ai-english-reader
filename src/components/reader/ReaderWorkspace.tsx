"use client";

import clsx from "clsx";
import { ArrowLeft, Bot, Check, ChevronDown, Highlighter, Menu, MessageSquareText, NotebookPen, PanelLeftClose, PanelRightClose, Search, Settings2, Sparkles, TextCursorInput, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiPanel } from "@/components/ai/AiPanel";
import type { PdfViewMode } from "@/lib/books/pdf-reflow-types";
import type { AiAction, LearningRole, ReaderSelection } from "@/lib/types";
import type { NavItem } from "epubjs";
import type { EpubReaderHandle, ReaderFlowMode } from "./EpubReader";
import type { PdfReaderHandle } from "./PdfReader";

const EpubReader = dynamic(() => import("./EpubReader"), {
  ssr: false,
  loading: () => <div className="reader-status" role="status" aria-live="polite">正在加载阅读引擎…</div>,
});

const PdfReader = dynamic(() => import("./PdfReader"), {
  ssr: false,
  loading: () => <div className="reader-status" role="status" aria-live="polite">正在加载 PDF 阅读引擎…</div>,
});

const PdfReflowReader = dynamic(() => import("./PdfReflowReader"), {
  ssr: false,
  loading: () => <div className="reader-status" role="status" aria-live="polite">正在加载 PDF 重排阅读器…</div>,
});

type BookData = {
  id: string;
  title: string;
  author: string;
  format: "epub" | "pdf";
  epubCfi: string | null;
  pdfPage: number | null;
  pdfDefaultMode: PdfViewMode | null;
  totalLocations: number | null;
  percentage: number;
  roleId: string;
};

export function ReaderWorkspace({ book, roles }: { book: BookData; roles: LearningRole[] }) {
  const [tocOpen, setTocOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [action, setAction] = useState<AiAction | null>(null);
  const [roleId, setRoleId] = useState(book.roleId);
  const [progress, setProgress] = useState(book.percentage);
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [fontFamily, setFontFamily] = useState("Georgia, 'Times New Roman', serif");
  const [readingMode, setReadingMode] = useState<ReaderFlowMode>("scroll");
  const [pdfViewMode, setPdfViewMode] = useState<PdfViewMode>(book.pdfDefaultMode || "original");
  const [pdfPage, setPdfPage] = useState(Math.max(1, book.pdfPage || 1));
  const [pdfPageCount, setPdfPageCount] = useState(book.totalLocations || 0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [toast, setToast] = useState("");
  const readerRef = useRef<EpubReaderHandle>(null);
  const pdfReaderRef = useRef<PdfReaderHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRole = roles.find((role) => role.id === roleId) ?? roles[0];

  const handleSelection = useCallback((nextSelection: ReaderSelection) => {
    setSelection(nextSelection);
    setAction(null);
  }, []);
  const handleToc = useCallback((items: NavItem[]) => setToc(items), []);
  const handleEpubProgress = useCallback((cfi: string, nextProgress: number) => {
    setProgress(Math.round(nextProgress));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch(`/api/books/${book.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epubCfi: cfi, percentage: nextProgress, roleId }),
      });
    }, 550);
  }, [book.id, roleId]);

  const handlePdfProgress = useCallback((page: number, pageCount: number) => {
    const nextProgress = pageCount <= 1 ? (pageCount ? 100 : 0) : ((page - 1) / (pageCount - 1)) * 100;
    setPdfPage(page);
    setProgress(Math.round(nextProgress));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch(`/api/books/${book.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfPage: page, percentage: nextProgress, roleId, pdfViewMode }),
      });
    }, 550);
  }, [book.id, pdfViewMode, roleId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  useEffect(() => {
    if (book.format !== "epub" || !window.matchMedia("(min-width: 1041px)").matches) return;
    // The directory is useful by default on wide screens, but obstructs the book on phones.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTocOpen(true);
  }, [book.format]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (typing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault(); setTocOpen((open) => !open);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault(); setAiOpen((open) => !open);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n" && selection) {
        event.preventDefault(); setNoteOpen(true);
      } else if (readingMode === "paginated" && event.key === "ArrowLeft") readerRef.current?.previous();
      else if (readingMode === "paginated" && event.key === "ArrowRight") readerRef.current?.next();
      else if (event.key === "Escape") { setSelection(null); setSettingsOpen(false); setNoteOpen(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readingMode, selection]);

  function changeReadingMode(mode: ReaderFlowMode) {
    setReadingMode(mode);
    readerRef.current?.setReadingMode(mode);
    showToast(mode === "scroll" ? "已切换为连续滚动" : "已切换为分页阅读");
  }

  function changePdfViewMode(mode: PdfViewMode) {
    if (mode === pdfViewMode) return;
    setSelection(null);
    setAction(null);
    setPdfViewMode(mode);
    void fetch(`/api/books/${book.id}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfPage, percentage: progress, roleId, pdfViewMode: mode }),
    });
    showToast(mode === "reflow" ? "已切换为文本重排" : "已切换为 PDF 原版");
  }

  async function saveRole(nextRoleId: string) {
    setRoleId(nextRoleId);
    setAction(null);
    await fetch(`/api/books/${book.id}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(book.format === "pdf"
        ? { pdfPage, percentage: progress, roleId: nextRoleId, pdfViewMode }
        : { epubCfi: book.epubCfi, percentage: progress, roleId: nextRoleId }),
    });
  }

  function askAi(nextAction: AiAction) {
    setAction(nextAction);
    setAiOpen(true);
  }

  function toggleAiPanel() {
    if (aiOpen) {
      setAiOpen(false);
      return;
    }
    if (selection && !action) setAction("custom");
    setAiOpen(true);
    if (!selection) showToast("先在正文中选择一个单词、句子或段落");
  }

  async function saveHighlight() {
    if (!selection) return;
    const response = await fetch("/api/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: book.id,
        anchor: selection.anchor,
        selectedText: selection.selectedText,
        color: "yellow",
      }),
    });
    if (response.ok) {
      if (selection.anchor.type === "epub") {
        readerRef.current?.addHighlight(selection.anchor.cfiRange);
      } else {
        pdfReaderRef.current?.addHighlight(selection.anchor, selection.selectedText);
      }
      showToast("已添加黄色高亮");
    }
  }

  async function savePersonalNote() {
    if (!selection || !noteText.trim()) return;
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: book.id,
        noteType: "personal",
        title: selection.selectedText.slice(0, 48),
        selectedText: selection.selectedText,
        contentMarkdown: noteText,
        anchor: selection.anchor,
        roleId,
      }),
    });
    if (response.ok) {
      setNoteOpen(false);
      setNoteText("");
      showToast("个人笔记已保存");
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  return (
    <div className={clsx(
      "reader-shell",
      tocOpen && "has-toc",
      aiOpen && "has-ai",
      book.format === "pdf" ? "is-pdf-mode" : readingMode === "scroll" ? "is-scroll-mode" : "is-paginated-mode",
    )}>
      <h1 className="visually-hidden">{book.title}</h1>
      <header className="reader-topbar">
        <div className="reader-book-identity">
          <Link href="/library" className="icon-button" aria-label="返回书库"><ArrowLeft size={17} /></Link>
          <button className="icon-button" aria-label={tocOpen ? `关闭${book.format === "pdf" ? "页码" : "目录"}` : `打开${book.format === "pdf" ? "页码" : "目录"}`} onClick={() => setTocOpen((open) => !open)}>{tocOpen ? <PanelLeftClose size={17} /> : <Menu size={17} />}</button>
          <span><strong>{book.title}</strong><small>{book.author}</small></span>
        </div>
        <div className="reader-actions">
          <label className="role-switcher">
            <Sparkles size={14} aria-hidden="true" />
            <span className="visually-hidden">当前学习角色</span>
            <select name="reader-role" value={roleId} onChange={(event) => void saveRole(event.target.value)}>
              {roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </label>
          <button aria-label="打开快速命令" className="topbar-button reader-command-button" onClick={() => window.dispatchEvent(new Event("margin:open-command-palette"))}><Search size={16} /><span>命令</span></button>
          <button aria-label={settingsOpen ? "关闭阅读设置" : "打开阅读设置"} className={clsx("topbar-button", settingsOpen && "is-active")} onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={16} /><span>阅读设置</span></button>
          <button aria-label={aiOpen ? "关闭 AI 面板" : "打开 AI 面板"} className={clsx("topbar-button", aiOpen && "is-active")} onClick={toggleAiPanel}>{aiOpen ? <PanelRightClose size={16} /> : <Bot size={16} />}<span>AI</span></button>
        </div>
      </header>

      <aside className="toc-panel" aria-label={book.format === "pdf" ? "PDF 页码" : "书籍目录"} aria-hidden={!tocOpen} inert={!tocOpen ? true : undefined}>
        <header><span>{book.format === "pdf" ? "Pages" : "Contents"}</span><strong>{book.format === "pdf" ? "页码" : "目录"}</strong></header>
        <nav>{book.format === "pdf"
          ? <PdfPageNavigation currentPage={pdfPage} pageCount={pdfPageCount} onNavigate={(page) => pdfReaderRef.current?.navigate(page)} />
          : toc.length ? <TocItems items={toc} onNavigate={(href) => readerRef.current?.navigate(href)} /> : <p>正在读取目录…</p>}
        </nav>
        <footer><kbd>⌘ B</kbd> 收起{book.format === "pdf" ? "页码" : "目录"}</footer>
      </aside>

      <section className="reading-canvas" aria-label="书籍正文">
        {book.format === "pdf" ? pdfViewMode === "reflow" ? (
          <PdfReflowReader
            key="pdf-reflow"
            ref={pdfReaderRef}
            bookId={book.id}
            initialPage={pdfPage}
            fontSize={fontSize}
            lineHeight={lineHeight}
            fontFamily={fontFamily}
            onSelection={handleSelection}
            onProgress={handlePdfProgress}
            onDocumentReady={setPdfPageCount}
            onFallbackOriginal={() => changePdfViewMode("original")}
          />
        ) : (
          <PdfReader
            key="pdf-original"
            ref={pdfReaderRef}
            bookId={book.id}
            initialPage={pdfPage}
            onSelection={handleSelection}
            onProgress={handlePdfProgress}
            onDocumentReady={setPdfPageCount}
          />
        ) : (
          <EpubReader
            ref={readerRef}
            bookId={book.id}
            initialCfi={book.epubCfi}
            fontSize={fontSize}
            lineHeight={lineHeight}
            fontFamily={fontFamily}
            onSelection={handleSelection}
            onProgress={handleEpubProgress}
            onToc={handleToc}
          />
        )}
        {selection ? (
          <div className="selection-toolbar" role="toolbar" aria-label="选区操作">
            <button onClick={() => askAi("explain")}><MessageSquareText size={15} />解释</button>
            <button onClick={() => askAi("translate")}><Sparkles size={15} />翻译</button>
            <button onClick={() => askAi("grammar")}><TextCursorInput size={15} />句子分析</button>
            <button onClick={() => askAi("custom")}><Bot size={15} />自由提问</button>
            <span />
            <button onClick={() => void saveHighlight()}><Highlighter size={15} />高亮</button>
            <button onClick={() => setNoteOpen(true)}><NotebookPen size={15} />笔记</button>
            <button className="icon-only" aria-label="关闭选区工具" onClick={() => setSelection(null)}><X size={15} /></button>
          </div>
        ) : null}
        {settingsOpen ? (
          <section className="reader-settings" aria-label="阅读设置">
            <header><div><small>Reading</small><strong>阅读设置</strong></div><button className="icon-button" aria-label="关闭阅读设置" onClick={() => setSettingsOpen(false)}><X size={16} /></button></header>
            <fieldset className="reading-mode-field">
              <legend>阅读方式</legend>
              {book.format === "pdf" ? (
                <>
                  <div className="reading-mode-options">
                    <button type="button" aria-pressed={pdfViewMode === "reflow"} className={pdfViewMode === "reflow" ? "is-active" : ""} onClick={() => changePdfViewMode("reflow")}>文本重排</button>
                    <button type="button" aria-pressed={pdfViewMode === "original"} className={pdfViewMode === "original" ? "is-active" : ""} onClick={() => changePdfViewMode("original")}>PDF 原版</button>
                  </div>
                  <small>{pdfViewMode === "reflow"
                    ? "文字会按阅读宽度重新换行；图片、表格与复杂版式请用原版核对。"
                    : "直接阅读 PDF 原始页面，保留图片、表格和版式。"}</small>
                </>
              ) : (
                <>
                  <div className="reading-mode-options">
                    <button type="button" aria-pressed={readingMode === "scroll"} className={readingMode === "scroll" ? "is-active" : ""} onClick={() => changeReadingMode("scroll")}>连续滚动</button>
                    <button type="button" aria-pressed={readingMode === "paginated"} className={readingMode === "paginated" ? "is-active" : ""} onClick={() => changeReadingMode("paginated")}>分页阅读</button>
                  </div>
                  <small>{readingMode === "scroll" ? "上下滚动可连续阅读章节。" : "使用左右按钮或方向键翻页。"}</small>
                </>
              )}
            </fieldset>
            {book.format === "epub" || pdfViewMode === "reflow" ? (
              <>
                <label><span>字号 <em>{fontSize}px</em></span><input name="reader-font-size" type="range" min="15" max="26" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
                <label><span>行距 <em>{lineHeight.toFixed(1)}</em></span><input name="reader-line-height" type="range" min="1.4" max="2.2" step="0.1" value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} /></label>
                <label className="field"><span>正文字体</span><select name="reader-font-family" value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}><option value="Georgia, 'Times New Roman', serif">Georgia</option><option value="'Iowan Old Style', 'Palatino Linotype', serif">Iowan Old Style</option><option value="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">系统无衬线</option></select></label>
              </>
            ) : null}
          </section>
        ) : null}
      </section>

      {aiOpen && currentRole ? <AiPanel key={`${selection?.sourceKey || "empty"}:${action || "none"}:${roleId}`} book={book} selection={selection} action={action} role={currentRole} onClose={() => setAiOpen(false)} /> : null}

      <footer className="reader-footer">
        <span>{Math.round(progress)}%</span>
        <div className="reader-progress" role="progressbar" aria-label="阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${Math.round(progress)}%` }} /></div>
        <span>{book.format === "pdf" ? `PDF · ${pdfViewMode === "reflow" ? "重排" : "原版"}` : "EPUB"}</span>
      </footer>

      {noteOpen && selection ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setNoteOpen(false)}>
          <section className="dialog note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-title">
            <button className="icon-button dialog-close" aria-label="关闭" onClick={() => setNoteOpen(false)}><X size={18} /></button>
            <p className="eyebrow">Personal note</p><h2 id="note-title">为当前选区添加笔记</h2>
            <blockquote>{selection.selectedText}</blockquote>
            <label className="field"><span>你的笔记</span><textarea name="personal-note" autoComplete="off" rows={6} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="写下你的理解、联想或需要复习的地方…" /></label>
            <div className="dialog-actions"><button className="button secondary" onClick={() => setNoteOpen(false)}>取消</button><button className="button primary" disabled={!noteText.trim()} onClick={() => void savePersonalNote()}>保存笔记</button></div>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast" role="status"><Check size={15} />{toast}</div> : null}
    </div>
  );
}

function TocItems({ items, onNavigate }: { items: NavItem[]; onNavigate: (href: string) => void }) {
  return <ol>{items.map((item) => <li key={item.id || item.href}><button onClick={() => onNavigate(item.href)}>{item.label}</button>{item.subitems?.length ? <TocItems items={item.subitems} onNavigate={onNavigate} /> : null}</li>)}</ol>;
}

function PdfPageNavigation({ currentPage, pageCount, onNavigate }: { currentPage: number; pageCount: number; onNavigate: (page: number) => void }) {
  const nearbyPages = Array.from({ length: Math.min(7, pageCount) }, (_, index) => {
    const start = Math.max(1, Math.min(currentPage - 3, pageCount - 6));
    return start + index;
  });
  return (
    <div className="pdf-page-navigation">
      <p><strong>{currentPage}</strong><span>/ {pageCount || "—"} 页</span></p>
      <div>{nearbyPages.map((page) => <button key={page} className={page === currentPage ? "is-current" : ""} aria-current={page === currentPage ? "page" : undefined} onClick={() => onNavigate(page)}>第 {page} 页</button>)}</div>
    </div>
  );
}
