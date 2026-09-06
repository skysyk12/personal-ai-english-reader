import { NextResponse } from "next/server";
import { z } from "zod";

import { sqlite } from "@/db";

export const runtime = "nodejs";

const reviewSchema = z.object({
  vocabularyId: z.string().min(1),
  rating: z.enum(["again", "hard", "good", "easy"]),
});

export async function POST(request: Request) {
  const parsed = reviewSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "复习评分无效。" }, { status: 400 });
  const word = sqlite.prepare(`
    SELECT id, ease_factor, interval_days, repetitions
    FROM vocabulary WHERE id = ?
  `).get(parsed.data.vocabularyId) as {
    id: string; ease_factor: number; interval_days: number; repetitions: number;
  } | undefined;
  if (!word) return NextResponse.json({ error: "没有找到该生词。" }, { status: 404 });

  const schedule = nextSchedule(word, parsed.data.rating);
  const reviewedAt = new Date();
  const dueAt = new Date(reviewedAt);
  dueAt.setTime(dueAt.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000);
  const status = schedule.repetitions >= 5 && schedule.intervalDays >= 30 ? "mastered" : "learning";

  sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE vocabulary SET
        status = ?, ease_factor = ?, interval_days = ?, repetitions = ?,
        due_at = ?, last_reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      schedule.easeFactor,
      schedule.intervalDays,
      schedule.repetitions,
      dueAt.toISOString(),
      reviewedAt.toISOString(),
      reviewedAt.toISOString(),
      word.id,
    );
    sqlite.prepare(`
      INSERT INTO vocabulary_reviews (
        id, vocabulary_id, rating, previous_interval, next_interval, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `review_${crypto.randomUUID()}`,
      word.id,
      parsed.data.rating,
      word.interval_days,
      schedule.intervalDays,
      reviewedAt.toISOString(),
    );
  })();
  return NextResponse.json({
    ok: true,
    dueAt: dueAt.toISOString(),
    intervalDays: schedule.intervalDays,
    status,
  });
}

function nextSchedule(
  word: { ease_factor: number; interval_days: number; repetitions: number },
  rating: "again" | "hard" | "good" | "easy",
) {
  if (rating === "again") {
    return { intervalDays: 0.007, repetitions: 0, easeFactor: Math.max(1.3, word.ease_factor - 0.2) };
  }
  if (rating === "hard") {
    return {
      intervalDays: Math.max(1, Math.round(Math.max(1, word.interval_days) * 1.2)),
      repetitions: word.repetitions + 1,
      easeFactor: Math.max(1.3, word.ease_factor - 0.15),
    };
  }
  if (rating === "easy") {
    return {
      intervalDays: word.repetitions === 0
        ? 4
        : Math.max(4, Math.round(Math.max(1, word.interval_days) * word.ease_factor * 1.3)),
      repetitions: word.repetitions + 1,
      easeFactor: Math.min(3.2, word.ease_factor + 0.15),
    };
  }
  return {
    intervalDays: word.repetitions === 0 ? 1
      : word.repetitions === 1 ? 3
        : Math.max(3, Math.round(Math.max(1, word.interval_days) * word.ease_factor)),
    repetitions: word.repetitions + 1,
    easeFactor: word.ease_factor,
  };
}
