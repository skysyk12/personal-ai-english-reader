import { NextResponse } from "next/server";

import { sqlite } from "@/db";

export const runtime = "nodejs";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const { roleId } = await params;
  const exists = sqlite
    .prepare("SELECT id FROM learning_roles WHERE id = ?")
    .get(roleId);
  if (!exists) return NextResponse.json({ error: "没有找到该角色。" }, { status: 404 });

  sqlite.transaction(() => {
    sqlite.prepare("UPDATE learning_roles SET is_default = 0").run();
    sqlite.prepare("UPDATE learning_roles SET is_default = 1 WHERE id = ?").run(roleId);
  })();
  return NextResponse.json({ ok: true });
}
