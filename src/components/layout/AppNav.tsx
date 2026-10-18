"use client";

import clsx from "clsx";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  BrainCircuit,
  FileUp,
  Home,
  Library,
  Menu,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  UserRoundCog,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "./ThemeToggle";

const primaryItems = [
  { href: "/", label: "主界面", icon: Home },
  { href: "/library", label: "书库", icon: Library },
  { href: "/review", label: "复习", icon: BrainCircuit },
  { href: "/vocabulary", label: "生词", icon: BookMarked },
  { href: "/notes", label: "笔记", icon: NotebookPen },
  { href: "/insights", label: "成长", icon: BarChart3 },
];

const utilityItems = [
  { href: "/roles", label: "学习角色", icon: UserRoundCog },
  { href: "/settings", label: "设置", icon: Settings },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const isReader = pathname.startsWith("/reader/");

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem("margin:sidebar:v1") === "collapsed");
    } catch {
      // A non-persistent sidebar remains fully usable.
    }
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileCloseRef.current?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      requestAnimationFrame(() => mobileMenuRef.current?.focus());
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen]);

  if (isReader) return <main id="main-content">{children}</main>;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("margin:sidebar:v1", next ? "collapsed" : "expanded"); } catch { /* storage can be unavailable */ }
      return next;
    });
  }

  function openCommand() {
    window.dispatchEvent(new Event("margin:open-command-palette"));
  }

  function closeMobileSidebar() {
    setMobileOpen(false);
    requestAnimationFrame(() => mobileMenuRef.current?.focus());
  }

  return (
    <div className={clsx("app-frame", collapsed && "is-sidebar-collapsed", mobileOpen && "is-mobile-sidebar-open")}>
      <header className="mobile-app-bar" inert={mobileOpen ? true : undefined}>
        <Link href="/" className="mobile-brand" aria-label="返回 Margin 主界面"><BookOpen size={18} /><strong translate="no">Margin</strong></Link>
        <div><button type="button" aria-label="打开快捷命令" onClick={openCommand}><Search size={18} aria-hidden="true" /></button><button ref={mobileMenuRef} type="button" aria-label="打开侧边栏" aria-controls="app-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} aria-hidden="true" /></button></div>
      </header>

      <button className="sidebar-scrim" type="button" aria-label="关闭侧边栏" onClick={closeMobileSidebar} />
      <aside id="app-sidebar" className="app-sidebar" aria-label="Margin 导航">
        <header className="sidebar-brand-row">
          <button
            type="button"
            className="sidebar-desktop-toggle"
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <Link href="/" className="sidebar-brand" aria-label="返回 Margin 主界面" onClick={() => setMobileOpen(false)}>
            <span className="sidebar-brand-mark" aria-hidden="true"><BookOpen size={18} /></span>
            <span><strong translate="no">Margin</strong><small translate="no">AI Reading OS</small></span>
          </Link>
          <button ref={mobileCloseRef} className="sidebar-mobile-close" type="button" aria-label="关闭侧边栏" onClick={closeMobileSidebar}><X size={18} aria-hidden="true" /></button>
        </header>

        <button type="button" className="sidebar-router-button" aria-label="询问 Margin" title="询问 Margin" onClick={openCommand}>
          <Sparkles size={16} aria-hidden="true" /><span>询问 Margin</span><kbd>⌘ K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="主导航">
          {primaryItems.map((item) => <SidebarLink key={item.href} {...item} pathname={pathname} onNavigate={() => setMobileOpen(false)} />)}
        </nav>

        <div className="sidebar-grow" />
        <Link className="sidebar-import" href="/library?import=1" aria-label="导入书籍" title="导入书籍" onClick={() => setMobileOpen(false)}><FileUp size={16} aria-hidden="true" /><span>导入书籍</span></Link>
        <nav className="sidebar-nav sidebar-utilities" aria-label="工具与设置">
          {utilityItems.map((item) => <SidebarLink key={item.href} {...item} pathname={pathname} onNavigate={() => setMobileOpen(false)} />)}
        </nav>
        <footer className="sidebar-footer">
          <ThemeToggle />
          <span>本地优先</span>
        </footer>
      </aside>
      <main id="main-content" className="app-frame-main" inert={mobileOpen ? true : undefined}>{children}</main>
    </div>
  );
}

function SidebarLink({ href, label, icon: Icon, pathname, onNavigate }: {
  href: string;
  label: string;
  icon: typeof Home;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} title={label} aria-label={label} aria-current={active ? "page" : undefined} className={clsx("sidebar-link", active && "is-active")} onClick={onNavigate}>
      <Icon size={17} aria-hidden="true" /><span>{label}</span>
    </Link>
  );
}
