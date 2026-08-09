import "server-only";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { ROLE_PRESETS } from "@/lib/role-presets";
import * as schema from "./schema";

type NativeDatabase = InstanceType<typeof Database>;
type OrmDatabase = BetterSQLite3Database<typeof schema>;

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
  CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);
  CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON ai_messages(conversation_id);
`);

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
