"use client";

import { FileScan, LoaderCircle } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { PdfReflowBlock, PdfReflowDocument } from "@/lib/books/pdf-reflow-types";
import type { ReaderAnchor, ReaderSelection } from "@/lib/types";
import type { PdfReaderHandle } from "./PdfReader";

type CssHighlight = { add: (range: Range) => void };
type HighlightConstructor = new (...ranges: Range[]) => CssHighlight;
type HighlightRegistry = {
  delete: (name: string) => boolean;
  set: (name: string, highlight: CssHighlight) => void;
};

type StoredPdfHighlight = {
  page: number;
  selectedText: string;
};

type Props = {
  bookId: string;
  initialPage?: number | null;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  onSelection: (selection: ReaderSelection) => void;
  onProgress: (page: number, pageCount: number) => void;
  onDocumentReady: (pageCount: number) => void;
  onFallbackOriginal: () => void;
};

const HIGHLIGHT_NAME = "margin-pdf-reflow-highlights";

const PdfReflowReader = forwardRef<PdfReaderHandle, Props>(function PdfReflowReader(
  {
    bookId,
    initialPage,
    fontSize,
    lineHeight,
    fontFamily,
    onSelection,
    onProgress,
    onDocumentReady,
    onFallbackOriginal,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageCountRef = useRef(0);
  const currentPageRef = useRef(Math.max(1, initialPage || 1));
  const savedHighlightsRef = useRef<StoredPdfHighlight[]>([]);
  const [document, setDocument] = useState<PdfReflowDocument | null>(null);
  const [status, setStatus] = useState("正在提取 PDF 文字并重新排版…");
  const [error, setError] = useState("");

  const refreshSavedHighlights = useCallback(() => {
    const root = containerRef.current;
    const HighlightClass = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    if (!root || !HighlightClass || !registry) return;
    const highlight = new HighlightClass();
    for (const item of savedHighlightsRef.current) {
      const page = root.querySelector<HTMLElement>(`[data-pdf-page="${item.page}"]`);
      const range = page ? findTextRange(page, item.selectedText) : null;
      if (range) highlight.add(range);
    }
    registry.set(HIGHLIGHT_NAME, highlight);
  }, []);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior) => {
    const root = containerRef.current;
    const pageCount = pageCountRef.current;
    if (!root || !pageCount) return;
    const nextPage = Math.max(1, Math.min(pageCount, Math.round(page)));
    const target = root.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`);
    if (!target) return;
    root.scrollTo({
      top: nextPage === 1 ? 0 : Math.max(0, target.offsetTop - 16),
      behavior,
    });
    if (behavior === "auto") {
      // content-visibility may replace an estimated page height after the jump.
      // Correct after layout settles so the requested page starts at the top.
      const correctPosition = () => {
        if (!root.isConnected || currentPageRef.current !== nextPage) return;
        const settledTarget = root.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`);
        if (!settledTarget) return;
        const settledTop = nextPage === 1 ? 0 : Math.max(0, settledTarget.offsetTop - 16);
        if (Math.abs(root.scrollTop - settledTop) > 2) root.scrollTo({ top: settledTop, behavior: "auto" });
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(correctPosition));
      window.setTimeout(correctPosition, 120);
    }
    currentPageRef.current = nextPage;
    onProgress(nextPage, pageCount);
  }, [onProgress]);

  const navigate = useCallback((page: number) => {
    const nearby = Math.abs(page - currentPageRef.current) <= 2;
    scrollToPage(
      page,
      nearby && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
    );
  }, [scrollToPage]);

  useImperativeHandle(ref, () => ({
    navigate,
    addHighlight: (anchor: Extract<ReaderAnchor, { type: "pdf" }>, selectedText: string) => {
      savedHighlightsRef.current = [
        ...savedHighlightsRef.current,
        { page: anchor.page, selectedText },
      ];
      refreshSavedHighlights();
    },
  }), [navigate, refreshSavedHighlights]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const [reflowResponse, highlightResponse] = await Promise.all([
          fetch(`/api/books/${bookId}/reflow`, { signal: controller.signal }),
          fetch(`/api/highlights?bookId=${encodeURIComponent(bookId)}`, { signal: controller.signal }),
        ]);
        const reflowResult = await reflowResponse.json() as PdfReflowDocument & {
          error?: string;
          details?: string;
        };
        if (!reflowResponse.ok) {
          throw new Error([reflowResult.error, reflowResult.details].filter(Boolean).join(" "));
        }
        if (!active) return;

        if (highlightResponse.ok) {
          const highlights = await highlightResponse.json() as Array<{
            anchor_type: string;
            anchor_json: string;
            selected_text: string;
          }>;
          savedHighlightsRef.current = highlights.flatMap((item) => {
            if (item.anchor_type !== "pdf") return [];
            try {
              const anchor = JSON.parse(item.anchor_json) as { page?: number };
              return anchor.page
                ? [{ page: anchor.page, selectedText: item.selected_text }]
                : [];
            } catch {
              return [];
            }
          });
        }

        pageCountRef.current = reflowResult.pageCount;
        setDocument(reflowResult);
        setStatus("");
        onDocumentReady(reflowResult.pageCount);
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "PDF 文本重排失败。");
        setStatus("");
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
      const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
      registry?.delete(HIGHLIGHT_NAME);
    };
  }, [bookId, onDocumentReady]);

  useEffect(() => {
    if (!document || document.textPageCount === 0 || !containerRef.current) return;
    const root = containerRef.current;
    const visibility = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.pdfPage || 0);
        visibility.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      let visiblePage = 0;
      let visibleRatio = 0;
      for (const [page, ratio] of visibility) {
        if (ratio > visibleRatio) {
          visiblePage = page;
          visibleRatio = ratio;
        }
      }
      if (visiblePage) {
        currentPageRef.current = visiblePage;
        onProgress(visiblePage, document.pageCount);
      }
    }, { root, rootMargin: "-12% 0px -42%", threshold: [0, 0.15, 0.35, 0.6] });

    const pages = root.querySelectorAll<HTMLElement>("[data-pdf-page]");
    const frame = window.requestAnimationFrame(() => {
      // Restoring a distant page in a long PDF must be immediate; a smooth
      // animation across hundreds of pages can take seconds and fight user input.
      scrollToPage(initialPage || 1, "auto");
      refreshSavedHighlights();
      // Start progress observation only after the saved page is restored.
      // Otherwise page 1 can report first and overwrite a distant saved page.
      pages.forEach((page) => observer.observe(page));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [document, initialPage, onProgress, refreshSavedHighlights, scrollToPage]);

  const captureSelection = useCallback(() => {
    const root = containerRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const selectedText = normalizeText(selection.toString());
    if (!selectedText || selectedText.length > 2000) return;
    const pageElement = closestElement(range.startContainer, "[data-pdf-page]") as HTMLElement | null;
    const page = Number(pageElement?.dataset.pdfPage || initialPage || 1);
    const pageText = Array.from(pageElement?.querySelectorAll<HTMLElement>("[data-reflow-block]") || [])
      .map((block) => block.textContent || "")
      .join(" ");
    const normalizedPageText = normalizeText(pageText || selectedText);
    const index = normalizedPageText.indexOf(selectedText);
    const start = Math.max(0, index);
    onSelection({
      selectedText,
      previous: normalizedPageText.slice(Math.max(0, start - 800), start),
      current: normalizedPageText.slice(Math.max(0, start - 260), start + selectedText.length + 260),
      next: normalizedPageText.slice(start + selectedText.length, start + selectedText.length + 800),
      anchor: { type: "pdf", page, textQuote: selectedText },
      sourceKey: `pdf-reflow:${page}:${start}:${selectedText}`,
    });
  }, [initialPage, onSelection]);

  if (document?.textPageCount === 0) {
    return (
      <div className="pdf-reflow-stage">
        <div className="pdf-reflow-empty" role="status">
          <FileScan size={27} aria-hidden="true" />
          <strong>这份 PDF 没有可重排的文字</strong>
          <span>它可能是扫描件或图片型 PDF。目前未启用 OCR，请使用原版阅读。</span>
          <button type="button" className="button primary" onClick={onFallbackOriginal}>切换到 PDF 原版</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-reflow-stage">
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background: rgba(238, 194, 80, .62); }`}</style>
      <div
        ref={containerRef}
        className="pdf-reflow-scroll"
        role="region"
        aria-label="PDF 文本重排阅读区域"
        tabIndex={0}
        style={{
          "--reflow-font-size": `${fontSize}px`,
          "--reflow-line-height": String(lineHeight),
          "--reflow-font-family": fontFamily,
        } as React.CSSProperties}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {document ? (
          <article className="pdf-reflow-document">
            <header className="pdf-reflow-intro">
              <span>Text reflow</span>
              <p>文字已按阅读宽度重新排版。遇到图片、表格或复杂分栏时，可切换至 PDF 原版核对。</p>
            </header>
            {document.pages.map((page) => (
              <section className="pdf-reflow-page" data-pdf-page={page.pageNumber} aria-label={`第 ${page.pageNumber} 页`} key={page.pageNumber}>
                <div className="pdf-reflow-page-label" aria-hidden="true"><span>Page</span><strong>{page.pageNumber}</strong></div>
                <div className="pdf-reflow-content">
                  {page.blocks.length
                    ? page.blocks.map((block) => <ReflowBlock block={block} key={block.id} />)
                    : <p className="pdf-reflow-page-empty">本页没有可提取的文字。</p>}
                </div>
              </section>
            ))}
          </article>
        ) : null}
      </div>
      {status ? <div className="reader-status" role="status" aria-live="polite"><LoaderCircle className="spin" size={20} aria-hidden="true" /><span>{status}</span></div> : null}
      {error ? (
        <div className="reader-error" role="alert">
          <strong>PDF 文本重排失败</strong>
          <span>{error}</span>
          <button type="button" className="button secondary" onClick={onFallbackOriginal}>切换到 PDF 原版</button>
        </div>
      ) : null}
    </div>
  );
});

export default PdfReflowReader;

function ReflowBlock({ block }: { block: PdfReflowBlock }) {
  if (block.kind === "heading") return <h2 data-reflow-block>{block.text}</h2>;
  if (block.kind === "list-item") return <p className="pdf-reflow-list-item" data-reflow-block>{block.text}</p>;
  return <p data-reflow-block>{block.text}</p>;
}

function closestElement(node: Node, selector: string): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest(selector) ?? null;
}

function findTextRange(root: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    text += node.data;
  }
  const start = text.indexOf(quote);
  if (start < 0) return null;
  const end = start + quote.length;
  let cursor = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (const node of nodes) {
    const next = cursor + node.data.length;
    if (!startNode && start >= cursor && start <= next) {
      startNode = node;
      startOffset = start - cursor;
    }
    if (end >= cursor && end <= next) {
      endNode = node;
      endOffset = end - cursor;
      break;
    }
    cursor = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
