import "server-only";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { ROLE_PRESETS } from "@/lib/role-presets";
import * as schema from "./schema";

type NativeDatabase = InstanceType<typeof Database>;
type OrmDatabase = BetterSQLite3Database<typeof schema>;

// CREATE TABLE IF NOT EXISTS only covers fresh databases; columns added in
// later versions need this idempotent ALTER TABLE path for existing installs.
function ensureBookColumns(connection: NativeDatabase) {
  const columns = connection.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "reflow_policy")) {
    connection.exec(
      "ALTER TABLE books ADD COLUMN reflow_policy TEXT NOT NULL DEFAULT 'auto' CHECK (reflow_policy IN ('auto','none','local','api'))",
    );
  }
}

let nativeDatabase: NativeDatabase | null = null;
let ormDatabase: OrmDatabase | null = null;

function initializeDatabase(): { sqlite: NativeDatabase; db: OrmDatabase } {
  if (nativeDatabase && ormDatabase) return { sqlite: nativeDatabase, db: ormDatabase };

  const dataDirectory = path.join(process.cwd(), "data");
  fs.mkdirSync(path.join(dataDirectory, "books"), { recursive: true });
  fs.mkdirSync(path.join(dataDirectory, "backups"), { recursive: true });

  const connection = new Database(path.join(dataDirectory, "app.db"));
  connection.pragma("busy_timeout = 10000");
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");

  connection.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'Unknown author',
    format TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    cover_path TEXT,
    import_status TEXT NOT NULL DEFAULT 'importing',
    pdf_parse_score INTEGER,
    pdf_default_mode TEXT,
    reflow_policy TEXT NOT NULL DEFAULT 'auto' CHECK (reflow_policy IN ('auto','none','local','api')),
    total_locations INTEGER,
    default_role_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reading_progress (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    epub_cfi TEXT,
    pdf_page INTEGER,
    pdf_block_id TEXT,
    percentage INTEGER NOT NULL DEFAULT 0,
    role_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS learning_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    current_level TEXT NOT NULL DEFAULT 'Intermediate',
    goal TEXT NOT NULL DEFAULT 'Understand English reading material',
    target_score TEXT,
    focus_areas_json TEXT NOT NULL DEFAULT '[]',
    answer_language TEXT NOT NULL DEFAULT 'bilingual',
    explanation_depth TEXT NOT NULL DEFAULT 'standard',
    tone TEXT NOT NULL DEFAULT 'teacher',
    feature_flags_json TEXT NOT NULL DEFAULT '{}',
    custom_instructions TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    anchor_type TEXT NOT NULL,
    anchor_json TEXT NOT NULL,
    selected_text TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'yellow',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    action TEXT NOT NULL,
    selected_text TEXT NOT NULL,
    context_snapshot TEXT NOT NULL,
    anchor_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    highlight_id TEXT,
    conversation_id TEXT,
    note_type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    selected_text TEXT NOT NULL DEFAULT '',
    content_markdown TEXT NOT NULL,
    anchor_json TEXT NOT NULL,
    role_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vocabulary (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    term TEXT NOT NULL,
    normalized_term TEXT NOT NULL,
    definition TEXT NOT NULL DEFAULT '',
    phonetic TEXT NOT NULL DEFAULT '',
    part_of_speech TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    anchor_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(book_id, normalized_term)
  );
  CREATE TABLE IF NOT EXISTS vocabulary_reviews (
    id TEXT PRIMARY KEY,
    vocabulary_id TEXT NOT NULL,
    rating TEXT NOT NULL,
    previous_interval INTEGER NOT NULL DEFAULT 0,
    next_interval INTEGER NOT NULL DEFAULT 0,
    reviewed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    start_percentage INTEGER NOT NULL DEFAULT 0,
    end_percentage INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS search_documents (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    location_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    anchor_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(book_id, source_type, location_key)
  );
  CREATE TABLE IF NOT EXISTS learning_goals (
    id TEXT PRIMARY KEY,
    metric TEXT NOT NULL UNIQUE,
    target_value INTEGER NOT NULL,
    period TEXT NOT NULL DEFAULT 'weekly',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    intent TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    routed_by TEXT NOT NULL,
    status TEXT NOT NULL,
    output_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    title TEXT NOT NULL,
    book_id TEXT,
    total_minutes INTEGER NOT NULL,
    current_step INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);
  CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON ai_messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_book_id ON vocabulary(book_id);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_due_at ON vocabulary(due_at, status);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_reviews_word ON vocabulary_reviews(vocabulary_id);
  CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_search_documents_book ON search_documents(book_id, source_type);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status, updated_at DESC);
`);

  ensureBookColumns(connection);

  const seedRole = connection.prepare(`
  INSERT OR IGNORE INTO learning_roles (
    id, name, description, current_level, goal, target_score,
    focus_areas_json, answer_language, explanation_depth, tone,
    feature_flags_json, custom_instructions, is_default, created_at, updated_at
  ) VALUES (
    @id, @name, @description, @currentLevel, @goal, NULL,
    @focusAreasJson, @answerLanguage, @explanationDepth, @tone,
    @featureFlagsJson, @customInstructions, @isDefault, @createdAt, @updatedAt
  )
`);

  const seededAt = new Date().toISOString();
  connection.transaction(() => {
    let hasDefaultRole = Boolean(
      (connection
        .prepare("SELECT id FROM learning_roles WHERE is_default = 1 LIMIT 1")
        .get() as { id?: string } | undefined)?.id,
    );
    for (const role of ROLE_PRESETS) {
      const shouldBecomeDefault = role.isDefault && !hasDefaultRole;
      const result = seedRole.run({
        ...role,
        focusAreasJson: JSON.stringify(role.focusAreas),
        featureFlagsJson: JSON.stringify(role.featureFlags),
        isDefault: shouldBecomeDefault ? 1 : 0,
        createdAt: seededAt,
        updatedAt: seededAt,
      });
      if (result.changes > 0 && shouldBecomeDefault) hasDefaultRole = true;
    }
  })();

  const seedGoal = connection.prepare(`
    INSERT OR IGNORE INTO learning_goals (
      id, metric, target_value, period, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, 'weekly', 1, ?, ?)
  `);
  connection.transaction(() => {
    const defaults = [
      ["goal_reading_minutes", "reading_minutes", 180],
      ["goal_review_count", "review_count", 50],
      ["goal_new_words", "new_words", 30],
    ] as const;
    for (const [id, metric, target] of defaults) {
      seedGoal.run(id, metric, target, seededAt, seededAt);
    }
  })();

  nativeDatabase = connection;
  ormDatabase = drizzle(connection, { schema });
  return { sqlite: nativeDatabase, db: ormDatabase };
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve();
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const sqlite = lazyProxy<NativeDatabase>(() => initializeDatabase().sqlite);
export const db = lazyProxy<OrmDatabase>(() => initializeDatabase().db);
