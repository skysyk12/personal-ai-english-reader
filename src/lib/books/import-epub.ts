import "server-only";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import path from "node:path";

type EpubMetadata = {
  title: string;
  author: string;
  cover?: { bytes: Uint8Array; extension: string };
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
});

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return textValue(value[0]);
  if (value && typeof value === "object" && "text" in value) {
    return textValue((value as { text?: unknown }).text);
  }
  return undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function safeZipPath(base: string, relative: string): string {
  const decoded = decodeURIComponent(relative);
  const resolved = path.posix.normalize(path.posix.join(base, decoded));
  if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new Error("EPUB contains an unsafe file path.");
  }
  return resolved;
}

export async function readEpubMetadata(
  bytes: Uint8Array,
  fallbackTitle: string,
): Promise<EpubMetadata> {
  const zip = await JSZip.loadAsync(bytes);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("EPUB is missing META-INF/container.xml.");

  const container = xml.parse(await containerFile.async("string")) as {
    container?: { rootfiles?: { rootfile?: { "full-path"?: string } | Array<{ "full-path"?: string }> } };
  };
  const rootfile = asArray(container.container?.rootfiles?.rootfile)[0];
  const opfPath = rootfile?.["full-path"];
  if (!opfPath) throw new Error("EPUB package document could not be located.");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("EPUB package document is missing.");
  const opf = xml.parse(await opfFile.async("string")) as {
    package?: {
      metadata?: Record<string, unknown>;
      manifest?: { item?: ManifestItem | ManifestItem[] };
    };
  };

  const metadata = opf.package?.metadata ?? {};
  const title = textValue(metadata["dc:title"]) || fallbackTitle;
  const author = textValue(metadata["dc:creator"]) || "Unknown author";
  const items = asArray(opf.package?.manifest?.item);

  const metaTags = asArray(metadata.meta as MetaTag | MetaTag[] | undefined);
  const legacyCoverId = metaTags.find((item) => item.name === "cover")?.content;
  const coverItem =
    items.find((item) => item.properties?.split(/\s+/).includes("cover-image")) ??
    items.find((item) => legacyCoverId && item.id === legacyCoverId);

  if (!coverItem?.href) return { title, author };

  const coverZipPath = safeZipPath(path.posix.dirname(opfPath), coverItem.href);
  const coverFile = zip.file(coverZipPath);
  if (!coverFile) return { title, author };

  const extensionFromMime = coverItem["media-type"]?.split("/")[1];
  const extension =
    extensionFromMime === "jpeg"
      ? "jpg"
      : extensionFromMime || path.extname(coverItem.href).slice(1) || "jpg";

  return {
    title,
    author,
    cover: {
      bytes: await coverFile.async("uint8array"),
      extension,
    },
  };
}

type ManifestItem = {
  id?: string;
  href?: string;
  properties?: string;
  "media-type"?: string;
};

type MetaTag = {
  name?: string;
  content?: string;
};
