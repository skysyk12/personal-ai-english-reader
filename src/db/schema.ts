import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull().default("Unknown author"),
  format: text("format", { enum: ["epub", "pdf"] }).notNull(),
  originalFilePath: text("original_file_path").notNull(),
  coverPath: text("cover_path"),
  importStatus: text("import_status", {
    enum: ["importing", "ready", "fallback_ready", "failed"],
  })
    .notNull()
    .default("importing"),
  pdfParseScore: integer("pdf_parse_score"),
  pdfDefaultMode: text("pdf_default_mode", { enum: ["reflow", "original"] }),
  totalLocations: integer("total_locations"),
  defaultRoleId: text("default_role_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastOpenedAt: text("last_opened_at"),
});

export const readingProgress = sqliteTable("reading_progress", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().unique(),
  sourceType: text("source_type").notNull(),
  epubCfi: text("epub_cfi"),
  pdfPage: integer("pdf_page"),
  pdfBlockId: text("pdf_block_id"),
  percentage: integer("percentage").notNull().default(0),
  roleId: text("role_id"),
  updatedAt: text("updated_at").notNull(),
});

export const learningRoles = sqliteTable("learning_roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  currentLevel: text("current_level").notNull().default("Intermediate"),
  goal: text("goal").notNull().default("Understand English reading material"),
  targetScore: text("target_score"),
  focusAreasJson: text("focus_areas_json").notNull().default("[]"),
  answerLanguage: text("answer_language", { enum: ["zh-CN", "en", "bilingual"] })
    .notNull()
    .default("bilingual"),
  explanationDepth: text("explanation_depth", {
    enum: ["brief", "standard", "detailed"],
  })
    .notNull()
    .default("standard"),
  tone: text("tone", { enum: ["direct", "teacher", "concise"] })
    .notNull()
    .default("teacher"),
  featureFlagsJson: text("feature_flags_json").notNull().default("{}"),
  customInstructions: text("custom_instructions").notNull().default(""),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const highlights = sqliteTable("highlights", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  anchorType: text("anchor_type").notNull(),
  anchorJson: text("anchor_json").notNull(),
  selectedText: text("selected_text").notNull(),
  color: text("color").notNull().default("yellow"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const aiConversations = sqliteTable("ai_conversations", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  roleId: text("role_id").notNull(),
  action: text("action").notNull(),
  selectedText: text("selected_text").notNull(),
  contextSnapshot: text("context_snapshot").notNull(),
  anchorJson: text("anchor_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const aiMessages = sqliteTable("ai_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: text("created_at").notNull(),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  highlightId: text("highlight_id"),
  conversationId: text("conversation_id"),
  noteType: text("note_type").notNull(),
  title: text("title").notNull().default(""),
  selectedText: text("selected_text").notNull().default(""),
  contentMarkdown: text("content_markdown").notNull(),
  anchorJson: text("anchor_json").notNull(),
  roleId: text("role_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const vocabulary = sqliteTable("vocabulary", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  term: text("term").notNull(),
  normalizedTerm: text("normalized_term").notNull(),
  definition: text("definition").notNull().default(""),
  phonetic: text("phonetic").notNull().default(""),
  partOfSpeech: text("part_of_speech").notNull().default(""),
  context: text("context").notNull().default(""),
  anchorJson: text("anchor_json").notNull(),
  status: text("status", { enum: ["new", "learning", "mastered"] }).notNull().default("new"),
  easeFactor: real("ease_factor").notNull().default(2.5),
  intervalDays: integer("interval_days").notNull().default(0),
  repetitions: integer("repetitions").notNull().default(0),
  dueAt: text("due_at").notNull(),
  lastReviewedAt: text("last_reviewed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const vocabularyReviews = sqliteTable("vocabulary_reviews", {
  id: text("id").primaryKey(),
  vocabularyId: text("vocabulary_id").notNull(),
  rating: text("rating", { enum: ["again", "hard", "good", "easy"] }).notNull(),
  previousInterval: integer("previous_interval").notNull().default(0),
  nextInterval: integer("next_interval").notNull().default(0),
  reviewedAt: text("reviewed_at").notNull(),
});

export const readingSessions = sqliteTable("reading_sessions", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  startPercentage: integer("start_percentage").notNull().default(0),
  endPercentage: integer("end_percentage").notNull().default(0),
});

export const searchDocuments = sqliteTable("search_documents", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  sourceType: text("source_type").notNull(),
  locationKey: text("location_key").notNull(),
  title: text("title").notNull().default(""),
  content: text("content").notNull(),
  anchorJson: text("anchor_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Book = typeof books.$inferSelect;
export type LearningRoleRow = typeof learningRoles.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type VocabularyRow = typeof vocabulary.$inferSelect;
