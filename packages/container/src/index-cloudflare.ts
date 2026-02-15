/**
 * Cloudflare Container entry point.
 *
 * Replaces the AWS Fargate entry point (index.ts).
 * Key differences:
 *   - No AWS SDK (no DynamoDB, S3, ECS, EC2)
 *   - No public IP discovery (Worker handles routing)
 *   - No callback sender (WebSocket is forwarded directly)
 *   - No S3 sync (workspace is ephemeral or uses R2 via mounted volume)
 *   - WebSocket endpoint added to Bridge server
 *   - Simplified lifecycle (container managed by Cloudflare)
 */

import * as net from "net";
import { BRIDGE_PORT } from "@serverless-openclaw/shared";
import { createApp } from "./bridge-cloudflare.js";
import { OpenClawClient } from "./openclaw-client.js";
import { attachWebSocketHandler } from "./bridge-ws.js";

const REQUIRED_ENV = [
  "BRIDGE_AUTH_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "USER_ID",
] as const;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function tryConnect(): void {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    }
    tryConnect();
  });
}

async function notifyTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Best-effort notification
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();

  // Validate required env vars
  const env = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, requireEnv(name)]),
  ) as Record<(typeof REQUIRED_ENV)[number], string>;

  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const gatewayUrl = "ws://localhost:18789";

  if (telegramChatId) {
    await notifyTelegram(telegramChatId, "⚡ Container starting. Connecting to AI engine...");
  }

  // Wait for OpenClaw Gateway to be ready (up to 120s for cold start)
  await waitForPort(18789, 120000);
  const tGateway = Date.now();

  // Initialize OpenClaw client
  const openclawClient = new OpenClawClient(gatewayUrl, env.OPENCLAW_GATEWAY_TOKEN);
  await openclawClient.waitForReady();
  const tClient = Date.now();

  if (telegramChatId) {
    await notifyTelegram(telegramChatId, "✅ Ready! Processing messages...");
  }

  // Track last activity for status
  let lastActivity = new Date();
  const updateLastActivity = (): void => {
    lastActivity = new Date();
  };

  // Create Bridge HTTP server (for Telegram and REST messages from Worker)
  const app = createApp({
    authToken: env.BRIDGE_AUTH_TOKEN,
    openclawClient,
    updateLastActivity,
    getLastActivity: () => lastActivity,
    processStartTime: t0,
    onMessageComplete: async () => {
      // In Cloudflare architecture, conversation storage is handled by the Worker
      // via D1 after the response is received. No-op here.
    },
  });

  const server = app.listen(BRIDGE_PORT, "0.0.0.0", () => {
    console.log(`Bridge server listening on port ${BRIDGE_PORT}`);
  });

  // Attach WebSocket handler for direct client connections (forwarded by Worker)
  attachWebSocketHandler(server, {
    openclawClient,
    updateLastActivity,
    onMessageComplete: async () => {
      // Conversation storage handled by Worker
    },
  });

  const tRunning = Date.now();
  console.log(
    `Startup complete in ${tRunning - t0}ms (Gateway: ${tGateway - t0}ms, Client: ${tClient - tGateway}ms)`,
  );

  // SIGTERM handler for graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    server.close(() => {
      openclawClient.close();
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
