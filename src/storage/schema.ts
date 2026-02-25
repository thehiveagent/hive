export const MESSAGE_ROLES = ["system", "user", "assistant"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface SchemaMigration {
  version: number;
  name: string;
  sql: string;
}

export const CURRENT_SCHEMA_VERSION = 7;

const initialSchemaSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  persona TEXT NOT NULL,
  dob TEXT,
  location TEXT,
  profession TEXT,
  about_raw TEXT,
  agent_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
`;

export const MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: "v1_initial_schema",
    sql: initialSchemaSql,
  },
  {
    version: 2,
    name: "v2_agents_profile_columns",
    sql: `
ALTER TABLE agents ADD COLUMN dob TEXT;
ALTER TABLE agents ADD COLUMN location TEXT;
ALTER TABLE agents ADD COLUMN profession TEXT;
ALTER TABLE agents ADD COLUMN about_raw TEXT;
ALTER TABLE agents ADD COLUMN agent_name TEXT;
`,
  },
  {
    version: 3,
    name: "v3_knowledge_graph",
    sql: `
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_created_at ON knowledge(created_at);
`,
  },
  {
    version: 4,
    name: "v4_episodes_and_pinned_knowledge",
    sql: `
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON episodes(created_at);

ALTER TABLE knowledge ADD COLUMN pinned INTEGER DEFAULT 0;
`,
  },
  {
    version: 5,
    name: "v5_knowledge_source_column",
    sql: `
ALTER TABLE knowledge ADD COLUMN source TEXT DEFAULT 'manual';
UPDATE knowledge SET source = 'manual' WHERE source IS NULL;
`,
  },
  {
    version: 6,
    name: "v6_tasks_table",
    sql: `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  result TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);
`,
  },
  {
    version: 7,
    name: "v7_platform_conversations",
    sql: `
CREATE TABLE IF NOT EXISTS platform_conversations (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  messages TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_conversations_platform_external_id
  ON platform_conversations(platform, external_id);
`,
  },
];

export interface MetaRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  provider: string;
  model: string;
  persona: string;
  dob: string | null;
  location: string | null;
  profession: string | null;
  about_raw: string | null;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationRecord {
  id: string;
  agent_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface KnowledgeRecord {
  id: string;
  content: string;
  created_at: string;
  pinned?: number | boolean;
  source?: string | null;
}

export interface EpisodeRecord {
  id: string;
  content: string;
  created_at: string;
}

export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  result: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  agent_id: string | null;
  error: string | null;
}

export interface PlatformConversationRecord {
  id: string;
  platform: string;
  external_id: string;
  messages: string | null;
  created_at: string;
  updated_at: string;
}
