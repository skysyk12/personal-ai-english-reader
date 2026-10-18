"use client";

import {
  ArrowUp,
  BookMarked,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  Clock3,
  FileSearch,
  LoaderCircle,
  NotebookPen,
  Route,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AgentRunResult, AgentSession, AgentSnapshot, AgentToolName } from "@/lib/agent/types";

const INITIAL_SUGGESTIONS = [
  "继续上次的阅读",
  "给我安排一个 30 分钟的学习 Session",
  "我最近的阅读有什么问题？",
];

export function AgentHome({ initialSnapshot }: { initialSnapshot: AgentSnapshot }) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [snapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<AgentRunResult[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(initialSnapshot.activeSession);
  const [sessionBusy, setSessionBusy] = useState("");

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(nextQuery = query) {
    const value = nextQuery.trim();
    if (!value || running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setQuery(value);
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
        signal: controller.signal,
      });
      const payload = await response.json() as AgentRunResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Margin 没有完成这个请求。");
      setResult(payload);
      setHistory((current) => [payload, ...current.filter((item) => item.id !== payload.id)].slice(0, 3));
      if (payload.session) setActiveSession(payload.session);
      if (payload.autoNavigate && payload.href) {
        window.setTimeout(() => router.push(payload.href!), 120);
      }
    } catch (runError) {
      if ((runError as Error).name !== "AbortError") {
        setError(runError instanceof Error ? runError.message : "Margin 没有完成这个请求。");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function updateSession(action: "complete_step" | "dismiss_session", stepId?: string) {
    if (!activeSession || sessionBusy) return;
    setSessionBusy(stepId || action);
    setError("");
    try {
      const response = await fetch("/api/agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId: activeSession.id, stepId }),
      });
      const payload = await response.json() as AgentSession & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Session 没有更新成功。");
      setActiveSession(payload.status === "dismissed" ? null : payload);
      setResult((current) => current?.session?.id === payload.id ? { ...current, session: payload } : current);
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Session 没有更新成功。");
    } finally {
      setSessionBusy("");
    }
  }

  const suggestions = result?.suggestions?.length ? result.suggestions : INITIAL_SUGGESTIONS;
  const activeBook = snapshot.activeBook;
  const greeting = timeGreeting();

  return (
    <div className="agent-home">
      <header className="agent-home-header">
        <div>
          <span className="agent-kicker">Margin Router</span>
          <h1>{greeting}，你想从哪里继续？</h1>
        </div>
        <span className="harness-state">
          <i aria-hidden="true" />
          {snapshot.aiConfigured ? "AI 就绪" : "本地模式"}
        </span>
      </header>

      <div className="agent-home-grid">
        <section className="agent-primary" aria-label="AI 阅读路由器">
          <form className="router-composer" onSubmit={(event) => { event.preventDefault(); void run(); }}>
            <label htmlFor="router-query">告诉 Margin 你现在想完成什么</label>
            <div className="router-input-wrap">
              <Sparkles size={20} aria-hidden="true" />
              <textarea
                ref={inputRef}
                id="router-query"
                name="router-query"
                autoComplete="off"
                rows={2}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void run();
                  }
                }}
                placeholder="例如：继续读经济学人，并帮我安排 30 分钟…"
              />
              <button type="submit" aria-label="让 Margin 执行" disabled={!query.trim() || running}>
                {running ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={17} />}
              </button>
            </div>
            <footer>
              <span>{snapshot.role ? `${snapshot.role.name} · ${snapshot.role.currentLevel}` : "默认学习环境"}</span>
              <span><kbd>Enter</kbd> 执行 <kbd>Shift Enter</kbd> 换行</span>
            </footer>
          </form>

          <div className="router-suggestions" role="group" aria-label="快捷请求">
            {suggestions.slice(0, 3).map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => void run(suggestion)}>
                {suggestion}<ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="agent-response" aria-live="polite">
            {running ? <AgentThinking /> : error ? (
              <div className="agent-error" role="alert">
                <strong>请求没有完成</strong>
                <p>{error}</p>
                <button type="button" onClick={() => void run()}>保留问题并重试</button>
              </div>
            ) : result ? <AgentResultCard result={result} /> : (
              <div className="router-empty">
                <Route size={20} aria-hidden="true" />
                <div><strong>不用先找功能</strong><span>描述目标，Margin 会选择工具、读取上下文并打开正确的界面。</span></div>
              </div>
            )}
          </div>
        </section>

        <aside className="agent-context-rail" aria-label="当前阅读上下文">
          <section className="now-panel">
            <header><span>Now</span><small>{activeBook ? `${activeBook.progress}%` : "等待导入"}</small></header>
            {activeBook ? (
              <>
                <div className="now-book">
                  <span className="now-book-cover" aria-hidden="true"><i />{activeBook.format.toUpperCase()}</span>
                  <div><strong>{activeBook.title}</strong><span>{activeBook.author}</span></div>
                </div>
                <div className="now-progress" role="progressbar" aria-label={`${activeBook.title} 阅读进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={activeBook.progress}><i style={{ width: `${activeBook.progress}%` }} /></div>
                <Link href={`/reader/${activeBook.id}`} className="now-action"><BookOpen size={16} />继续阅读<ChevronRight size={15} /></Link>
              </>
            ) : <Link href="/library?import=1" className="now-action"><BookOpen size={16} />导入第一本书<ChevronRight size={15} /></Link>}
          </section>

          {activeSession ? (
            <AgentSessionPanel
              session={activeSession}
              busy={sessionBusy}
              onComplete={(stepId) => void updateSession("complete_step", stepId)}
              onDismiss={() => void updateSession("dismiss_session")}
            />
          ) : null}

          <section className="context-panel">
            <header><span>Context</span><small>实时</small></header>
            <ul>
              <li><BrainCircuit size={15} /><span><strong>{snapshot.signals.dueCount}</strong>到期复习</span></li>
              <li><Clock3 size={15} /><span><strong>{formatDuration(snapshot.signals.secondsToday)}</strong>今日阅读</span></li>
              <li><NotebookPen size={15} /><span><strong>{snapshot.signals.noteCount}</strong>阅读记忆</span></li>
              <li><BookMarked size={15} /><span><strong>{snapshot.signals.vocabularyCount}</strong>语境生词</span></li>
            </ul>
          </section>

          {history.length ? (
            <section className="agent-history-panel">
              <header><span>This session</span><small>{history.length}</small></header>
              {history.map((item) => <button type="button" key={item.id} onClick={() => { setResult(item); setQuery(item.query); }}><Check size={13} /><span>{item.query}</span></button>)}
            </section>
          ) : snapshot.recentNotes.length ? (
            <section className="agent-memory-panel">
              <header><span>Recent memory</span><Link href="/notes">全部</Link></header>
              {snapshot.recentNotes.slice(0, 2).map((note) => <Link href={note.href} key={note.id}><strong>{note.title}</strong><span>{note.bookTitle}</span></Link>)}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function AgentSessionPanel({
  session,
  busy,
  onComplete,
  onDismiss,
}: {
  session: AgentSession;
  busy: string;
  onComplete: (stepId: string) => void;
  onDismiss: () => void;
}) {
  const completed = session.steps.filter((step) => step.status === "complete").length;
  const progress = session.steps.length ? Math.round((completed / session.steps.length) * 100) : 0;
  return (
    <section className="agent-session-panel" aria-label="当前阅读 Session" aria-live="polite">
      <header>
        <span>{session.status === "completed" ? "Session complete" : "Active session"}</span>
        <button type="button" aria-label={session.status === "completed" ? "收起已完成 Session" : "结束当前 Session"} title={session.status === "completed" ? "收起" : "结束 Session"} onClick={onDismiss} disabled={Boolean(busy)}><X size={13} /></button>
      </header>
      <div className="session-title-row">
        <div><strong>{session.title}</strong><small>{completed}/{session.steps.length} 步 · {session.totalMinutes} 分钟</small></div>
        <span>{progress}%</span>
      </div>
      <div className="session-progress" role="progressbar" aria-label="Session 完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
      <ol>
        {session.steps.map((step) => (
          <li className={`is-${step.status}`} key={step.id}>
            <button
              type="button"
              className="session-step-state"
              aria-label={step.status === "complete" ? `${step.title}已完成` : `完成${step.title}`}
              disabled={step.status !== "current" || Boolean(busy)}
              onClick={() => onComplete(step.id)}
            >
              {busy === step.id ? <LoaderCircle className="spin" size={13} /> : step.status === "complete" ? <Check size={13} /> : <Circle size={12} />}
            </button>
            <div><strong>{step.title}</strong><small>{step.meta}</small></div>
            {step.status === "current" && step.href ? <Link href={step.href}>继续<ChevronRight size={12} /></Link> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function AgentThinking() {
  return (
    <div className="agent-thinking" role="status">
      <span><CircleDashed className="spin" size={18} /></span>
      <div><strong>正在组装下一步</strong><small>理解意图 · 读取上下文 · 选择工具</small></div>
    </div>
  );
}

function AgentResultCard({ result }: { result: AgentRunResult }) {
  return (
    <article className="agent-result-card">
      <header>
        <span className="agent-result-icon"><ToolIcon tool={result.tool} /></span>
        <div><small>{result.routedBy === "model" ? "AI routed" : result.routedBy === "fallback" ? "Local fallback" : "Instant route"}</small><h2>{result.title}</h2></div>
      </header>
      <p>{result.summary}</p>
      {result.answerMarkdown ? <div className="agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answerMarkdown}</ReactMarkdown></div> : null}
      {result.items?.length ? (
        <div className="agent-result-items">
          {result.items.map((item) => item.href ? (
            <Link href={item.href} key={item.id}><span><strong>{item.title}</strong><small>{item.meta}</small>{item.snippet ? <p>{item.snippet}</p> : null}</span><ChevronRight size={15} /></Link>
          ) : (
            <div key={item.id}><span><strong>{item.title}</strong><small>{item.meta}</small></span></div>
          ))}
        </div>
      ) : null}
      <footer>
        {result.href && result.primaryAction ? <Link className="agent-primary-action" href={result.href}>{result.primaryAction}<ChevronRight size={15} /></Link> : <span />}
        <details>
          <summary>查看执行过程</summary>
          <ol>{result.trace.map((step) => <li key={step.label}><Check size={13} /><span><strong>{step.label}</strong><small>{step.detail}</small></span></li>)}</ol>
          <small className="agent-runtime">{result.durationMs} ms · {result.tool}</small>
        </details>
      </footer>
    </article>
  );
}

function ToolIcon({ tool }: { tool: AgentToolName }) {
  if (["continue_reading", "open_book", "summarize_current", "extract_vocabulary", "create_review_tasks"].includes(tool)) return <BookOpen size={18} />;
  if (tool === "start_review") return <BrainCircuit size={18} />;
  if (tool === "open_notes") return <NotebookPen size={18} />;
  if (tool === "search_library") return <FileSearch size={18} />;
  return <Sparkles size={18} />;
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function formatDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (!minutes) return "0 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}小时 ${rest}分` : `${hours} 小时`;
}
