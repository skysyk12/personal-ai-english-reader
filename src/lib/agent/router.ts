import "server-only";

import { z } from "zod";

import { sqlite } from "@/db";
import { ensureLibrarySearchIndex } from "@/lib/books/search-index";
import { createAgentSession } from "./sessions";
import type {
  AgentBookContext,
  AgentResultItem,
  AgentRouteDecision,
  AgentRunResult,
  AgentSnapshot,
  AgentToolName,
} from "./types";

const toolNames = [
  "continue_reading",
  "open_library",
  "open_book",
  "start_review",
  "open_vocabulary",
  "open_notes",
  "show_insights",
  "search_library",
  "import_book",
  "manage_roles",
  "open_settings",
  "plan_session",
  "summarize_current",
  "extract_vocabulary",
  "create_review_tasks",
  "reflect_progress",
  "ask_tutor",
] as const satisfies readonly AgentToolName[];

const modelDecisionSchema = z.object({
  tool: z.enum(toolNames),
  bookId: z.string().optional(),
  searchQuery: z.string().max(300).optional(),
  minutes: z.number().int().min(5).max(240).optional(),
  answerMarkdown: z.string().max(8000).optional(),
  reason: z.string().max(160).default("根据当前阅读上下文处理。"),
});

type SearchRow = {
  id: string;
  type: "book" | "content" | "vocabulary" | "note";
  title: string;
  meta: string;
  snippet: string;
  href: string;
};

export async function runAgent(
  query: string,
  snapshot: AgentSnapshot,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const startedAt = Date.now();
  let decision = routeWithRules(query, snapshot);
  if (!decision) decision = await routeWithModel(query, snapshot, signal);

  const result = await executeTool(query, decision, snapshot);
  const completed: AgentRunResult = {
    ...result,
    id: `agent_run_${crypto.randomUUID()}`,
    query,
    tool: decision.tool,
    routedBy: decision.routedBy,
    durationMs: Date.now() - startedAt,
    trace: [
      {
        label: "理解意图",
        detail: decision.routedBy === "model" ? "AI 已选择最合适的应用工具" : "已匹配本地高频意图",
        status: decision.routedBy === "fallback" ? "fallback" : "complete",
      },
      {
        label: "读取环境",
        detail: snapshot.activeBook
          ? `已带入《${snapshot.activeBook.title}》、${snapshot.signals.dueCount} 个到期复习与当前学习角色`
          : "已读取书库、复习与学习角色",
        status: "complete",
      },
      {
        label: "执行工具",
        detail: toolLabel(decision.tool),
        status: "complete",
      },
    ],
  };
  saveRun(completed, decision.reason);
  return completed;
}

function routeWithRules(query: string, snapshot: AgentSnapshot): AgentRouteDecision | null {
  const normalized = normalize(query);
  const selectedBook = matchBook(query, snapshot.books);
  const explicitBookCommand = selectedBook && /(open|read|continue|打开|阅读|继续|看)/i.test(normalized);

  if (/(导入|添加书|import|upload)/i.test(normalized)) return local("import_book", "用户要求导入阅读文件。");
  if (/(设置|api|backup|备份|恢复|settings)/i.test(normalized)) return local("open_settings", "用户要求打开应用设置。");
  if (/(角色|persona|prompt|role)/i.test(normalized)) return local("manage_roles", "用户要求管理学习角色。");
  if (/(我最近|阅读问题|学习问题|进步|表现|情况|复盘)/i.test(normalized)) return local("reflect_progress", "用户想从学习数据中获得反馈。");
  if (/(总结|摘要|summary|summarize)/i.test(normalized)) return local("summarize_current", "用户要求总结阅读上下文。", selectedBook?.id);
  if (/(提取|找出|整理).*(生词|单词|词汇|搭配)/i.test(normalized)) return local("extract_vocabulary", "用户要求从当前内容中提取词汇。", selectedBook?.id);
  if (/(生成|创建|出).*(复习任务|测验|题目|问题)/i.test(normalized)) return local("create_review_tasks", "用户要求基于阅读内容生成复习。", selectedBook?.id);
  if (/(分钟|小时|session|安排|计划|学习一下)/i.test(normalized)) {
    return { ...local("plan_session", "用户需要一个当下可执行的阅读计划。", selectedBook?.id), minutes: parseMinutes(normalized) };
  }
  if (/(开始|复习|到期|review)/i.test(normalized) && !/(笔记|成长|报告)/i.test(normalized)) return local("start_review", "用户要开始到期复习。");
  if (/(笔记|notes?)/i.test(normalized)) return local("open_notes", "用户要查看阅读记忆。");
  if (/(生词本|词汇本|单词本|vocabulary)/i.test(normalized)) return local("open_vocabulary", "用户要打开语境生词。");
  if (/(成长|报告|统计|趋势|insights?)/i.test(normalized)) return local("show_insights", "用户要查看阅读信号。");
  if (/(书库|所有书|全部书|library)/i.test(normalized)) return local("open_library", "用户要管理书库。");
  if (explicitBookCommand && selectedBook) return local("open_book", "用户点名要打开一本书。", selectedBook.id);
  if (/(继续|接着|回到|开始阅读|读书|continue reading)/i.test(normalized)) return local("continue_reading", "用户要回到最近的阅读位置。", selectedBook?.id);
  if (/^(搜索|查找|找|搜|search|find)\s*/i.test(normalized)) {
    return { ...local("search_library", "用户要搜索本地阅读记忆。"), searchQuery: stripSearchVerb(query) };
  }
  if (selectedBook && normalized.length <= selectedBook.title.length + 6) return local("open_book", "用户输入了书名。", selectedBook.id);
  return null;
}

