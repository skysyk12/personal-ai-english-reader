declare module "pdfjs-dist/webpack.mjs" {
  export * from "pdfjs-dist";
}

declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: {
    setup: (...args: unknown[]) => void;
  };
}
