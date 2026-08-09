import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, sqlite } from "@/db";
import { learningRoles } from "@/db/schema";
import { deserializeRole } from "@/lib/types";

export const runtime = "nodejs";

const roleInput = z.object({
  name: z.string().trim().min(1).max(48),
  description: z.string().trim().max(240).default(""),
  currentLevel: z.string().trim().min(1).max(48),
  goal: z.string().trim().min(1).max(500),
  focusAreas: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  answerLanguage: z.enum(["zh-CN", "en", "bilingual"]),
  explanationDepth: z.enum(["brief", "standard", "detailed"]),
  tone: z.enum(["direct", "teacher", "concise"]),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  customInstructions: z.string().trim().max(2000).default(""),
  isDefault: z.boolean().default(false),
});

export async function GET() {
  const rows = await db
    .select()
    .from(learningRoles)
    .orderBy(asc(learningRoles.createdAt));
  return NextResponse.json(rows.map(deserializeRole));
}

export async function POST(request: Request) {
  const parsed = roleInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "角色信息不完整。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const id = `role_${crypto.randomUUID()}`;
  const value = parsed.data;

  sqlite.transaction(() => {
    if (value.isDefault) sqlite.prepare("UPDATE learning_roles SET is_default = 0").run();
    sqlite
      .prepare(`
        INSERT INTO learning_roles (
          id, name, description, current_level, goal, focus_areas_json,
          answer_language, explanation_depth, tone, feature_flags_json,
          custom_instructions, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        value.name,
        value.description,
        value.currentLevel,
        value.goal,
        JSON.stringify(value.focusAreas),
        value.answerLanguage,
        value.explanationDepth,
        value.tone,
        JSON.stringify(value.featureFlags),
        value.customInstructions,
        value.isDefault ? 1 : 0,
        now,
        now,
      );
  })();

  const [created] = await db
    .select()
    .from(learningRoles)
    .where(eq(learningRoles.id, id));
  return NextResponse.json(deserializeRole(created), { status: 201 });
}

export { roleInput };
