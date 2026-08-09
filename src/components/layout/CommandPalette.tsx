"use client";

import type { LucideIcon } from "lucide-react";
import { BookOpen, FileUp, Library, NotebookPen, Search, Settings, UserRoundCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Command = {
  id: string;
  label: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
};

const COMMANDS: Command[] = [
  { id: "library", label: "打开书库", detail: "查看书籍与阅读进度", href: "/library", icon: Library, keywords: "library books 书库 书籍" },
  { id: "import", label: "导入书籍", detail: "把 EPUB 或 PDF 加入本地书库", href: "/library?import=1", icon: FileUp, keywords: "import epub pdf 导入 新书" },
  { id: "roles", label: "管理学习角色", detail: "调整 AI 的目标、语言与讲解深度", href: "/roles", icon: UserRoundCog, keywords: "roles prompt 角色 学习" },
  { id: "notes", label: "搜索阅读笔记", detail: "查看个人笔记与保存的 AI 回答", href: "/notes", icon: NotebookPen, keywords: "notes highlights 笔记 高亮" },
  { id: "settings", label: "打开设置", detail: "检查模型、本地数据与访问范围", href: "/settings", icon: Settings, keywords: "settings api key 设置 模型" },
];

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return COMMANDS;
    return COMMANDS.filter((command) => `${command.label} ${command.detail} ${command.keywords}`.toLowerCase().includes(normalized));
  }, [query]);

  const openPalette = useCallback(() => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
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
        if (open) closePalette();
        else openPalette();
      } else if (event.key === "Escape" && open) {
        closePalette();
      }
    }
    function handleOpen() {
      openPalette();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("margin:open-command-palette", handleOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("margin:open-command-palette", handleOpen);
    };
  }, [closePalette, open, openPalette]);

  useEffect(() => {
    if (!open) return;
    const background = [document.querySelector(".app-nav"), document.getElementById("main-content")].filter(Boolean) as HTMLElement[];
    background.forEach((element) => element.setAttribute("inert", ""));
    return () => background.forEach((element) => element.removeAttribute("inert"));
  }, [open]);

  function run(command: Command) {
    setOpen(false);
    router.push(command.href);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => filtered.length ? (current + 1) % filtered.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => filtered.length ? (current - 1 + filtered.length) % filtered.length : 0);
    } else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      run(filtered[activeIndex]);
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(paletteRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? []);
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

  if (!open) return null;

  return (
    <div className="command-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePalette()}>
      <section ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-title" onKeyDown={handleDialogKeyDown}>
        <h2 id="command-title" className="visually-hidden">快速搜索与跳转</h2>
        <div className="command-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            name="command-search"
            autoComplete="off"
            aria-label="搜索命令"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索页面或操作…"
          />
          <button type="button" aria-label="关闭命令面板" onClick={closePalette}><X size={16} /></button>
        </div>
        <div className="command-results" role="listbox" aria-label="可用命令">
          {filtered.length ? filtered.map((command, index) => {
            const Icon = command.icon;
            const active = index === activeIndex;
            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "is-active" : ""}
                key={command.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(command)}
              >
                <span className="command-icon"><Icon size={17} aria-hidden="true" /></span>
                <span><strong>{command.label}</strong><small>{command.detail}</small></span>
                {command.id === "library" ? <BookOpen size={14} aria-hidden="true" /> : null}
              </button>
            );
          }) : <div className="command-empty"><strong>没有匹配的命令</strong><span>试试“书库”“角色”或“导入”。</span></div>}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> 移动</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
      </section>
    </div>
  );
}
