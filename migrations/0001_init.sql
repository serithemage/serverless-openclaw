-- Serverless OpenClaw D1 Schema
-- Replaces 5 DynamoDB tables with relational SQLite tables

-- Conversations: stores chat message history
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram')),
  metadata TEXT, -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ttl INTEGER -- Unix timestamp for optional expiry
);
CREATE INDEX idx_conversations_user ON conversations(user_id, conversation_id, created_at DESC);

-- Settings: user preferences and Telegram link state
CREATE TABLE settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL, -- JSON string
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ttl INTEGER, -- Unix timestamp for optional expiry
  PRIMARY KEY (user_id, key)
);

-- Task state: container status per user (Cloudflare manages lifecycle,
-- but we still track logical state for the UI)
CREATE TABLE task_state (
  user_id TEXT PRIMARY KEY,
  container_id TEXT,
  status TEXT NOT NULL DEFAULT 'Idle' CHECK (status IN ('Idle', 'Starting', 'Running', 'Stopping')),
  started_at TEXT,
  last_activity TEXT,
  ttl INTEGER
);

-- Pending messages: queued during container cold start
CREATE TABLE pending_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram')),
  connection_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ttl INTEGER NOT NULL -- Unix timestamp
);
CREATE INDEX idx_pending_user ON pending_messages(user_id, created_at);
