import "server-only";

import type { PDFDocumentProxy } from "pdfjs-dist";

export async function withPdfDocument<T>(
  bytes: Uint8Array,
  read: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const [{ getDocument }, { WorkerMessageHandler }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);

  // Next.js relocates server chunks, so PDF.js cannot resolve its usual fake-worker URL.
  // Supplying the worker handler directly keeps parsing local and avoids a worker fetch.
  (globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler };
  }).pdfjsWorker = { WorkerMessageHandler };

  const loadingTask = getDocument({
    data: bytes.slice(),
    verbosity: 0,
    disableFontFace: true,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  });

  try {
    return await read(await loadingTask.promise);
  } finally {
    await loadingTask.destroy();
  }
}
