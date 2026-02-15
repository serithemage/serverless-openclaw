/**
 * D1 database service layer — replaces DynamoDB operations.
 */

// === Conversations ===

export interface ConversationRow {
  id: number;
  user_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  channel: "web" | "telegram";
  metadata: string | null;
  created_at: string;
}

export async function getConversations(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<ConversationRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all<ConversationRow>();
  return result.results;
}

export async function saveConversation(
  db: D1Database,
  userId: string,
  role: "user" | "assistant",
  content: string,
  channel: "web" | "telegram",
  conversationId = "default",
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO conversations (user_id, conversation_id, role, content, channel) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(userId, conversationId, role, content, channel)
    .run();
}

export async function saveMessagePair(
  db: D1Database,
  userId: string,
  userMsg: string,
  assistantMsg: string,
  channel: "web" | "telegram",
): Promise<void> {
  const batch = [
    db
      .prepare(
        "INSERT INTO conversations (user_id, role, content, channel) VALUES (?, 'user', ?, ?)",
      )
      .bind(userId, userMsg, channel),
    db
      .prepare(
        "INSERT INTO conversations (user_id, role, content, channel) VALUES (?, 'assistant', ?, ?)",
      )
      .bind(userId, assistantMsg, channel),
  ];
  await db.batch(batch);
}

// === Settings ===

export interface SettingRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export async function getSetting(
  db: D1Database,
  userId: string,
  key: string,
): Promise<SettingRow | null> {
  return db
    .prepare("SELECT * FROM settings WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .first<SettingRow>();
}

export async function putSetting(
  db: D1Database,
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .bind(userId, key, value)
    .run();
}

export async function deleteSetting(
  db: D1Database,
  userId: string,
  key: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM settings WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .run();
}

// === Task State ===

export interface TaskStateRow {
  user_id: string;
  container_id: string | null;
  status: "Idle" | "Starting" | "Running" | "Stopping";
  started_at: string | null;
  last_activity: string | null;
}

export async function getTaskState(
  db: D1Database,
  userId: string,
): Promise<TaskStateRow | null> {
  return db
    .prepare("SELECT * FROM task_state WHERE user_id = ?")
    .bind(userId)
    .first<TaskStateRow>();
}

export async function putTaskState(
  db: D1Database,
  userId: string,
  status: string,
  containerId?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO task_state (user_id, container_id, status, started_at, last_activity)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .bind(userId, containerId ?? null, status)
    .run();
}

// === Pending Messages ===

export interface PendingMessageRow {
  id: number;
  user_id: string;
  message: string;
  channel: "web" | "telegram";
  connection_id: string;
  created_at: string;
}

export async function savePendingMessage(
  db: D1Database,
  userId: string,
  message: string,
  channel: "web" | "telegram",
  connectionId: string,
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 300; // 5 minute TTL
  await db
    .prepare(
      "INSERT INTO pending_messages (user_id, message, channel, connection_id, ttl) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(userId, message, channel, connectionId, ttl)
    .run();
}

export async function consumePendingMessages(
  db: D1Database,
  userId: string,
): Promise<PendingMessageRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      "SELECT * FROM pending_messages WHERE user_id = ? AND ttl > ? ORDER BY created_at ASC",
    )
    .bind(userId, now)
    .all<PendingMessageRow>();

  // Delete consumed messages
  if (result.results.length > 0) {
    await db
      .prepare("DELETE FROM pending_messages WHERE user_id = ? AND ttl > ?")
      .bind(userId, now)
      .run();
  }

  return result.results;
}

// === Identity (Telegram Linking) ===

export async function resolveUserId(
  db: D1Database,
  userId: string,
): Promise<string> {
  if (!userId.startsWith("telegram:")) return userId;

  const row = await getSetting(db, userId, "linked-cognito");
  if (row) {
    const parsed = JSON.parse(row.value) as { cognitoUserId: string };
    return parsed.cognitoUserId;
  }
  return userId;
}

export async function generateOtp(
  db: D1Database,
  cognitoUserId: string,
): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const ttl = Math.floor(Date.now() / 1000) + 300;

  // Store OTP for the cognito user
  await putSetting(db, cognitoUserId, "telegram-otp", JSON.stringify({ code }));

  // Store reverse lookup by OTP code
  await db
    .prepare(
      "INSERT OR REPLACE INTO settings (user_id, key, value, updated_at, ttl) VALUES (?, ?, ?, datetime('now'), ?)",
    )
    .bind(`otp:${code}`, "otp-owner", JSON.stringify({ cognitoUserId }), ttl)
    .run();

  return code;
}

export async function verifyOtpAndLink(
  db: D1Database,
  telegramUserId: string,
  code: string,
): Promise<{ cognitoUserId: string } | { error: string }> {
  const telegramKey = `telegram:${telegramUserId}`;

  // 1. Look up OTP to find cognitoUserId
  const otpRow = await getSetting(db, `otp:${code}`, "otp-owner");
  if (!otpRow) {
    return { error: "OTP expired or invalid." };
  }

  const otpOwner = JSON.parse(otpRow.value) as { cognitoUserId: string };
  const cognitoUserId = otpOwner.cognitoUserId;

  // 2. Check if telegram user has a running container
  const taskState = await getTaskState(db, telegramKey);
  if (taskState && taskState.status !== "Idle") {
    return { error: "Telegram container is running. Please try again in ~15 minutes." };
  }

  // 3. Check if telegram is already linked to a different account
  const existingLink = await getSetting(db, telegramKey, "linked-cognito");
  if (existingLink) {
    const existing = JSON.parse(existingLink.value) as { cognitoUserId: string };
    if (existing.cognitoUserId !== cognitoUserId) {
      return { error: "This Telegram account is already linked to another account." };
    }
  }

  // 4. Consume OTP (delete reverse lookup)
  await deleteSetting(db, `otp:${code}`, "otp-owner");

  // 5. Create bilateral links
  await putSetting(
    db,
    cognitoUserId,
    "linked-telegram",
    JSON.stringify({ telegramUserId }),
  );
  await putSetting(
    db,
    telegramKey,
    "linked-cognito",
    JSON.stringify({ cognitoUserId }),
  );

  // 6. Clean up OTP record
  await deleteSetting(db, cognitoUserId, "telegram-otp");

  return { cognitoUserId };
}

export async function getLinkStatus(
  db: D1Database,
  cognitoUserId: string,
): Promise<{ linked: boolean; telegramUserId?: string }> {
  const row = await getSetting(db, cognitoUserId, "linked-telegram");
  if (row) {
    const parsed = JSON.parse(row.value) as { telegramUserId: string };
    return { linked: true, telegramUserId: parsed.telegramUserId };
  }
  return { linked: false };
}

export async function unlinkTelegram(
  db: D1Database,
  cognitoUserId: string,
): Promise<void> {
  const row = await getSetting(db, cognitoUserId, "linked-telegram");
  if (!row) return;

  const parsed = JSON.parse(row.value) as { telegramUserId: string };

  // Delete bilateral links
  await deleteSetting(db, cognitoUserId, "linked-telegram");
  await deleteSetting(db, `telegram:${parsed.telegramUserId}`, "linked-cognito");
}

// === Cleanup expired records ===

export async function cleanupExpired(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare("DELETE FROM pending_messages WHERE ttl < ?").bind(now),
    db.prepare("DELETE FROM settings WHERE ttl IS NOT NULL AND ttl < ?").bind(now),
  ]);
}
