import { asc } from "drizzle-orm";
import { notFound } from "next/navigation";

import { ReaderWorkspace } from "@/components/reader/ReaderWorkspace";
import { db, sqlite } from "@/db";
import { learningRoles } from "@/db/schema";
import { deserializeRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ cfi?: string; page?: string }>;
}) {
  const { bookId } = await params;
  const { cfi: requestedCfi, page: requestedPage } = await searchParams;
  const book = sqlite
    .prepare(`
      SELECT
        b.id, b.title, b.author, b.format,
        b.total_locations AS totalLocations,
        b.pdf_default_mode AS pdfDefaultMode,
        p.epub_cfi AS epubCfi,
        p.pdf_page AS pdfPage,
        COALESCE(p.percentage, 0) AS percentage,
        COALESCE(p.role_id, b.default_role_id) AS roleId
      FROM books b
      LEFT JOIN reading_progress p ON p.book_id = b.id
      WHERE b.id = ?
    `)
    .get(bookId) as
    | {
        id: string;
        title: string;
        author: string;
        format: "epub" | "pdf";
        totalLocations: number | null;
        pdfDefaultMode: "reflow" | "original" | null;
        epubCfi: string | null;
        pdfPage: number | null;
        percentage: number;
        roleId: string | null;
      }
    | undefined;
  if (!book) notFound();

  const roleRows = await db.select().from(learningRoles).orderBy(asc(learningRoles.createdAt));
  const roles = roleRows.map(deserializeRole);
  const fallbackRole = roles.find((role) => role.isDefault) ?? roles[0];
  const initialRoleId = roles.some((role) => role.id === book.roleId) ? book.roleId : fallbackRole?.id;
  if (!initialRoleId) throw new Error("No learning role is available.");
  const requestedPageNumber = Number.parseInt(requestedPage || "", 10);
  const initialPdfPage = Number.isFinite(requestedPageNumber)
    ? Math.max(1, Math.min(book.totalLocations || requestedPageNumber, requestedPageNumber))
    : book.pdfPage;

  return (
    <ReaderWorkspace
      book={{
        ...book,
        epubCfi: requestedCfi || book.epubCfi,
        pdfPage: initialPdfPage,
        roleId: initialRoleId,
      }}
      roles={roles}
    />
  );
}
