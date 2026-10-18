import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, sqlite } from "@/db";
import { learningRoles } from "@/db/schema";
import { deserializeRole } from "@/lib/types";
import { roleInput } from "@/lib/role-schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ roleId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { roleId } = await params;
  const parsed = roleInput.partial().safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "角色信息无效。" }, { status: 400 });
  }

  const current = sqlite
    .prepare("SELECT * FROM learning_roles WHERE id = ?")
    .get(roleId) as Record<string, unknown> | undefined;
  if (!current) return NextResponse.json({ error: "没有找到该角色。" }, { status: 404 });

  const value = parsed.data;
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    if (value.isDefault) sqlite.prepare("UPDATE learning_roles SET is_default = 0").run();
    sqlite
      .prepare(`
        UPDATE learning_roles SET
          name = ?, description = ?, current_level = ?, goal = ?,
          focus_areas_json = ?, answer_language = ?, explanation_depth = ?,
          tone = ?, feature_flags_json = ?, custom_instructions = ?,
          is_default = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        value.name ?? current.name,
        value.description ?? current.description,
        value.currentLevel ?? current.current_level,
        value.goal ?? current.goal,
        value.focusAreas ? JSON.stringify(value.focusAreas) : current.focus_areas_json,
        value.answerLanguage ?? current.answer_language,
        value.explanationDepth ?? current.explanation_depth,
        value.tone ?? current.tone,
        value.featureFlags ? JSON.stringify(value.featureFlags) : current.feature_flags_json,
        value.customInstructions ?? current.custom_instructions,
        value.isDefault === undefined ? current.is_default : value.isDefault ? 1 : 0,
        now,
        roleId,
      );
  })();

  const [updated] = await db
    .select()
    .from(learningRoles)
    .where(eq(learningRoles.id, roleId));
  return NextResponse.json(deserializeRole(updated));
}

export async function DELETE(_: Request, { params }: Params) {
  const { roleId } = await params;
  const roles = sqlite
    .prepare("SELECT id, is_default FROM learning_roles ORDER BY created_at")
    .all() as Array<{ id: string; is_default: number }>;
  if (roles.length <= 1) {
    return NextResponse.json({ error: "至少保留一个学习角色。" }, { status: 409 });
  }
  const deleting = roles.find((role) => role.id === roleId);
  if (!deleting) return NextResponse.json({ error: "没有找到该角色。" }, { status: 404 });

  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM learning_roles WHERE id = ?").run(roleId);
    if (deleting.is_default) {
      const replacement = roles.find((role) => role.id !== roleId);
      sqlite.prepare("UPDATE learning_roles SET is_default = 1 WHERE id = ?").run(replacement?.id);
    }
  })();
  return NextResponse.json({ ok: true });
}
