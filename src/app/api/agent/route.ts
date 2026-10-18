import { NextResponse } from "next/server";
import { z } from "zod";

import { getAgentSnapshot } from "@/lib/agent/context";
import { runAgent } from "@/lib/agent/router";
import { updateAgentSession } from "@/lib/agent/sessions";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.object({
  query: z.string().trim().min(1).max(1000),
});

const sessionUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("complete_step"),
    sessionId: z.string().min(1).max(100),
    stepId: z.string().min(1).max(80),
  }),
  z.object({
    action: z.literal("dismiss_session"),
    sessionId: z.string().min(1).max(100),
  }),
]);

export async function GET() {
  return NextResponse.json(getAgentSnapshot());
}

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "请告诉 Margin 你想完成什么。" }, { status: 400 });
  }
  try {
    const snapshot = getAgentSnapshot();
    return NextResponse.json(await runAgent(parsed.data.query, snapshot, request.signal));
  } catch (error) {
    return NextResponse.json({
      error: "Margin 暂时没有完成这个请求。请保留原问题后重试。",
      details: error instanceof Error ? error.message : "Agent run failed",
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const parsed = sessionUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Session 更新信息不完整。" }, { status: 400 });
  }
  const session = updateAgentSession(parsed.data);
  if (!session) return NextResponse.json({ error: "没有找到这个阅读 Session。" }, { status: 404 });
  return NextResponse.json(session);
}
