import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const goalsSchema = z.object({
  goals: z.array(z.object({
    metric: z.enum(["reading_minutes", "review_count", "new_words"]),
    targetValue: z.number().int().min(1).max(100_000),
  })).length(3),
});

export async function GET() {
  const goals = sqlite.prepare(`
    SELECT id, metric, target_value, period, is_active, created_at, updated_at
    FROM learning_goals ORDER BY rowid
  `).all();
  return NextResponse.json({ goals });
}

export async function PUT(request: Request) {
  const parsed = goalsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "学习目标无效。", details: parsed.error.flatten() }, { status: 400 });
  }
  const metrics = new Set(parsed.data.goals.map((goal) => goal.metric));
  if (metrics.size !== 3) {
    return NextResponse.json({ error: "每类学习目标只能设置一次。" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const update = sqlite.prepare(`
    UPDATE learning_goals SET target_value = ?, updated_at = ? WHERE metric = ?
  `);
  sqlite.transaction(() => {
    for (const goal of parsed.data.goals) update.run(goal.targetValue, now, goal.metric);
  })();
  return NextResponse.json({ ok: true });
}
