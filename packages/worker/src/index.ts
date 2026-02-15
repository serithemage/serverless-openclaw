/**
 * Serverless OpenClaw — Cloudflare Worker
 *
 * Replaces: API Gateway (WebSocket + HTTP), 6 Lambda handlers, CDK stacks.
 *
 * Architecture:
 *   Client → Worker → Container (via Durable Object fetch)
 *   Telegram → Worker webhook → Container
 *
 * The Worker handles:
 *   - WebSocket connections (forwarded to per-user containers)
 *   - REST API (conversations, settings, Telegram linking)
 *   - Telegram webhook
 *   - Static asset serving (Web UI)
 */

import { getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env.js";
import { OpenClawContainer } from "./container.js";
import { verifyJwt, authenticateRequest } from "./services/auth.js";
import {
  getConversations,
  getTaskState,
  putTaskState,
  savePendingMessage,
  resolveUserId,
  generateOtp,
  verifyOtpAndLink,
  getLinkStatus,
  unlinkTelegram,
  cleanupExpired,
} from "./services/db.js";
import { sendTelegramMessage } from "./services/telegram.js";

// Re-export the Container class (required for Durable Object binding)
export { OpenClawContainer };

const app = new Hono<{ Bindings: Env }>();

// CORS for all API routes
app.use("/api/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] }));

// ──────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ status: "ok" }));

// ──────────────────────────────────────────────
// WebSocket — connect to per-user container
// ──────────────────────────────────────────────
app.get("/api/ws", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: "Missing token" }, 401);
  }

  // Verify JWT
  let userId: string;
  try {
    const payload = await verifyJwt(
      token,
      c.env.COGNITO_ISSUER,
      c.env.COGNITO_CLIENT_ID,
    );
    userId = payload.sub;
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }

  // Get or create the user's container
  const container = getContainer(c.env.OPENCLAW_CONTAINER, userId);

  // Start the container with user-specific env vars
  await container.startAndWaitForPorts({
    envVars: {
      USER_ID: userId,
      BRIDGE_AUTH_TOKEN: c.env.BRIDGE_AUTH_TOKEN,
      OPENCLAW_GATEWAY_TOKEN: c.env.OPENCLAW_GATEWAY_TOKEN,
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
      TELEGRAM_BOT_TOKEN: c.env.TELEGRAM_BOT_TOKEN || "",
    },
  });

  // Update task state
  await putTaskState(c.env.DB, userId, "Running");

  // Forward the WebSocket upgrade request to the container's Bridge server
  // The Bridge server needs a WebSocket endpoint — see adapted container code
  const containerUrl = new URL(c.req.url);
  containerUrl.pathname = "/ws";
  containerUrl.searchParams.set("userId", userId);

  const upgradeRequest = new Request(containerUrl.toString(), {
    headers: c.req.raw.headers,
  });

  return container.fetch(upgradeRequest);
});

// ──────────────────────────────────────────────
// REST API — Authenticated endpoints
// ──────────────────────────────────────────────

// Middleware: extract userId from JWT
app.use("/api/v1/*", async (c, next) => {
  const userId = await authenticateRequest(
    c.req.raw,
    c.env.COGNITO_ISSUER,
    c.env.COGNITO_CLIENT_ID,
  );
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId" as never, userId);
  await next();
});

// GET /api/v1/conversations
app.get("/api/v1/conversations", async (c) => {
  const userId = c.get("userId" as never) as string;
  const items = await getConversations(c.env.DB, userId);
  return c.json(items);
});

// GET /api/v1/status
app.get("/api/v1/status", async (c) => {
  const userId = c.get("userId" as never) as string;
  const state = await getTaskState(c.env.DB, userId);
  return c.json(state ?? { status: "Idle" });
});

// POST /api/v1/message — send message to container (REST fallback)
app.post("/api/v1/message", async (c) => {
  const userId = c.get("userId" as never) as string;
  const body = await c.req.json<{ message: string }>();

  if (!body.message) {
    return c.json({ error: "Missing message" }, 400);
  }

  // Get or create the user's container
  const container = getContainer(c.env.OPENCLAW_CONTAINER, userId);

  try {
    await container.startAndWaitForPorts({
      envVars: {
        USER_ID: userId,
        BRIDGE_AUTH_TOKEN: c.env.BRIDGE_AUTH_TOKEN,
        OPENCLAW_GATEWAY_TOKEN: c.env.OPENCLAW_GATEWAY_TOKEN,
        ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
        TELEGRAM_BOT_TOKEN: c.env.TELEGRAM_BOT_TOKEN || "",
      },
    });

    await putTaskState(c.env.DB, userId, "Running");

    // Forward message to Bridge server
    const bridgeRequest = new Request("http://container/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.BRIDGE_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        userId,
        message: body.message,
        channel: "web",
        connectionId: `rest:${userId}`,
      }),
    });

    return container.fetch(bridgeRequest);
  } catch {
    // Container not running — queue the message
    await savePendingMessage(c.env.DB, userId, body.message, "web", `rest:${userId}`);
    await putTaskState(c.env.DB, userId, "Starting");
    return c.json({ status: "queued" });
  }
});

