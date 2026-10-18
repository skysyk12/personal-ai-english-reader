import "server-only";

import { sqlite } from "@/db";
import type { AgentSession, AgentSessionStep } from "./types";

type SessionRow = {
  id: string;
  query: string;
  title: string;
  book_id: string | null;
  total_minutes: number;
  current_step: number;
  status: AgentSession["status"];
  steps_json: string;
  created_at: string;
  updated_at: string;
};

export function getActiveAgentSession(): AgentSession | null {
  const row = sqlite.prepare(`
    SELECT * FROM agent_sessions
    WHERE status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get() as SessionRow | undefined;
  return row ? deserializeSession(row) : null;
}

export function createAgentSession(input: {
  query: string;
  title: string;
  bookId: string | null;
  totalMinutes: number;
  steps: Array<Omit<AgentSessionStep, "status">>;
}): AgentSession {
  const now = new Date().toISOString();
  const id = `agent_session_${crypto.randomUUID()}`;
  const steps: AgentSessionStep[] = input.steps.map((step, index) => ({
    ...step,
    status: index === 0 ? "current" : "pending",
  }));
  const session: AgentSession = {
    id,
    query: input.query,
    title: input.title,
    bookId: input.bookId,
    totalMinutes: input.totalMinutes,
    currentStep: 0,
    status: "active",
    steps,
    createdAt: now,
    updatedAt: now,
  };

  sqlite.transaction(() => {
    sqlite.prepare("UPDATE agent_sessions SET status = 'dismissed', updated_at = ? WHERE status = 'active'").run(now);
    sqlite.prepare(`
      INSERT INTO agent_sessions (
        id, query, title, book_id, total_minutes, current_step,
        status, steps_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
    `).run(id, input.query, input.title, input.bookId, input.totalMinutes, JSON.stringify(steps), now, now);
  })();

  return session;
}

export function updateAgentSession(input: {
  sessionId: string;
  action: "complete_step" | "dismiss_session";
  stepId?: string;
}): AgentSession | null {
  const row = sqlite.prepare("SELECT * FROM agent_sessions WHERE id = ? LIMIT 1").get(input.sessionId) as SessionRow | undefined;
  if (!row) return null;
  const current = deserializeSession(row);
  const now = new Date().toISOString();

  if (input.action === "dismiss_session") {
    sqlite.prepare("UPDATE agent_sessions SET status = 'dismissed', updated_at = ? WHERE id = ?").run(now, current.id);
    return { ...current, status: "dismissed", updatedAt: now };
  }

  if (!input.stepId || current.status !== "active") return current;
  const selectedIndex = current.steps.findIndex((step) => step.id === input.stepId);
  if (selectedIndex < 0 || selectedIndex !== current.currentStep) return current;

  const nextSteps = current.steps.map((step, index) => ({
    ...step,
    status: index === selectedIndex ? "complete" as const : step.status,
  }));
  const nextIndex = nextSteps.findIndex((step) => step.status !== "complete");
  const completed = nextIndex < 0;
  const normalizedSteps = nextSteps.map((step, index) => ({
    ...step,
    status: step.status === "complete" ? "complete" as const : index === nextIndex ? "current" as const : "pending" as const,
  }));
  const next: AgentSession = {
    ...current,
    steps: normalizedSteps,
    currentStep: completed ? normalizedSteps.length : nextIndex,
    status: completed ? "completed" : "active",
    updatedAt: now,
  };
  sqlite.prepare(`
    UPDATE agent_sessions
    SET current_step = ?, status = ?, steps_json = ?, updated_at = ?
    WHERE id = ?
  `).run(next.currentStep, next.status, JSON.stringify(next.steps), now, next.id);
  return next;
}

function deserializeSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    query: row.query,
    title: row.title,
    bookId: row.book_id,
    totalMinutes: row.total_minutes,
    currentStep: row.current_step,
    status: row.status,
    steps: parseSteps(row.steps_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseSteps(value: string): AgentSessionStep[] {
  try {
    const parsed = JSON.parse(value) as AgentSessionStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
