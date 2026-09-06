"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { ReaderSelection } from "@/lib/types";
import type { Book, Contents, NavItem, Rendition } from "epubjs";

export type EpubReaderHandle = {
  previous: () => void;
  next: () => void;
  navigate: (href: string) => void;
  addHighlight: (cfiRange: string, color?: string) => void;
  setReadingMode: (mode: ReaderFlowMode) => void;
  getStudyContext: () => ReaderSelection | null;
};

export type ReaderFlowMode = "scroll" | "paginated";

type Props = {
  bookId: string;
  initialCfi?: string | null;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  onSelection: (selection: ReaderSelection) => void;
  onProgress: (cfi: string, percentage: number) => void;
  onToc: (items: NavItem[]) => void;
};

const EpubReader = forwardRef<EpubReaderHandle, Props>(function EpubReader(
  { bookId, initialCfi, fontSize, lineHeight, fontFamily, onSelection, onProgress, onToc },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const readingModeRef = useRef<ReaderFlowMode>("scroll");
  const currentCfiRef = useRef(initialCfi || "");
  const [status, setStatus] = useState("正在打开 EPUB…");
  const [error, setError] = useState("");

  const labelReaderFrames = useCallback(() => {
    mountRef.current?.querySelectorAll("iframe").forEach((frame) => {
      frame.setAttribute("title", "EPUB 书籍正文");
    });
  }, []);

  const configureReadingContainer = useCallback((mode: ReaderFlowMode) => {
    const container = mountRef.current?.querySelector<HTMLElement>(".epub-container");
    if (!container) return;
    if (mode === "scroll") {
      container.tabIndex = 0;
      container.setAttribute("role", "region");
      container.setAttribute("aria-label", "连续阅读区域");
    } else {
      container.removeAttribute("tabindex");
      container.removeAttribute("role");
      container.removeAttribute("aria-label");
    }
  }, []);

  const addHighlight = useCallback((cfiRange: string, color = "#e1b84b") => {
    try {
      renditionRef.current?.annotations.highlight(
        cfiRange,
        {},
        undefined,
        "margin-highlight",
        { fill: color, "fill-opacity": "0.34", "mix-blend-mode": "multiply" },
      );
    } catch {
      // Persistence is authoritative. A stale CFI should not break the reader UI.
    }
  }, []);

  useImperativeHandle(ref, () => ({
    previous: () => { void renditionRef.current?.prev(); },
    next: () => { void renditionRef.current?.next(); },
    navigate: (href: string) => { void renditionRef.current?.display(href); },
    addHighlight,
    setReadingMode: (mode) => {
      readingModeRef.current = mode;
      renditionRef.current?.flow(flowForMode(mode));
      configureReadingContainer(mode);
    },
    getStudyContext: () => {
      const contents = (renditionRef.current as (Rendition & { getContents?: () => Contents[] }) | null)
        ?.getContents?.()?.[0];
      const text = (contents?.document.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 7800);
      const cfiRange = currentCfiRef.current;
      if (!text || !cfiRange) return null;
      return {
        selectedText: text,
        previous: "",
        current: text,
        next: "",
        anchor: { type: "epub", cfiRange },
        sourceKey: `epub-study:${cfiRange}:${text.slice(0, 80)}`,
      };
    },
  }), [addHighlight, configureReadingContainer]);

  useEffect(() => {
    let active = true;
    let book: Book | null = null;
    let rendition: Rendition | null = null;

    async function open() {
      try {
        const { default: ePub } = await import("epubjs");
        if (!active || !mountRef.current) return;
        setStatus("正在读取本地书籍…");
        const fileResponse = await fetch(`/api/books/${bookId}/file`);
        if (!fileResponse.ok) {
          const result = await fileResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(result?.error || "本地 EPUB 文件无法读取。");
        }
        const archive = await fileResponse.arrayBuffer();
        if (!active || !mountRef.current) return;
        setStatus("正在解析章节与目录…");
        book = ePub(archive);
        bookRef.current = book;
        rendition = book.renderTo(mountRef.current, {
          width: "100%",
          height: "100%",
          flow: flowForMode(readingModeRef.current),
          spread: "none",
          manager: "continuous",
          snap: true,
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        configureReadingContainer(readingModeRef.current);
        rendition.hooks.content.register((contents: Contents) => {
          const scrollContainer = () => mountRef.current?.querySelector<HTMLElement>(".epub-container");
          let lastTouchY: number | null = null;
          contents.document.addEventListener("wheel", (event) => {
            if (readingModeRef.current !== "scroll" || event.ctrlKey) return;
            const container = scrollContainer();
            if (!container) return;
            container.scrollBy({ top: event.deltaY, left: 0, behavior: "auto" });
            event.preventDefault();
          }, { passive: false });
          contents.document.addEventListener("touchstart", (event) => {
            lastTouchY = event.touches.length === 1 ? event.touches[0].clientY : null;
          }, { passive: true });
          contents.document.addEventListener("touchmove", (event) => {
            if (readingModeRef.current !== "scroll" || lastTouchY === null || event.touches.length !== 1) return;
            const selection = contents.window.getSelection();
            if (selection && !selection.isCollapsed) return;
            const nextY = event.touches[0].clientY;
            const distance = lastTouchY - nextY;
            lastTouchY = nextY;
            if (Math.abs(distance) < 2) return;
            const container = scrollContainer();
            if (!container) return;
            container.scrollBy({ top: distance, left: 0, behavior: "auto" });
            event.preventDefault();
          }, { passive: false });
          contents.document.addEventListener("touchend", () => { lastTouchY = null; }, { passive: true });
          contents.document.addEventListener("keydown", (event) => {
            const target = event.target as HTMLElement | null;
            if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
            if (readingModeRef.current === "paginated") {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                void renditionRef.current?.prev();
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                void renditionRef.current?.next();
              }
              return;
            }
            const container = scrollContainer();
            if (!container) return;
            const pageDistance = Math.max(240, container.clientHeight * 0.82);
            const distance = event.key === "ArrowDown" ? 72
              : event.key === "ArrowUp" ? -72
                : event.key === "PageDown" || (event.key === " " && !event.shiftKey) ? pageDistance
                  : event.key === "PageUp" || (event.key === " " && event.shiftKey) ? -pageDistance
                    : 0;
            if (!distance) return;
            event.preventDefault();
            container.scrollBy({ top: distance, left: 0, behavior: "smooth" });
          });
        });
        const baseTheme = {
          body: {
            background: "transparent !important",
            "font-family": `${fontFamily} !important`,
            "line-height": `${lineHeight} !important`,
            padding: "0 4% !important",
          },
          p: { "margin-bottom": "1em !important" },
          "::selection": { background: "rgba(94, 106, 210, 0.24) !important" },
        };
        rendition.themes.register("margin-reader-light", {
          ...baseTheme,
          body: { ...baseTheme.body, color: "#202129 !important" },
          a: { color: "#4b58bd !important" },
        });
        rendition.themes.register("margin-reader-night", {
          ...baseTheme,
          body: { ...baseTheme.body, color: "#e8ebf0 !important" },
          a: { color: "#aeb6ff !important" },
        });
        rendition.themes.select(document.documentElement.dataset.theme === "night" ? "margin-reader-night" : "margin-reader-light");
        rendition.themes.fontSize(`${fontSize}px`);

        rendition.on("selected", (cfiRange, contents) => {
          const selectedText = contents.window.getSelection()?.toString().replace(/\s+/g, " ").trim() || "";
          if (!selectedText || selectedText.length > 2000) return;
          const bodyText = (contents.document.body.textContent || "").replace(/\s+/g, " ").trim();
          const index = bodyText.indexOf(selectedText);
          const start = Math.max(0, index >= 0 ? index : 0);
          const previous = bodyText.slice(Math.max(0, start - 800), start);
          const next = bodyText.slice(start + selectedText.length, start + selectedText.length + 800);
          const current = bodyText.slice(Math.max(0, start - 260), start + selectedText.length + 260);
          onSelection({
            selectedText,
            previous,
            current,
            next,
            anchor: { type: "epub", cfiRange },
            sourceKey: cfiRange,
          });
        });

        rendition.on("relocated", (location) => {
          labelReaderFrames();
          const cfi = location.start.cfi;
          currentCfiRef.current = cfi;
          let percentage = location.start.percentage ?? 0;
          try { percentage = book?.locations.percentageFromCfi(cfi) ?? percentage; } catch { /* locations may still be generating */ }
          onProgress(cfi, Math.max(0, Math.min(100, percentage * 100)));
        });

        await book.ready;
        const navigationPromise = book.loaded.navigation;
        await rendition.display(initialCfi || undefined);
        configureReadingContainer(readingModeRef.current);
        labelReaderFrames();
        const navigation = await navigationPromise;
        if (!active) return;
        onToc(navigation.toc);
        setStatus("");

        window.setTimeout(() => {
          if (active) void book?.locations.generate(1200).catch(() => undefined);
        }, 600);

        const highlightResponse = await fetch(`/api/highlights?bookId=${encodeURIComponent(bookId)}`);
        if (highlightResponse.ok) {
          const highlights = await highlightResponse.json() as Array<{ anchor_json: string; color: string }>;
          for (const item of highlights) {
            const anchor = JSON.parse(item.anchor_json) as { cfiRange?: string };
            if (anchor.cfiRange) addHighlight(anchor.cfiRange, highlightColor(item.color));
          }
        }
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : "EPUB 无法打开。");
      }
    }

    void open();
    return () => {
      active = false;
      rendition?.destroy();
      book?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
  // Font settings are updated by the focused theme effect below; recreating the book
  // on each slider movement would lose the current CFI.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addHighlight, bookId, configureReadingContainer, initialCfi, labelReaderFrames, onProgress, onSelection, onToc]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${fontSize}px`);
    const body = { "font-family": `${fontFamily} !important`, "line-height": `${lineHeight} !important` };
    rendition.themes.register("margin-reader-light", { body: { ...body, color: "#202129 !important", background: "transparent !important", padding: "0 4% !important" } });
    rendition.themes.register("margin-reader-night", { body: { ...body, color: "#e8ebf0 !important", background: "transparent !important", padding: "0 4% !important" } });
    rendition.themes.select(document.documentElement.dataset.theme === "night" ? "margin-reader-night" : "margin-reader-light");
  }, [fontFamily, fontSize, lineHeight]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      renditionRef.current?.themes.select(
        document.documentElement.dataset.theme === "night" ? "margin-reader-night" : "margin-reader-light",
      );
      renditionRef.current?.themes.fontSize(`${fontSize}px`);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [fontSize]);

  return (
    <div className="epub-stage">
      {status ? <div className="reader-status"><LoaderCircle className="spin" size={20} /><span>{status}</span></div> : null}
      {error ? <div className="reader-error"><strong>无法打开这本书</strong><span>{error}</span></div> : null}
      <div className="epub-mount" ref={mountRef} />
      <button className="page-turn previous" aria-label="上一页" onClick={() => void renditionRef.current?.prev()}><ChevronLeft size={21} /></button>
      <button className="page-turn next" aria-label="下一页" onClick={() => void renditionRef.current?.next()}><ChevronRight size={21} /></button>
    </div>
  );
});

export default EpubReader;

function highlightColor(color: string): string {
  return { yellow: "#e1b84b", blue: "#6ea2db", green: "#67a87c", red: "#d9756b" }[color] || "#e1b84b";
}

function flowForMode(mode: ReaderFlowMode): "scrolled" | "paginated" {
  return mode === "scroll" ? "scrolled" : "paginated";
}
