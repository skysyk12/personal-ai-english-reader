import type { Metadata, Viewport } from "next";
import "pdfjs-dist/web/pdf_viewer.css";
import "./globals.css";

import { AppFrame } from "@/components/layout/AppNav";
import { CommandPalette } from "@/components/layout/CommandPalette";

export const metadata: Metadata = {
  title: "Margin — Personal AI English Reader",
  description: "A local-first English reading workspace with role-driven AI explanations.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b111a" },
  ],
};

const themeBoot = `
  try {
    var storedTheme = localStorage.getItem('reader-theme');
    var theme = storedTheme === 'night' || storedTheme === 'light'
      ? storedTheme
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (_) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBoot }} /></head>
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <AppFrame>{children}</AppFrame>
        <CommandPalette />
      </body>
    </html>
  );
}
