import type { Metadata, Viewport } from "next";
import "pdfjs-dist/web/pdf_viewer.css";
import "./globals.css";

import { AppNav } from "@/components/layout/AppNav";
import { CommandPalette } from "@/components/layout/CommandPalette";

export const metadata: Metadata = {
  title: "Margin — Personal AI English Reader",
  description: "A local-first English reading workspace with role-driven AI explanations.",
};

export const viewport: Viewport = {
  themeColor: "#f5f6f8",
};

const themeBoot = `
  try {
    localStorage.setItem('reader-theme', 'os');
    document.documentElement.dataset.theme = 'os';
  } catch (_) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBoot }} /></head>
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <AppNav />
        <main id="main-content">{children}</main>
        <CommandPalette />
      </body>
    </html>
  );
}
