import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, sqlite } from "@/db";
import { learningRoles } from "@/db/schema";
import {
  buildReadingUserPrompt,
  buildRolePrompt,
  defaultQuestion,
  type ReadingContext,
} from "@/lib/ai/build-prompt";
import type { AiAction } from "@/lib/types";
import { deserializeRole } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const chatInput = z.object({
  bookId: z.string().min(1),
  roleId: z.string().min(1),
  action: z.enum(["explain", "translate", "grammar", "custom"]),
  selectedText: z.string().trim().min(1).max(2000),
  anchor: z.discriminatedUnion("type", [
    z.object({ type: z.literal("epub"), cfiRange: z.string().min(1).max(4000) }),
    z.object({
      type: z.literal("pdf"),
      page: z.number().int().min(1),
      textQuote: z.string().trim().min(1).max(2000),
    }),
  ]),
  context: z.object({
    current: z.string().max(4000),
    previous: z.string().max(800),
    next: z.string().max(800),
  }),
  question: z.string().trim().max(2000).optional(),
  conversationId: z.string().optional(),
});

type StoredConversation = {
  id: string;
  book_id: string;
  role_id: string;
  action: AiAction;
  selected_text: string;
  context_snapshot: string;
  anchor_json: string;
};

type StoredMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const parsed = chatInput.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "AI 请求内容无效。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "尚未配置 DeepSeek API Key。请在 .env.local 中填写后重新启动。", code: "MISSING_KEY" },
      { status: 503 },
    );
  }

  const input = parsed.data;
  const book = sqlite
    .prepare("SELECT id, title, author FROM books WHERE id = ?")
    .get(input.bookId) as { id: string; title: string; author: string } | undefined;
  if (!book) return NextResponse.json({ error: "没有找到当前书籍。" }, { status: 404 });

  let conversation = input.conversationId
    ? (sqlite
        .prepare("SELECT * FROM ai_conversations WHERE id = ? AND book_id = ?")
        .get(input.conversationId, input.bookId) as StoredConversation | undefined)
    : undefined;

  const roleId = conversation?.role_id ?? input.roleId;
  const [roleRow] = await db
    .select()
    .from(learningRoles)
    .where(eq(learningRoles.id, roleId))
    .limit(1);
  if (!roleRow) return NextResponse.json({ error: "没有找到当前学习角色。" }, { status: 404 });
  const role = deserializeRole(roleRow);
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const now = new Date().toISOString();

  const incomingContext: ReadingContext = {
    bookTitle: book.title,
    author: book.author,
    previous: input.context.previous,
    current: input.context.current,
    next: input.context.next,
    selectedText: input.selectedText,
  };

  if (!conversation) {
    conversation = {
      id: `conversation_${crypto.randomUUID()}`,
      book_id: input.bookId,
      role_id: input.roleId,
      action: input.action,
      selected_text: input.selectedText,
      context_snapshot: JSON.stringify(incomingContext),
      anchor_json: JSON.stringify(input.anchor),
    };
    sqlite
      .prepare(`
        INSERT INTO ai_conversations (
          id, book_id, role_id, action, selected_text, context_snapshot,
          anchor_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        conversation.id,
        conversation.book_id,
        conversation.role_id,
        conversation.action,
        conversation.selected_text,
        conversation.context_snapshot,
        conversation.anchor_json,
        now,
        now,
      );
  }

  const storedContext = JSON.parse(conversation.context_snapshot) as ReadingContext;
  const previousMessages = sqlite
    .prepare(`
      SELECT role, content FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 8
    `)
    .all(conversation.id)
    .reverse() as StoredMessage[];

  const visibleQuestion = input.question || defaultQuestion(input.action);
  sqlite
    .prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, model, created_at)
      VALUES (?, ?, 'user', ?, ?, ?)
    `)
    .run(`message_${crypto.randomUUID()}`, conversation.id, visibleQuestion, model, now);

  const firstUserPrompt = buildReadingUserPrompt(
    conversation.action,
    storedContext,
    previousMessages[0]?.role === "user" ? previousMessages[0].content : visibleQuestion,
  );
  const history = previousMessages.length
    ? [
        { role: "user" as const, content: firstUserPrompt },
        ...previousMessages.slice(1),
        { role: "user" as const, content: visibleQuestion },
      ]
    : [{ role: "user" as const, content: firstUserPrompt }];

  let upstream: Response;
  try {
    upstream = await fetch(
      `${(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: buildRolePrompt(role) }, ...history],
          stream: true,
          stream_options: { include_usage: true },
          thinking: { type: "disabled" },
          temperature: 0.35,
          max_tokens: 2200,
        }),
        signal: request.signal,
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "无法连接 DeepSeek。请检查网络后重试。",
        details: error instanceof Error ? error.message : "Upstream connection failed",
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text();
    return NextResponse.json(
      {
        error: humanizeDeepSeekError(upstream.status),
        details: details.slice(0, 1000),
      },
      { status: upstream.status || 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let fullAnswer = "";
  let buffer = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const event = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string | null } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              if (event.usage) usage = event.usage;
              const delta = event.choices?.[0]?.delta?.content;
              if (delta) {
                fullAnswer += delta;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // Ignore malformed or keep-alive SSE frames without breaking the answer.
            }
          }
        }
        if (fullAnswer.trim()) {
          const completedAt = new Date().toISOString();
          sqlite
            .prepare(`
              INSERT INTO ai_messages (
                id, conversation_id, role, content, model,
                input_tokens, output_tokens, created_at
              ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
            `)
            .run(
              `message_${crypto.randomUUID()}`,
              conversation!.id,
              fullAnswer,
              model,
              usage?.prompt_tokens ?? null,
              usage?.completion_tokens ?? null,
              completedAt,
            );
          sqlite
            .prepare("UPDATE ai_conversations SET updated_at = ? WHERE id = ?")
            .run(completedAt, conversation!.id);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Conversation-Id": conversation.id,
      "X-Model": model,
    },
  });
}

function humanizeDeepSeekError(status: number): string {
  if (status === 401) return "DeepSeek API Key 无效。";
  if (status === 402) return "DeepSeek 账户余额不足。";
  if (status === 429) return "DeepSeek 请求过于频繁，请稍后重试。";
  if (status >= 500) return "DeepSeek 服务暂时不可用。";
  return "DeepSeek 请求失败。";
}