// POST /api/v1/link/generate-otp
app.post("/api/v1/link/generate-otp", async (c) => {
  const userId = c.get("userId" as never) as string;
  const code = await generateOtp(c.env.DB, userId);
  return c.json({ code });
});

// GET /api/v1/link/status
app.get("/api/v1/link/status", async (c) => {
  const userId = c.get("userId" as never) as string;
  const status = await getLinkStatus(c.env.DB, userId);
  return c.json(status);
});

// POST /api/v1/link/unlink
app.post("/api/v1/link/unlink", async (c) => {
  const userId = c.get("userId" as never) as string;
  await unlinkTelegram(c.env.DB, userId);
  return c.json({ success: true });
});

// ──────────────────────────────────────────────
// Telegram Webhook
// ──────────────────────────────────────────────
app.post("/api/telegram/webhook", async (c) => {
  // Verify secret token
  const secretToken = c.req.header("x-telegram-bot-api-secret-token");
  if (!secretToken || secretToken !== c.env.TELEGRAM_SECRET_TOKEN) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const update = await c.req.json<{
    message?: {
      chat: { id: number };
      from?: { id: number };
      text?: string;
    };
  }>();

  if (!update.message?.text) {
    return c.text("OK");
  }

  const chatId = update.message.chat.id;
  const telegramId = String(update.message.from?.id ?? chatId);
  const rawUserId = `telegram:${telegramId}`;
  const text = update.message.text;
  const botToken = c.env.TELEGRAM_BOT_TOKEN;

  // Handle /link command
  if (text.startsWith("/link ")) {
    const code = text.slice(6).trim();
    if (!/^\d{6}$/.test(code)) {
      if (botToken) {
        await sendTelegramMessage(botToken, String(chatId), "Usage: /link {6-digit code}");
      }
      return c.text("OK");
    }
    const result = await verifyOtpAndLink(c.env.DB, telegramId, code);
    if (botToken) {
      const msg =
        "error" in result
          ? `❌ ${result.error}`
          : "✅ Account linked! Web and Telegram now share the same container.";
      await sendTelegramMessage(botToken, String(chatId), msg);
    }
    return c.text("OK");
  }

  // Handle /unlink command
  if (text === "/unlink") {
    if (botToken) {
      await sendTelegramMessage(
        botToken,
        String(chatId),
        "Unlinking is only available from the web UI settings.",
      );
    }
    return c.text("OK");
  }

  // Resolve telegram userId to linked cognito userId
  const userId = await resolveUserId(c.env.DB, rawUserId);

  // Get or create the user's container
  const container = getContainer(c.env.OPENCLAW_CONTAINER, userId);

  try {
    const telegramChatId = userId !== rawUserId ? String(chatId) : undefined;

    await container.startAndWaitForPorts({
      envVars: {
        USER_ID: userId,
        BRIDGE_AUTH_TOKEN: c.env.BRIDGE_AUTH_TOKEN,
        OPENCLAW_GATEWAY_TOKEN: c.env.OPENCLAW_GATEWAY_TOKEN,
        ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
        TELEGRAM_BOT_TOKEN: botToken || "",
        ...(telegramChatId ? { TELEGRAM_CHAT_ID: telegramChatId } : {}),
      },
    });

    await putTaskState(c.env.DB, userId, "Running");

    // Forward message to Bridge server
    const bridgeRequest = new Request("http://container/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.BRIDGE_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        userId,
        message: text,
        channel: "telegram",
        connectionId: `telegram:${chatId}`,
      }),
    });

    const response = await container.fetch(bridgeRequest);
    const result = await response.json<{ response?: string }>();

    // Send response back to Telegram
    if (result.response && botToken) {
      await sendTelegramMessage(botToken, String(chatId), result.response);
    }
  } catch {
    // Container failed — queue message
    await savePendingMessage(
      c.env.DB,
      userId,
      text,
      "telegram",
      `telegram:${chatId}`,
    );
    await putTaskState(c.env.DB, userId, "Starting");

    if (botToken) {
      await sendTelegramMessage(
        botToken,
        String(chatId),
        "🔄 Waking up the agent... please wait a moment.",
      );
    }
  }

  return c.text("OK");
});

// ──────────────────────────────────────────────
// Container status endpoint (for direct container queries)
// ──────────────────────────────────────────────
app.get("/api/container/:userId/status", async (c) => {
  const userId = c.req.param("userId");
  const container = getContainer(c.env.OPENCLAW_CONTAINER, userId);
  try {
    const state = await container.getState();
    return c.json({ status: state });
  } catch {
    return c.json({ status: "unknown" });
  }
});

// ──────────────────────────────────────────────
// Scheduled handler — cleanup expired records
// ──────────────────────────────────────────────
// To use, add to wrangler.jsonc:
//   "triggers": { "crons": ["*/5 * * * *"] }

// ──────────────────────────────────────────────
// Fallback — serve static assets (Web UI)
// ──────────────────────────────────────────────
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// Export the Worker
export default {
  fetch: app.fetch,

  // Scheduled event handler (replaces EventBridge + Watchdog Lambda)
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
  ): Promise<void> {
    await cleanupExpired(env.DB);
  },
};
