export type AgentBookContext = {
  id: string;
  title: string;
  author: string;
  format: "epub" | "pdf";
  progress: number;
  pdfPage: number | null;
  lastOpenedAt: string | null;
};

export type AgentSnapshot = {
  generatedAt: string;
  activeBook: AgentBookContext | null;
  books: AgentBookContext[];
  role: {
    id: string;
    name: string;
    currentLevel: string;
    goal: string;
  } | null;
  signals: {
    dueCount: number;
    secondsToday: number;
    secondsWeek: number;
    noteCount: number;
    vocabularyCount: number;
    streak: number;
  };
  recentNotes: Array<{
    id: string;
    title: string;
    bookTitle: string;
    selectedText: string;
    createdAt: string;
    href: string;
  }>;
  activeSession: AgentSession | null;
  aiConfigured: boolean;
};

export type AgentSessionStep = {
  id: string;
  title: string;
  meta: string;
  minutes: number;
  href?: string;
  status: "pending" | "current" | "complete";
};

export type AgentSession = {
  id: string;
  query: string;
  title: string;
  bookId: string | null;
  totalMinutes: number;
  currentStep: number;
  status: "active" | "completed" | "dismissed";
  steps: AgentSessionStep[];
  createdAt: string;
  updatedAt: string;
};

export type AgentToolName =
  | "continue_reading"
  | "open_library"
  | "open_book"
  | "start_review"
  | "open_vocabulary"
  | "open_notes"
  | "show_insights"
  | "search_library"
  | "import_book"
  | "manage_roles"
  | "open_settings"
  | "plan_session"
  | "summarize_current"
  | "extract_vocabulary"
  | "create_review_tasks"
  | "reflect_progress"
  | "ask_tutor";

export type AgentTraceStep = {
  label: string;
  detail: string;
  status: "complete" | "fallback";
};

export type AgentResultItem = {
  id: string;
  title: string;
  meta: string;
  snippet?: string;
  href?: string;
};

export type AgentRunResult = {
  id: string;
  query: string;
  tool: AgentToolName;
  routedBy: "local" | "model" | "fallback";
  title: string;
  summary: string;
  answerMarkdown?: string;
  href?: string;
  autoNavigate?: boolean;
  primaryAction?: string;
  items?: AgentResultItem[];
  session?: AgentSession;
  trace: AgentTraceStep[];
  suggestions: string[];
  durationMs: number;
};

export type AgentRouteDecision = {
  tool: AgentToolName;
  routedBy: AgentRunResult["routedBy"];
  bookId?: string;
  searchQuery?: string;
  minutes?: number;
  answerMarkdown?: string;
  reason: string;
};
