"use client";

import { BookmarkPlus, Copy, CornerDownLeft, RefreshCcw, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AiAction, LearningRole, ReaderSelection } from "@/lib/types";

type Message = { id: string; role: "user" | "assistant"; content: string };

type Props = {
  book: { id: string; title: string; author: string };
  selection: ReaderSelection | null;
  action: AiAction | null;
  role: LearningRole;
  onClose: () => void;
};

const ACTION_LABELS: Record<AiAction, string> = {
  explain: "解释",
  translate: "翻译",
  grammar: "句子分析",
  custom: "自由提问",
};

export function AiPanel({ book, selection, action, role, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastAutoRequest = useRef("");
  const resolvedAction: AiAction = action ?? "custom";

  useEffect(() => {
    if (!selection || resolvedAction === "custom") return;
    const key = `${selection.sourceKey}:${resolvedAction}:${role.id}`;
    if (lastAutoRequest.current === key) return;
    lastAutoRequest.current = key;
    void send(resolvedAction === "explain" ? "这里是什么意思？" : resolvedAction === "translate" ? "请自然翻译这段内容。" : "请分析这句话的结构。", false);
  // send intentionally starts only when the selected action identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedAction, role.id, selection?.sourceKey]);

  async function send(question: string, continuation = true) {
    if (!selection || !question.trim() || streaming) return;
    setError("");
    setSaved(false);
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: question.trim() };
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          bookId: book.id,
          roleId: role.id,
          action: resolvedAction,
          selectedText: selection.selectedText,
          anchor: selection.anchor,
          context: { current: selection.current, previous: selection.previous, next: selection.next },
          question: question.trim(),
          conversationId: continuation && conversationId ? conversationId : undefined,
        }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "AI 请求失败。");
      }
      setConversationId(response.headers.get("X-Conversation-Id"));
      const reader = response.body?.getReader();
      if (!reader) throw new Error("AI 没有返回可读内容。");
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + chunk } : message));
      }
    } catch (sendError) {
      if ((sendError as Error).name !== "AbortError") {
        setError(sendError instanceof Error ? sendError.message : "AI 请求失败。");
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function saveAnswer() {
    if (!selection) return;
    const answer = [...messages].reverse().find((message) => message.role === "assistant" && message.content)?.content;
    if (!answer) return;
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: book.id,
        conversationId,
        noteType: "ai-answer",
        title: `${ACTION_LABELS[resolvedAction]} · ${selection.selectedText.slice(0, 48)}`,
        selectedText: selection.selectedText,
        contentMarkdown: answer,
        anchor: selection.anchor,
        roleId: role.id,
      }),
    });
    if (response.ok) setSaved(true);
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.content);

  return (
    <aside className="ai-panel" aria-label="AI 英语导师">
      <header className="ai-panel-header">
        <div><span>AI tutor</span><strong>{role.name}</strong></div>
        <button className="icon-button" aria-label="关闭 AI 面板" onClick={onClose}><X size={17} /></button>
      </header>
      {selection ? (
        <div className="selection-context">
          <small>当前选区 · {ACTION_LABELS[resolvedAction]}</small>
          <blockquote>{selection.selectedText}</blockquote>
        </div>
      ) : (
        <div className="ai-empty"><strong>选择英文后开始提问</strong><span>在正文中拖选单词、句子或短段落，然后使用解释、翻译、句子分析或自由提问。</span></div>
      )}
      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <small>{message.role === "user" ? "You" : role.name}</small>
            {message.role === "assistant" ? (
              message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <div className="typing"><i /><i /><i /></div>
            ) : <p>{message.content}</p>}
          </article>
        ))}
        {error ? <div className="ai-error" role="alert"><strong>没有生成回答</strong><span>{error}</span><button onClick={() => { const lastQuestion = [...messages].reverse().find((message) => message.role === "user")?.content; if (lastQuestion) void send(lastQuestion, false); }}><RefreshCcw size={14} /> 保留问题并重试</button></div> : null}
      </div>
      {lastAssistant ? (
        <div className="answer-actions">
          <button onClick={() => void saveAnswer()}><BookmarkPlus size={15} /> {saved ? "已保存" : "保存为笔记"}</button>
          <button onClick={() => void navigator.clipboard.writeText(lastAssistant.content)}><Copy size={15} /> 复制</button>
        </div>
      ) : null}
      <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
        <textarea name="ai-question" autoComplete="off" aria-label="继续询问当前选区" value={input} onChange={(event) => setInput(event.target.value)} placeholder={selection ? "继续询问这个选区…" : "请先在正文中选择内容"} disabled={!selection || streaming} rows={3} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(input); } }} />
        <div><span><CornerDownLeft size={13} /> ⌘ Enter 发送</span>{streaming ? <button type="button" aria-label="停止生成" onClick={() => abortRef.current?.abort()}><Square size={15} /> 停止</button> : <button type="submit" aria-label="发送问题" disabled={!selection || !input.trim()}><Send size={15} /> 发送</button>}</div>
      </form>
    </aside>
  );
}
