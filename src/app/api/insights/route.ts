import { NextResponse } from "next/server";

import { getLearningInsights } from "@/lib/learning/insights";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("week") || 0);
  const weekOffset = Number.isFinite(value) ? value : 0;
  return NextResponse.json(getLearningInsights(weekOffset));
}