function local(tool: AgentToolName, reason: string, bookId?: string): AgentRouteDecision {
  return { tool, routedBy: "local", reason, bookId };
}

async function routeWithModel(query: string, snapshot: AgentSnapshot, signal?: AbortSignal): Promise<AgentRouteDecision> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { tool: "search_library", routedBy: "fallback", searchQuery: query, reason: "AI 未配置，已改用本地全文搜索。" };

  const context = {
    activeBook: snapshot.activeBook,
    books: snapshot.books.map(({ id, title, author, format, progress }) => ({ id, title, author, format, progress })),
    role: snapshot.role,
    signals: snapshot.signals,
  };
  const system = `你是 Margin 的意图路由器，运行在本地英语阅读应用中。
你只能选择一个允许的工具：${toolNames.join(", ")}。
如果用户在问英语、阅读策略或要求分析，选择 ask_tutor，并在 answerMarkdown 中直接回答。
如果用户要搜索本地内容，选择 search_library 并提供 searchQuery。
如果要打开某本书，bookId 必须来自上下文，不得编造。
返回严格 JSON：{"tool":"...","bookId":"...","searchQuery":"...","minutes":30,"answerMarkdown":"...","reason":"..."}。
不要返回任何 JSON 之外的内容。
当前环境：${JSON.stringify(context)}`;

  try {
    const response = await fetch(`${(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        messages: [{ role: "system", content: system }, { role: "user", content: query }],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        temperature: 0.1,
        max_tokens: 1200,
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Router upstream returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content || "";
    const parsed = modelDecisionSchema.parse(JSON.parse(stripCodeFence(raw)));
    const bookId = parsed.bookId && snapshot.books.some((book) => book.id === parsed.bookId) ? parsed.bookId : undefined;
    return { ...parsed, bookId, routedBy: "model" };
  } catch {
    return { tool: "search_library", routedBy: "fallback", searchQuery: query, reason: "AI 路由暂时不可用，已改用本地全文搜索。" };
  }
}

async function executeTool(
  query: string,
  decision: AgentRouteDecision,
  snapshot: AgentSnapshot,
): Promise<Omit<AgentRunResult, "id" | "query" | "tool" | "routedBy" | "trace" | "durationMs">> {
  const book = snapshot.books.find((item) => item.id === decision.bookId) ?? snapshot.activeBook;
  const bookHref = book ? `/reader/${book.id}` : "/library";
  const suggestions = defaultSuggestions(snapshot);

  if (decision.tool === "continue_reading" || decision.tool === "open_book") {
    if (!book) return navigation("书库还是空的", "先导入一本 EPUB 或 PDF，Margin 才能建立阅读上下文。", "/library?import=1", "导入书籍", suggestions);
    return navigation(`继续《${book.title}》`, `从 ${book.progress}% 的位置恢复${book.pdfPage ? `，当前在第 ${book.pdfPage} 页` : ""}。`, bookHref, "继续阅读", suggestions, true);
  }
  if (decision.tool === "start_review") {
    return navigation(snapshot.signals.dueCount ? `复习 ${snapshot.signals.dueCount} 个到期词` : "今天的词汇队列已清空", snapshot.signals.dueCount ? "已打开主动回忆队列。" : "可以继续阅读，新的语境词会自动进入之后的复习。", "/review", "打开复习", suggestions, true);
  }
  if (decision.tool === "open_vocabulary") return navigation("打开语境生词", `当前共 ${snapshot.signals.vocabularyCount} 个词，${snapshot.signals.dueCount} 个已到复习时间。`, "/vocabulary", "查看生词", suggestions, true);
  if (decision.tool === "open_notes") return navigation("打开阅读记忆", `已保存 ${snapshot.signals.noteCount} 条笔记与 AI 回答。`, "/notes", "查看笔记", suggestions, true);
  if (decision.tool === "show_insights") return navigation("查看阅读信号", `本周已阅读 ${formatMinutes(snapshot.signals.secondsWeek)}，连续阅读 ${snapshot.signals.streak} 天。`, "/insights", "打开成长报告", suggestions, true);
  if (decision.tool === "open_library") return navigation("打开书库", `当前书库有 ${snapshot.books.length} 本书。`, "/library", "查看全部书籍", suggestions, true);
  if (decision.tool === "import_book") return navigation("导入一本书", "支持 EPUB 与 PDF，文件只保存在本机。", "/library?import=1", "选择文件", suggestions, true);
  if (decision.tool === "manage_roles") return navigation("管理学习角色", `当前使用${snapshot.role ? `“${snapshot.role.name}”` : "默认角色"}。`, "/roles", "调整角色", suggestions, true);
  if (decision.tool === "open_settings") return navigation("打开设置", snapshot.aiConfigured ? "AI 连接已配置，书籍与学习数据保存在本机。" : "AI 连接尚未配置，本地阅读功能仍可使用。", "/settings", "打开设置", suggestions, true);

  if (["summarize_current", "extract_vocabulary", "create_review_tasks"].includes(decision.tool)) {
    if (!book) return navigation("还没有可供处理的阅读内容", "先导入一本书，再让 Margin 基于当前章节工作。", "/library?import=1", "导入书籍", suggestions);
    const action = decision.tool === "summarize_current" ? "summary" : decision.tool === "extract_vocabulary" ? "vocabulary" : "review";
    const title = decision.tool === "summarize_current" ? "总结当前内容" : decision.tool === "extract_vocabulary" ? "提取值得学习的表达" : "生成复习任务";
    return navigation(title, `Margin 会读取《${book.title}》当前页或章节，并使用${snapshot.role ? `“${snapshot.role.name}”` : "当前角色"}处理。`, `${bookHref}${bookHref.includes("?") ? "&" : "?"}agent=${action}`, "打开并生成", suggestions, true);
  }

  if (decision.tool === "plan_session") {
    const total = decision.minutes ?? parseMinutes(query);
    const review = snapshot.signals.dueCount ? Math.max(5, Math.min(10, Math.round(total * 0.22))) : 0;
    const close = Math.min(5, Math.max(3, Math.round(total * 0.12)));
    const reading = Math.max(5, total - review - close);
    const session = createAgentSession({
      query,
      title: `${total} 分钟阅读 Session`,
      bookId: book?.id ?? null,
      totalMinutes: total,
      steps: [
        ...(review ? [{ id: "review", title: `主动回忆 ${review} 分钟`, meta: `优先处理 ${Math.min(snapshot.signals.dueCount, Math.max(3, review))} 个到期词`, minutes: review, href: "/review" }] : []),
        { id: "read", title: `专注阅读 ${reading} 分钟`, meta: book ? `继续《${book.title}》` : "从书库选择一本书", minutes: reading, href: bookHref },
        { id: "close", title: `收尾 ${close} 分钟`, meta: "保存一条笔记，标记真正阻碍理解的词", minutes: close },
      ],
    });
    const items: AgentResultItem[] = session.steps.map(({ id, title, meta, href }) => ({ id, title, meta, href }));
    return {
      title: session.title,
      summary: "计划已结合当前复习队列和最近阅读位置，并保存为可恢复的 Session。",
      href: session.steps[0]?.href ?? bookHref,
      primaryAction: "开始 Session",
      items,
      session,
      suggestions,
    };
  }

  if (decision.tool === "reflect_progress") {
    const today = formatMinutes(snapshot.signals.secondsToday);
    const week = formatMinutes(snapshot.signals.secondsWeek);
    const next = snapshot.signals.dueCount
      ? `先用 5 分钟处理 ${Math.min(snapshot.signals.dueCount, 8)} 个到期词，再回到阅读。`
      : book ? `今天可以直接从《${book.title}》 ${book.progress}% 处继续。` : "导入一本真正想读的英文书。";
    return {
      title: "你的阅读节奏正在建立",
      summary: `今天 ${today}，本周 ${week}，累积保存 ${snapshot.signals.noteCount} 条阅读记忆。${next}`,
      href: snapshot.signals.dueCount ? "/review" : bookHref,
      primaryAction: snapshot.signals.dueCount ? "先完成复习" : "继续阅读",
      items: [
        { id: "today", title: today, meta: "今日阅读" },
        { id: "week", title: week, meta: "本周阅读" },
        { id: "memory", title: `${snapshot.signals.noteCount} 条`, meta: "已保存记忆" },
      ],
      suggestions,
    };
  }

  if (decision.tool === "search_library") {
    const searchQuery = (decision.searchQuery || query).trim();
    const results = await searchLibrary(searchQuery);
    return {
      title: results.length ? `找到 ${results.length} 条相关内容` : "没有找到相关内容",
      summary: results.length ? `结果来自本地书籍、正文、生词和笔记：“${searchQuery}”` : `本地阅读索引中暂无“${searchQuery}”，可以换一个更短的关键词。`,
      href: `/search?q=${encodeURIComponent(searchQuery)}`,
      primaryAction: "打开完整搜索",
      items: results,
      suggestions,
    };
  }

  return {
    title: snapshot.aiConfigured ? "Margin 已结合当前学习环境回答" : "AI 连接尚未配置",
    summary: snapshot.aiConfigured ? "这个回答使用了当前学习角色和精简的阅读状态。" : "可以在设置中检查 DeepSeek 配置，或继续使用本地书库与搜索。",
    answerMarkdown: decision.answerMarkdown || "我还不能稳定完成这个请求。你可以换成更具体的动作，例如“继续阅读”、“搜索论证”或“安排 30 分钟学习”。",
    href: snapshot.aiConfigured ? undefined : "/settings",
    primaryAction: snapshot.aiConfigured ? undefined : "检查 AI 设置",
    suggestions,
  };
}

function navigation(
  title: string,
  summary: string,
  href: string,
  primaryAction: string,
  suggestions: string[],
  autoNavigate = false,
) {
  return { title, summary, href, primaryAction, suggestions, autoNavigate };
}

async function searchLibrary(query: string): Promise<AgentResultItem[]> {
  if (query.trim().length < 2) return [];
  await ensureLibrarySearchIndex();
  const pattern = `%${escapeLike(query)}%`;
  const rows = sqlite.prepare(`
    SELECT * FROM (
      SELECT 'book:' || b.id AS id, 'book' AS type, b.title AS title,
        b.author || ' · ' || upper(b.format) AS meta, '打开书籍' AS snippet,
        '/reader/' || b.id AS href, COALESCE(b.last_opened_at, b.created_at) AS sort_at
      FROM books b
      WHERE b.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR b.author LIKE ? ESCAPE '\\' COLLATE NOCASE
      UNION ALL
      SELECT 'content:' || d.id, 'content', COALESCE(NULLIF(d.title, ''), b.title), b.title,
        d.content, '/reader/' || d.book_id, d.updated_at
      FROM search_documents d JOIN books b ON b.id = d.book_id
      WHERE d.content LIKE ? ESCAPE '\\' COLLATE NOCASE OR d.title LIKE ? ESCAPE '\\' COLLATE NOCASE
      UNION ALL
      SELECT 'vocabulary:' || v.id, 'vocabulary', v.term, b.title || ' · 生词',
        COALESCE(NULLIF(v.definition, ''), v.context), '/vocabulary?q=' || replace(v.term, ' ', '%20'), v.updated_at
      FROM vocabulary v JOIN books b ON b.id = v.book_id
      WHERE v.term LIKE ? ESCAPE '\\' COLLATE NOCASE OR v.definition LIKE ? ESCAPE '\\' COLLATE NOCASE OR v.context LIKE ? ESCAPE '\\' COLLATE NOCASE
      UNION ALL
      SELECT 'note:' || n.id, 'note', COALESCE(NULLIF(n.title, ''), '阅读笔记'), b.title || ' · 笔记',
        n.selected_text || ' ' || n.content_markdown, '/notes', n.updated_at
      FROM notes n JOIN books b ON b.id = n.book_id
      WHERE n.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR n.selected_text LIKE ? ESCAPE '\\' COLLATE NOCASE OR n.content_markdown LIKE ? ESCAPE '\\' COLLATE NOCASE
    ) ORDER BY sort_at DESC LIMIT 8
  `).all(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern) as SearchRow[];
  return rows.map((row) => ({ id: row.id, title: row.title, meta: row.meta, snippet: snippetAround(row.snippet, query), href: row.href }));
}

function saveRun(run: AgentRunResult, reason: string) {
  try {
    sqlite.prepare(`
      INSERT INTO agent_runs (id, query, intent, tool_name, routed_by, status, output_json, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)
    `).run(run.id, run.query, reason, run.tool, run.routedBy, JSON.stringify(run), run.durationMs, new Date().toISOString());
  } catch {
    // Tracing must never block the user's requested action.
  }
}

function matchBook(query: string, books: AgentBookContext[]) {
  const normalized = normalize(query);
  return books.find((book) => normalized.includes(normalize(book.title)))
    ?? books.find((book) => normalize(book.title).split(/\s+/).filter((part) => part.length > 2).some((part) => normalized.includes(part)));
}

function parseMinutes(query: string) {
  const hours = query.match(/(\d+(?:\.\d+)?)\s*(?:个)?小时/i);
  if (hours) return Math.max(5, Math.min(240, Math.round(Number(hours[1]) * 60)));
  const minutes = query.match(/(\d{1,3})\s*(?:分钟|mins?|minutes?)/i);
  return minutes ? Math.max(5, Math.min(240, Number(minutes[1]))) : 30;
}

function stripSearchVerb(query: string) {
  return query.replace(/^(?:搜索|查找|找到|找|搜|search|find)\s*/i, "").trim() || query.trim();
}

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function snippetAround(content: string, query: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, 150);
  const start = Math.max(0, index - 54);
  const end = Math.min(normalized.length, index + query.length + 84);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

function formatMinutes(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function defaultSuggestions(snapshot: AgentSnapshot) {
  return [
    snapshot.activeBook ? `继续读${shortTitle(snapshot.activeBook.title)}` : "导入一本书",
    snapshot.signals.dueCount ? `复习 ${snapshot.signals.dueCount} 个到期词` : "安排 30 分钟阅读",
    "我最近的阅读有什么问题？",
  ];
}

function shortTitle(title: string) {
  return title.length > 16 ? `${title.slice(0, 16)}…` : title;
}

function toolLabel(tool: AgentToolName) {
  const labels: Record<AgentToolName, string> = {
    continue_reading: "恢复最近阅读位置",
    open_library: "打开本地书库",
    open_book: "打开指定书籍",
    start_review: "打开到期复习队列",
    open_vocabulary: "打开语境生词",
    open_notes: "打开阅读记忆",
    show_insights: "生成阅读信号",
    search_library: "查询本地全文索引",
    import_book: "打开文件导入",
    manage_roles: "打开学习角色",
    open_settings: "打开本地设置",
    plan_session: "组装当次阅读 Session",
    summarize_current: "调用当前章节总结",
    extract_vocabulary: "调用语境词汇提取",
    create_review_tasks: "调用复习任务生成",
    reflect_progress: "解读学习记录",
    ask_tutor: "调用 AI 导师回答",
  };
  return labels[tool];
}
