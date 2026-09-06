"use client";

import type { LucideIcon } from "lucide-react";
import { BarChart3, BookMarked, BookOpen, BrainCircuit, FileText, FileUp, Library, NotebookPen, Search, Settings, UserRoundCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Command = {
  kind: "command";
  id: string;
  label: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
};

type ContentResult = {
  kind: "result";
  id: string;
  type: "book" | "content" | "vocabulary" | "note";
  title: string;
  meta: string;
  snippet: string;
  href: string;
};

type PaletteEntry = Command | ContentResult;

const COMMANDS: Command[] = [
  { kind: "command", id: "library", label: "打开书库", detail: "查看书籍与阅读进度", href: "/library", icon: Library, keywords: "library books 书库 书籍" },
  { kind: "command", id: "import", label: "导入书籍", detail: "把 EPUB 或 PDF 加入本地书库", href: "/library?import=1", icon: FileUp, keywords: "import epub pdf 导入 新书" },
  { kind: "command", id: "review", label: "开始今日复习", detail: "复习到期生词", href: "/review", icon: BrainCircuit, keywords: "review study srs 复习 学习" },
  { kind: "command", id: "vocabulary", label: "打开生词本", detail: "管理语境词汇与掌握状态", href: "/vocabulary", icon: BookMarked, keywords: "vocabulary words 生词 单词" },
  { kind: "command", id: "insights", label: "查看成长报告", detail: "阅读时长、节奏与复习信号", href: "/insights", icon: BarChart3, keywords: "insights report stats 成长 报告 统计" },
  { kind: "command", id: "search", label: "打开完整搜索", detail: "搜索书籍全文、生词和笔记", href: "/search", icon: Search, keywords: "search full text 搜索 全文" },
  { kind: "command", id: "roles", label: "管理学习角色", detail: "调整 AI 的目标、语言与讲解深度", href: "/roles", icon: UserRoundCog, keywords: "roles prompt 角色 学习" },
  { kind: "command", id: "notes", label: "查看阅读笔记", detail: "个人笔记与保存的 AI 回答", href: "/notes", icon: NotebookPen, keywords: "notes highlights 笔记 高亮" },
  { kind: "command", id: "settings", label: "打开设置", detail: "模型、本地数据与访问范围", href: "/settings", icon: Settings, keywords: "settings api key 设置 模型" },
];

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ContentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return COMMANDS;
    return COMMANDS.filter((command) => `${command.label} ${command.detail} ${command.keywords}`.toLowerCase().includes(normalized));
  }, [query]);
  const visibleSearchResults = query.trim().length >= 2 ? searchResults : [];
  const entries: PaletteEntry[] = [...filteredCommands, ...visibleSearchResults];

  const openPalette = useCallback(() => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSearchResults([]);
    setActiveIndex(0);
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) closePalette(); else openPalette();
      } else if (event.key === "Escape" && open) closePalette();
    }
    function handleOpen() { openPalette(); }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("margin:open-command-palette", handleOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("margin:open-command-palette", handleOpen);
    };
  }, [closePalette, open, openPalette]);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : { results: [] })
        .then((result: { results: Omit<ContentResult, "kind">[] }) => {
          setSearchResults(result.results.slice(0, 12).map((item) => ({ ...item, kind: "result" })));
        })
        .finally(() => setSearching(false));
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const background = [document.querySelector(".app-nav"), document.getElementById("main-content")].filter(Boolean) as HTMLElement[];
    background.forEach((element) => element.setAttribute("inert", ""));
    return () => background.forEach((element) => element.removeAttribute("inert"));
  }, [open]);

  function run(entry: PaletteEntry) {
    setOpen(false);
    router.push(entry.href);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => entries.length ? (current + 1) % entries.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => entries.length ? (current - 1 + entries.length) % entries.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (entries[activeIndex]) run(entries[activeIndex]);
      else if (query.trim().length >= 2) { setOpen(false); router.push(`/search?q=${encodeURIComponent(query.trim())}`); }
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(paletteRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? []);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  if (!open) return null;

  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePalette()}><section ref={paletteRef} className="command-palette command-palette-search" role="dialog" aria-modal="true" aria-labelledby="command-title" onKeyDown={handleDialogKeyDown}><h2 id="command-title" className="visually-hidden">搜索书库与快速跳转</h2><div className="command-search"><Search size={18} aria-hidden="true" /><input ref={inputRef} name="command-search" autoComplete="off" aria-label="搜索书籍全文或命令" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handleInputKeyDown} placeholder="搜索书籍、全文、生词、笔记或命令…" /><button type="button" aria-label="关闭命令面板" onClick={closePalette}><X size={16} /></button></div><div className="command-results" role="listbox" aria-label="搜索结果">{entries.length ? entries.map((entry, index) => <PaletteRow entry={entry} active={index === activeIndex} key={`${entry.kind}:${entry.id}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(entry)} />) : <div className="command-empty"><strong>{searching ? "正在搜索本地阅读索引…" : "没有匹配内容"}</strong><span>按 Enter 打开完整搜索，或换一个关键词。</span></div>}</div><footer><span>{searching ? "Indexing…" : query.trim().length >= 2 ? `${visibleSearchResults.length} 个内容结果` : "输入 2 个字符搜索全文"}</span><span><kbd>↑</kbd><kbd>↓</kbd> 移动</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer></section></div>;
}

function PaletteRow({ entry, active, onMouseEnter, onClick }: { entry: PaletteEntry; active: boolean; onMouseEnter: () => void; onClick: () => void }) {
  const title = entry.kind === "command" ? entry.label : entry.title;
  const detail = entry.kind === "command" ? entry.detail : entry.meta;
  return <button type="button" role="option" aria-selected={active} className={active ? "is-active" : ""} onMouseEnter={onMouseEnter} onClick={onClick}><span className="command-icon"><PaletteIcon entry={entry} /></span><span><strong>{title}</strong><small>{detail}</small>{entry.kind === "result" ? <p>{entry.snippet}</p> : null}</span>{entry.kind === "result" ? <em>{resultLabel(entry.type)}</em> : null}</button>;
}

function PaletteIcon({ entry }: { entry: PaletteEntry }) {
  if (entry.kind === "command") {
    const CommandIcon = entry.icon;
    return <CommandIcon size={17} />;
  }
  if (entry.type === "book") return <BookOpen size={17} />;
  if (entry.type === "vocabulary") return <BookMarked size={17} />;
  if (entry.type === "note") return <NotebookPen size={17} />;
  return <FileText size={17} />;
}

function resultLabel(type: ContentResult["type"]) {
  return type === "book" ? "书籍" : type === "vocabulary" ? "生词" : type === "note" ? "笔记" : "正文";
}
