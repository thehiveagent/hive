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
  type EpisodeRecord,
  type KnowledgeRecord,
  type MessageRecord,
  type MessageRole,
  type MetaRecord,
  type TaskRecord,
  type TaskStatus,
} from "./schema.js";

export type HiveDatabase = Database.Database;
export type {
  AgentRecord,
  ConversationRecord,
  EpisodeRecord,
  KnowledgeRecord,
  MessageRecord,
  MessageRole,
  MetaRecord,
  TaskRecord,
  TaskStatus,
} from "./schema.js";

export interface UpsertAgentInput {
  name: string;
  provider: string;
  model: string;
  persona: string;
  dob?: string | null;
  location?: string | null;
  profession?: string | null;
  aboutRaw?: string | null;
  agentName?: string | null;
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

export interface InsertKnowledgeInput {
  content: string;
  pinned?: boolean;
  source?: string;
}

export interface ListKnowledgeOptions {
  limit?: number;
  source?: string;
}

export interface UpdatePrimaryAgentProviderModelInput {
  provider: string;
  model: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
}

export interface RelevantEpisode {
  episode: EpisodeRecord;
  score: number;
}

export interface InsertTaskInput {
  id: string;
  title: string;
  agentId?: string | null;
}

export const HIVE_DIRECTORY_NAME = ".hive";
export const HIVE_DB_FILENAME = "hive.db";

const AGENT_PROFILE_COLUMNS = [
  { name: "dob", definition: "TEXT" },
  { name: "location", definition: "TEXT" },
  { name: "profession", definition: "TEXT" },
  { name: "about_raw", definition: "TEXT" },
  { name: "agent_name", definition: "TEXT" },
] as const;

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

function nowIso(): string {
  return new Date().toISOString();
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

  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{
    version: number;
  }>;
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      if (migration.name === "v2_agents_profile_columns") {
        ensureAgentProfileColumns(db);
      } else {
        db.exec(migration.sql);
      }

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

function ensureAgentProfileColumns(db: HiveDatabase): void {
  const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as Array<{
    name: string;
  }>;
  const existingColumns = new Set(tableInfo.map((column) => column.name));

  for (const column of AGENT_PROFILE_COLUMNS) {
    if (existingColumns.has(column.name)) {
      continue;
    }

    db.exec(`ALTER TABLE agents ADD COLUMN ${column.name} ${column.definition}`);
  }
}

export function getMetaValue(db: HiveDatabase, key: string): string | null {
  const row = db.prepare("SELECT key, value, updated_at FROM meta WHERE key = ?").get(key) as
    | MetaRecord
    | undefined;

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
  const row = db.prepare("SELECT COUNT(1) as count FROM agents").get() as { count: number };

  return row.count > 0;
}

export function getPrimaryAgent(db: HiveDatabase): AgentRecord | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        name,
        provider,
        model,
        persona,
        dob,
        location,
        profession,
        about_raw,
        agent_name,
        created_at,
        updated_at
      FROM agents
      ORDER BY datetime(created_at) ASC
      LIMIT 1
    `,
    )
    .get() as AgentRecord | undefined;

  return row ?? null;
}

export function upsertPrimaryAgent(db: HiveDatabase, input: UpsertAgentInput): AgentRecord {
  const existing = getPrimaryAgent(db);
  const timestamp = nowIso();

  if (existing) {
    db.prepare(
      `
      UPDATE agents
      SET
        name = ?,
        provider = ?,
        model = ?,
        persona = ?,
        dob = ?,
        location = ?,
        profession = ?,
        about_raw = ?,
        agent_name = ?,
        updated_at = ?
      WHERE id = ?
    `,
    ).run(
      input.name,
      input.provider,
      input.model,
      input.persona,
      input.dob ?? null,
      input.location ?? null,
      input.profession ?? null,
      input.aboutRaw ?? null,
      input.agentName ?? null,
      timestamp,
      existing.id,
    );

    return {
      ...existing,
      name: input.name,
      provider: input.provider,
      model: input.model,
      persona: input.persona,
      dob: input.dob ?? null,
      location: input.location ?? null,
      profession: input.profession ?? null,
      about_raw: input.aboutRaw ?? null,
      agent_name: input.agentName ?? null,
      updated_at: timestamp,
    };
  }

  const id = uuidv4();
  db.prepare(
    `
    INSERT INTO agents (
      id,
      name,
      provider,
      model,
      persona,
      dob,
      location,
      profession,
      about_raw,
      agent_name,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    input.name,
    input.provider,
    input.model,
    input.persona,
    input.dob ?? null,
    input.location ?? null,
    input.profession ?? null,
    input.aboutRaw ?? null,
    input.agentName ?? null,
    timestamp,
    timestamp,
  );

  return {
    id,
    name: input.name,
    provider: input.provider,
    model: input.model,
    persona: input.persona,
    dob: input.dob ?? null,
    location: input.location ?? null,
    profession: input.profession ?? null,
    about_raw: input.aboutRaw ?? null,
    agent_name: input.agentName ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function updatePrimaryAgentProviderAndModel(
  db: HiveDatabase,
  input: UpdatePrimaryAgentProviderModelInput,
): AgentRecord {
  const existing = getPrimaryAgent(db);
  if (!existing) {
    throw new Error("Hive is not initialized. Run `hive init` first.");
  }

  return updatePrimaryAgentConfiguration(db, existing, input.provider, input.model);
}

export function updatePrimaryAgentModel(db: HiveDatabase, model: string): AgentRecord {
  const existing = getPrimaryAgent(db);
  if (!existing) {
    throw new Error("Hive is not initialized. Run `hive init` first.");
  }

  return updatePrimaryAgentConfiguration(db, existing, existing.provider, model);
}

function updatePrimaryAgentConfiguration(
  db: HiveDatabase,
  existing: AgentRecord,
  provider: string,
  model: string,
): AgentRecord {
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE agents
      SET provider = ?, model = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(provider, model, timestamp, existing.id);

  return {
    ...existing,
    provider,
    model,
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

export function updateConversationTitle(
  db: HiveDatabase,
  conversationId: string,
  title: string,
): ConversationRecord {
  const existing = getConversationById(db, conversationId);
  if (!existing) {
    throw new Error(`Conversation "${conversationId}" was not found.`);
  }

  const trimmed = title.trim();
  const timestamp = nowIso();

  db.prepare(
    `
    UPDATE conversations
    SET title = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(trimmed, timestamp, conversationId);

  return {
    ...existing,
    title: trimmed,
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

export function appendMessage(db: HiveDatabase, input: AppendMessageInput): MessageRecord {
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

export function listConversationMessages(
  db: HiveDatabase,
  conversationId: string,
): MessageRecord[] {
  return db
    .prepare(
      `
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY datetime(created_at) ASC
    `,
    )
    .all(conversationId) as MessageRecord[];
}

export function listRecentConversations(db: HiveDatabase, limit = 10): ConversationSummary[] {
  return db
    .prepare(
      `
      SELECT
        c.id,
        c.title,
        c.updated_at,
        COUNT(m.id) AS message_count
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id, c.title, c.updated_at
      ORDER BY datetime(c.updated_at) DESC
      LIMIT ?
    `,
    )
    .all(limit) as ConversationSummary[];
}

export function insertKnowledge(db: HiveDatabase, input: InsertKnowledgeInput): KnowledgeRecord {
  const id = uuidv4();
  const timestamp = nowIso();
  const pinnedValue = input.pinned ? 1 : 0;
  const sourceValue = input.source ?? "manual";

  db.prepare(
    `
    INSERT INTO knowledge (id, content, created_at, pinned, source)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, input.content.trim(), timestamp, pinnedValue, sourceValue);

  return {
    id,
    content: input.content.trim(),
    created_at: timestamp,
    pinned: pinnedValue,
    source: sourceValue,
  };
}

export function listKnowledge(
  db: HiveDatabase,
  options: ListKnowledgeOptions = {},
): KnowledgeRecord[] {
  const limit = options.limit ?? 100;
  const sourceFilter = options.source;
  if (sourceFilter) {
    return db
      .prepare(
        `
        SELECT id, content, created_at, pinned, source
        FROM knowledge
        WHERE source = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `,
      )
      .all(sourceFilter, limit) as KnowledgeRecord[];
  }

  return db
    .prepare(
      `
      SELECT id, content, created_at, pinned, source
      FROM knowledge
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `,
    )
    .all(limit) as KnowledgeRecord[];
}

export function listAutoKnowledge(db: HiveDatabase, limit = 500): KnowledgeRecord[] {
  return db
    .prepare(
      `
      SELECT id, content, created_at, pinned, source
      FROM knowledge
      WHERE source = 'auto'
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `,
    )
    .all(limit) as KnowledgeRecord[];
}

export function findClosestKnowledge(db: HiveDatabase, query: string): KnowledgeRecord | null {
  const normalized = query.trim();
  if (normalized.length === 0) {
    return null;
  }

  const row = db
    .prepare(
      `
      SELECT
        id,
        content,
        created_at,
        pinned,
        source,
        CASE WHEN content LIKE ? THEN 0 ELSE 1 END AS mismatch,
        ABS(LENGTH(content) - ?) AS length_diff
      FROM knowledge
      ORDER BY mismatch ASC, length_diff ASC, datetime(created_at) DESC
      LIMIT 1
    `,
    )
    .get(`%${normalized}%`, normalized.length) as
    | (KnowledgeRecord & { mismatch: number; length_diff: number })
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    pinned: row.pinned,
    source: row.source,
  };
}

export function deleteKnowledge(db: HiveDatabase, id: string): void {
  db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
}

export function listPinnedKnowledge(db: HiveDatabase): KnowledgeRecord[] {
  return db
    .prepare(
      `
      SELECT id, content, created_at, pinned, source
      FROM knowledge
      WHERE pinned = 1
      ORDER BY datetime(created_at) DESC
    `,
    )
    .all() as KnowledgeRecord[];
}

export function insertEpisode(db: HiveDatabase, content: string): EpisodeRecord {
  const id = uuidv4();
  const timestamp = nowIso();

  db.prepare(
    `
    INSERT INTO episodes (id, content, created_at)
    VALUES (?, ?, ?)
  `,
  ).run(id, content.trim(), timestamp);

  return {
    id,
    content: content.trim(),
    created_at: timestamp,
  };
}

export function listEpisodes(db: HiveDatabase, limit = 200): EpisodeRecord[] {
  return db
    .prepare(
      `
      SELECT id, content, created_at
      FROM episodes
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `,
    )
    .all(limit) as EpisodeRecord[];
}

export function findRelevantEpisodes(
  db: HiveDatabase,
  query: string,
  limit = 3,
): RelevantEpisode[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return [];
  }

  const terms = Array.from(
    new Set(
      normalized
        .split(/\W+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4),
    ),
  );

  if (terms.length === 0) {
    return [];
  }

  const episodes = listEpisodes(db, 200);
  const scored: RelevantEpisode[] = episodes
    .map((episode) => {
      const text = episode.content.toLowerCase();
      const score = terms.reduce((acc, term) => (text.includes(term) ? acc + 1 : acc), 0);
      return { episode, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.episode.created_at.localeCompare(a.episode.created_at));

  return scored.slice(0, limit);
}

export function clearEpisodes(db: HiveDatabase): void {
  db.exec("DELETE FROM episodes");
}

export function insertTask(db: HiveDatabase, input: InsertTaskInput): TaskRecord {
  const timestamp = nowIso();

  db.prepare(
    `
    INSERT OR IGNORE INTO tasks (
      id,
      title,
      status,
      result,
      created_at,
      started_at,
      completed_at,
      agent_id,
      error
    )
    VALUES (?, ?, 'queued', NULL, ?, NULL, NULL, ?, NULL)
  `,
  ).run(input.id, input.title.trim(), timestamp, input.agentId ?? null);

  const row = getTaskById(db, input.id);
  if (!row) {
    // Shouldn't happen unless the DB is read-only or corrupted.
    throw new Error("Task insert failed.");
  }
  return row;
}

export function getTaskById(db: HiveDatabase, id: string): TaskRecord | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        title,
        status,
        result,
        created_at,
        started_at,
        completed_at,
        agent_id,
        error
      FROM tasks
      WHERE id = ?
    `,
    )
    .get(id) as TaskRecord | undefined;

  return row ?? null;
}

export function listTasks(db: HiveDatabase): TaskRecord[] {
  return db
    .prepare(
      `
      SELECT
        id,
        title,
        status,
        result,
        created_at,
        started_at,
        completed_at,
        agent_id,
        error
      FROM tasks
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'queued' THEN 1
          WHEN 'done' THEN 2
          WHEN 'failed' THEN 3
          ELSE 4
        END,
        datetime(created_at) DESC
    `,
    )
    .all() as TaskRecord[];
}

export function countTasksByStatus(db: HiveDatabase): Record<TaskStatus, number> {
  const rows = db
    .prepare(
      `
      SELECT status, COUNT(1) AS count
      FROM tasks
      GROUP BY status
    `,
    )
    .all() as Array<{ status: TaskStatus; count: number }>;

  return rows.reduce(
    (acc, row) => {
      acc[row.status] = row.count;
      return acc;
    },
    { queued: 0, running: 0, done: 0, failed: 0 } as Record<TaskStatus, number>,
  );
}

export function claimNextQueuedTask(db: HiveDatabase): TaskRecord | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        title,
        status,
        result,
        created_at,
        started_at,
        completed_at,
        agent_id,
        error
      FROM tasks
      WHERE status = 'queued'
      ORDER BY datetime(created_at) ASC
      LIMIT 1
    `,
    )
    .get() as TaskRecord | undefined;

  return row ?? null;
}

export function resetRunningTasksToQueued(db: HiveDatabase): number {
  const info = db
    .prepare(
      `
      UPDATE tasks
      SET status = 'queued', started_at = NULL, completed_at = NULL, error = NULL
      WHERE status = 'running'
    `,
    )
    .run();

  return Number(info.changes ?? 0);
}

export function markTaskRunning(db: HiveDatabase, id: string): void {
  db.prepare(
    `
    UPDATE tasks
    SET status = 'running', started_at = ?, completed_at = NULL, error = NULL
    WHERE id = ?
  `,
  ).run(nowIso(), id);
}

export function markTaskDone(db: HiveDatabase, id: string, result: string): void {
  db.prepare(
    `
    UPDATE tasks
    SET status = 'done', result = ?, completed_at = ?, error = NULL
    WHERE id = ?
  `,
  ).run(result, nowIso(), id);
}

export function markTaskFailed(db: HiveDatabase, id: string, error: string): void {
  db.prepare(
    `
    UPDATE tasks
    SET status = 'failed', error = ?, completed_at = ?, result = NULL
    WHERE id = ?
  `,
  ).run(error, nowIso(), id);
}

export function cancelTask(db: HiveDatabase, id: string): boolean {
  const row = getTaskById(db, id);
  if (!row) {
    return false;
  }

  if (row.status !== "queued" && row.status !== "running") {
    return false;
  }

  markTaskFailed(db, id, "cancelled");
  return true;
}

export function clearCompletedTasks(db: HiveDatabase): number {
  const info = db.prepare("DELETE FROM tasks WHERE status IN ('done','failed')").run();
  return Number(info.changes ?? 0);
}
