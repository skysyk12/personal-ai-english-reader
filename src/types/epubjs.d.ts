declare module "epubjs" {
  export type NavItem = { id?: string; href: string; label: string; subitems?: NavItem[] };
  export type Contents = { window: Window; document: Document };
  export type Location = { start: { cfi: string; href?: string; percentage?: number }; end?: { cfi?: string; percentage?: number } };

  export interface Rendition {
    display(target?: string): Promise<void>;
    flow(flow: "scrolled" | "paginated"): void;
    prev(): Promise<void>;
    next(): Promise<void>;
    destroy(): void;
    on(event: "selected", callback: (cfiRange: string, contents: Contents) => void): void;
    on(event: "relocated", callback: (location: Location) => void): void;
    themes: {
      register(name: string, rules: Record<string, Record<string, string>>): void;
      select(name: string): void;
      fontSize(size: string): void;
    };
    hooks: {
      content: {
        register(callback: (contents: Contents) => void): void;
      };
    };
    annotations: {
      highlight(
        cfiRange: string,
        data?: Record<string, unknown>,
        callback?: (() => void) | undefined,
        className?: string,
        styles?: Record<string, string>,
      ): void;
    };
  }

  export interface Book {
    ready: Promise<void>;
    loaded: { navigation: Promise<{ toc: NavItem[] }> };
    locations: {
      generate(chars?: number): Promise<string[]>;
      percentageFromCfi(cfi: string): number;
    };
    renderTo(element: Element, options: Record<string, unknown>): Rendition;
    destroy(): void;
  }

  export default function ePub(input: string | ArrayBuffer): Book;
}
