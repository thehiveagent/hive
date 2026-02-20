import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  type AgentRecord,
  type ConversationRecord,
  type MessageRecord,
  type MessageRole,
  type MetaRecord,
} from "./schema.js";

export type HiveDatabase = Database.Database;
export type {
  AgentRecord,
  ConversationRecord,
  MessageRecord,
  MessageRole,
  MetaRecord,
} from "./schema.js";

export interface UpsertAgentInput {
  name: string;
  provider: string;
  model: string;
  persona: string;
}

export interface CreateConversationInput {
  agentId: string;
  title?: string | null;
}

export interface AppendMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string;
}

export const HIVE_DIRECTORY_NAME = ".hive";
export const HIVE_DB_FILENAME = "hive.db";

export function getHiveHomeDir(): string {
  return process.env.HIVE_HOME ?? join(homedir(), HIVE_DIRECTORY_NAME);
}

export function getHiveDatabasePath(): string {
  return join(getHiveHomeDir(), HIVE_DB_FILENAME);
}

export function openHiveDatabase(databasePath = getHiveDatabasePath()): HiveDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  configureDatabase(db);
  runMigrations(db);
  setMetaValue(db, "schema_version", String(CURRENT_SCHEMA_VERSION));

  return db;
}

export function closeHiveDatabase(db: HiveDatabase): void {
  db.close();
}

function configureDatabase(db: HiveDatabase): void {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
}

function ensureMigrationTable(db: HiveDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function runMigrations(db: HiveDatabase): void {
  ensureMigrationTable(db);

  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        `
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `,
      ).run(migration.version, migration.name, nowIso());
    });

    applyMigration();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getMetaValue(db: HiveDatabase, key: string): string | null {
  const row = db
    .prepare("SELECT key, value, updated_at FROM meta WHERE key = ?")
    .get(key) as MetaRecord | undefined;

  return row?.value ?? null;
}

export function setMetaValue(db: HiveDatabase, key: string, value: string): void {
  db.prepare(
    `
    INSERT INTO meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `,
  ).run(key, value, nowIso());
}

export function isHiveInitialized(db: HiveDatabase): boolean {
  const row = db
    .prepare("SELECT COUNT(1) as count FROM agents")
    .get() as { count: number };

  return row.count > 0;
}

export function getPrimaryAgent(db: HiveDatabase): AgentRecord | null {
  const row = db
    .prepare(
      `
      SELECT id, name, provider, model, persona, created_at, updated_at
      FROM agents
      ORDER BY datetime(created_at) ASC
      LIMIT 1
    `,
    )
    .get() as AgentRecord | undefined;

  return row ?? null;
}

export function upsertPrimaryAgent(
  db: HiveDatabase,
  input: UpsertAgentInput,
): AgentRecord {
  const existing = getPrimaryAgent(db);
  const timestamp = nowIso();

  if (existing) {
    db.prepare(
      `
      UPDATE agents
      SET name = ?, provider = ?, model = ?, persona = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(
      input.name,
      input.provider,
      input.model,
      input.persona,
      timestamp,
      existing.id,
    );

    return {
      ...existing,
      name: input.name,
      provider: input.provider,
      model: input.model,
      persona: input.persona,
      updated_at: timestamp,
    };
  }

  const id = uuidv4();
  db.prepare(
    `
    INSERT INTO agents (id, name, provider, model, persona, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, input.name, input.provider, input.model, input.persona, timestamp, timestamp);

  return {
    id,
    name: input.name,
    provider: input.provider,
    model: input.model,
    persona: input.persona,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function createConversation(
  db: HiveDatabase,
  input: CreateConversationInput,
): ConversationRecord {
  const id = uuidv4();
  const timestamp = nowIso();

  db.prepare(
    `
    INSERT INTO conversations (id, agent_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, input.agentId, input.title ?? null, timestamp, timestamp);

  return {
    id,
    agent_id: input.agentId,
    title: input.title ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function getConversationById(
  db: HiveDatabase,
  conversationId: string,
): ConversationRecord | null {
  const row = db
    .prepare(
      `
      SELECT id, agent_id, title, created_at, updated_at
      FROM conversations
      WHERE id = ?
    `,
    )
    .get(conversationId) as ConversationRecord | undefined;

  return row ?? null;
}

export function getLatestConversationForAgent(
  db: HiveDatabase,
  agentId: string,
): ConversationRecord | null {
  const row = db
    .prepare(
      `
      SELECT id, agent_id, title, created_at, updated_at
      FROM conversations
      WHERE agent_id = ?
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `,
    )
    .get(agentId) as ConversationRecord | undefined;

  return row ?? null;
}

export function appendMessage(
  db: HiveDatabase,
  input: AppendMessageInput,
): MessageRecord {
  const id = uuidv4();
  const timestamp = nowIso();

  const writeMessage = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(id, input.conversationId, input.role, input.content, timestamp);

    db.prepare(
      `
      UPDATE conversations
      SET updated_at = ?
      WHERE id = ?
    `,
    ).run(timestamp, input.conversationId);
  });

  writeMessage();

  return {
    id,
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    created_at: timestamp,
  };
}

export function listMessages(
  db: HiveDatabase,
  conversationId: string,
  limit = 100,
): MessageRecord[] {
  return db
    .prepare(
      `
      SELECT id, conversation_id, role, content, created_at
      FROM (
        SELECT id, conversation_id, role, content, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      )
      ORDER BY datetime(created_at) ASC
    `,
    )
    .all(conversationId, limit) as MessageRecord[];
}
