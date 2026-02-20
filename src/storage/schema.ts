export const MESSAGE_ROLES = ["system", "user", "assistant"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface SchemaMigration {
  version: number;
  name: string;
  sql: string;
}

export const CURRENT_SCHEMA_VERSION = 1;

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
