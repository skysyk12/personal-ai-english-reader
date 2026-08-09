"use client";

import clsx from "clsx";
import { BookOpen, Library, NotebookPen, Search, Settings, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/library", label: "书库", icon: Library },
  { href: "/roles", label: "学习角色", icon: UserRoundCog },
  { href: "/notes", label: "笔记", icon: NotebookPen },
  { href: "/settings", label: "设置", icon: Settings },
];

export function AppNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/reader/")) return null;

  return (
    <header className="app-nav">
      <Link href="/library" className="brand" aria-label="返回书库">
        <span className="brand-mark" aria-hidden="true"><BookOpen size={18} /></span>
        <span>
          <strong>Margin</strong>
          <small>Personal English Reader</small>
        </span>
      </Link>
      <div className="app-nav-actions">
        <nav aria-label="主导航">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link key={href} href={href} aria-label={label} aria-current={active ? "page" : undefined} className={clsx("nav-link", active && "is-active")}>
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <button className="command-trigger" type="button" aria-label="打开快速命令" onClick={() => window.dispatchEvent(new Event("margin:open-command-palette"))}>
          <Search size={15} aria-hidden="true" />
          <span>搜索或跳转</span>
          <kbd>⌘ K</kbd>
        </button>
      </div>
    </header>
  );
}
