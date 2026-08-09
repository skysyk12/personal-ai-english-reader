"use client";

import { ChevronLeft, ChevronRight, Download, LoaderCircle, Maximize2, Minus, Plus } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { ReaderAnchor, ReaderSelection } from "@/lib/types";

type PdfViewerController = {
  currentPageNumber: number;
  currentScale: number;
  currentScaleValue: string;
  pagesCount: number;
  setDocument: (document: unknown | null) => void;
};

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

export type PdfReaderHandle = {
  navigate: (page: number) => void;
  addHighlight: (anchor: Extract<ReaderAnchor, { type: "pdf" }>, selectedText: string) => void;
};

type Props = {
  bookId: string;
  initialPage?: number | null;
  onSelection: (selection: ReaderSelection) => void;
  onProgress: (page: number, pageCount: number) => void;
  onDocumentReady: (pageCount: number) => void;
};

const HIGHLIGHT_NAME = "margin-pdf-saved-highlights";

const PdfReader = forwardRef<PdfReaderHandle, Props>(function PdfReader(
  { bookId, initialPage, onSelection, onProgress, onDocumentReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PdfViewerController | null>(null);
  const savedHighlightsRef = useRef<StoredPdfHighlight[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPage || 1)));
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("正在打开 PDF…");
  const [error, setError] = useState("");

  const refreshSavedHighlights = useCallback(() => {
    const root = viewerElementRef.current;
    const HighlightClass = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    if (!root || !HighlightClass || !registry) return;
    const highlight = new HighlightClass();
    for (const item of savedHighlightsRef.current) {
      const page = root.querySelector<HTMLElement>(`.page[data-page-number="${item.page}"] .textLayer`);
      const range = page ? findTextRange(page, item.selectedText) : null;
      if (range) highlight.add(range);
    }
    registry.set(HIGHLIGHT_NAME, highlight);
  }, []);

  const navigate = useCallback((page: number) => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.pagesCount) return;
    const nextPage = Math.max(1, Math.min(viewer.pagesCount, Math.round(page)));
    viewer.currentPageNumber = nextPage;
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
  }, []);

  useImperativeHandle(ref, () => ({
    navigate,
    addHighlight: (anchor, selectedText) => {
      savedHighlightsRef.current = [
        ...savedHighlightsRef.current,
        { page: anchor.page, selectedText },
      ];
      refreshSavedHighlights();
    },
  }), [navigate, refreshSavedHighlights]);

  useEffect(() => {
    let active = true;
    let loadingTask: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null;
    let viewer: PdfViewerController | null = null;

    async function open() {
      try {
        if (!containerRef.current || !viewerElementRef.current) return;
        setStatus("正在加载 PDF 阅读引擎…");
        const [pdfjs, highlightResponse] = await Promise.all([
          import("pdfjs-dist/webpack.mjs"),
          fetch(`/api/highlights?bookId=${encodeURIComponent(bookId)}`),
        ]);
        if (!active || !containerRef.current || !viewerElementRef.current) return;

        // The generic PDF.js viewer reads the core API from this browser global.
        // It must be assigned before (and therefore cannot be parallel with) the viewer import.
        (globalThis as typeof globalThis & { pdfjsLib?: typeof pdfjs }).pdfjsLib = pdfjs;
        const pdfViewerModule = await import("pdfjs-dist/web/pdf_viewer.mjs");
        if (!active || !containerRef.current || !viewerElementRef.current) return;

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

        const eventBus = new pdfViewerModule.EventBus();
        const linkService = new pdfViewerModule.PDFLinkService({ eventBus });
        viewer = new pdfViewerModule.PDFViewer({
          container: containerRef.current,
          viewer: viewerElementRef.current,
          eventBus,
          linkService,
          textLayerMode: 1,
          annotationMode: 2,
          supportsPinchToZoom: true,
          enableAutoLinking: true,
        }) as PdfViewerController;
        viewerRef.current = viewer;
        linkService.setViewer(viewer);

        eventBus.on("pagesinit", () => {
          if (!active || !viewer) return;
          viewer.currentScaleValue = "page-width";
          const startPage = Math.max(1, Math.min(viewer.pagesCount, initialPage || 1));
          navigate(startPage);
          onProgress(startPage, viewer.pagesCount);
          setStatus("");
        });
        eventBus.on("pagechanging", (event: { pageNumber?: number }) => {
          if (!active || !viewer) return;
          const pageNumber = Number(event.pageNumber || 1);
          setCurrentPage(pageNumber);
          setPageInput(String(pageNumber));
          onProgress(pageNumber, viewer.pagesCount);
        });
        eventBus.on("scalechanging", (event: { scale?: number }) => {
          const scale = Number(event.scale || 1);
          setZoom(Math.round(scale * 100));
        });
        eventBus.on("textlayerrendered", () => {
          window.requestAnimationFrame(refreshSavedHighlights);
        });

        setStatus("正在解析 PDF 页面…");
        const task = pdfjs.getDocument({ url: `/api/books/${bookId}/file` });
        loadingTask = task;
        const document = await task.promise;
        if (!active || !viewer) return;
        setPageCount(document.numPages);
        onDocumentReady(document.numPages);
        viewer.setDocument(document);
        linkService.setDocument(document, null);
      } catch (openError) {
        if (!active) return;
        setError(openError instanceof Error ? openError.message : "PDF 无法打开。");
        setStatus("");
      }
    }

    void open();
    return () => {
      active = false;
      viewer?.setDocument(null);
      viewerRef.current = null;
      const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
      registry?.delete(HIGHLIGHT_NAME);
      void loadingTask?.destroy();
    };
  }, [bookId, initialPage, navigate, onDocumentReady, onProgress, refreshSavedHighlights]);

  const captureSelection = useCallback(() => {
    const root = viewerElementRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const selectedText = selection.toString().replace(/\s+/g, " ").trim();
    if (!selectedText || selectedText.length > 2000) return;
    const pageElement = closestElement(range.startContainer, ".page") as HTMLElement | null;
    const page = Number(pageElement?.dataset.pageNumber || currentPage);
    const pageText = (pageElement?.querySelector(".textLayer")?.textContent || selectedText)
      .replace(/\s+/g, " ")
      .trim();
    const index = pageText.indexOf(selectedText);
    const start = Math.max(0, index);
    onSelection({
      selectedText,
      previous: pageText.slice(Math.max(0, start - 800), start),
      current: pageText.slice(Math.max(0, start - 260), start + selectedText.length + 260),
      next: pageText.slice(start + selectedText.length, start + selectedText.length + 800),
      anchor: { type: "pdf", page, textQuote: selectedText },
      sourceKey: `pdf:${page}:${start}:${selectedText}`,
    });
  }, [currentPage, onSelection]);

  function changeZoom(multiplier: number) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.currentScale = Math.max(0.35, Math.min(3, viewer.currentScale * multiplier));
  }

  return (
    <div className="pdf-stage">
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background: rgba(238, 194, 80, .62); }`}</style>
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF 阅读工具">
        <div className="pdf-page-control">
          <button type="button" aria-label="上一页" disabled={currentPage <= 1} onClick={() => navigate(currentPage - 1)}><ChevronLeft size={16} /></button>
          <form onSubmit={(event) => { event.preventDefault(); navigate(Number(pageInput)); }}>
            <label><span className="visually-hidden">当前页码</span><input name="pdf-page" type="text" inputMode="numeric" autoComplete="off" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} /></label>
            <span>/ {pageCount || "—"}</span>
          </form>
          <button type="button" aria-label="下一页" disabled={!pageCount || currentPage >= pageCount} onClick={() => navigate(currentPage + 1)}><ChevronRight size={16} /></button>
        </div>
        <div className="pdf-zoom-control">
          <button type="button" aria-label="缩小 PDF" onClick={() => changeZoom(0.9)}><Minus size={15} /></button>
          <span>{zoom}%</span>
          <button type="button" aria-label="放大 PDF" onClick={() => changeZoom(1.1)}><Plus size={15} /></button>
          <button type="button" aria-label="适合页面宽度" onClick={() => { if (viewerRef.current) viewerRef.current.currentScaleValue = "page-width"; }}><Maximize2 size={15} /></button>
          <a href={`/api/books/${bookId}/file`} download aria-label="下载 PDF"><Download size={15} /></a>
        </div>
      </div>
      <div
        ref={containerRef}
        className="pdf-viewer-container"
        role="region"
        aria-label="PDF 连续阅读区域"
        tabIndex={0}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        <div ref={viewerElementRef} className="pdfViewer" />
      </div>
      {status ? <div className="reader-status" role="status" aria-live="polite"><LoaderCircle className="spin" size={20} /><span>{status}</span></div> : null}
      {error ? <div className="reader-error" role="alert"><strong>无法打开这份 PDF</strong><span>{error}</span></div> : null}
    </div>
  );
});

export default PdfReader;

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
