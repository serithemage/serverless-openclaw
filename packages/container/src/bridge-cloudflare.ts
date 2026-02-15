/**
 * Bridge HTTP server for Cloudflare Containers.
 *
 * Simplified version that:
 *   - Receives messages via HTTP POST from Worker (for Telegram)
 *   - Returns responses synchronously (no callback URL needed)
 *   - Health check endpoint
 *   - Status endpoint
 *
 * WebSocket connections are handled separately by bridge-ws.ts.
 */

import express from "express";
import { createAuthMiddleware } from "./auth-middleware.js";

export interface CloudflareBridgeDeps {
  authToken: string;
  openclawClient: {
    sendMessage(userId: string, message: string): AsyncGenerator<string>;
    close(): void;
  };
  updateLastActivity: () => void;
  getLastActivity: () => Date;
  processStartTime: number;
  onMessageComplete?: (
    userId: string,
    userMsg: string,
    assistantMsg: string,
  ) => Promise<void>;
  getAndClearHistoryPrefix?: () => string;
}

const startTime = Date.now();

export function createApp(deps: CloudflareBridgeDeps): express.Express {
  const app = express();

  app.use(express.json());
  app.use(createAuthMiddleware(deps.authToken));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Synchronous message endpoint — collects full response and returns it.
  // Used by Worker for Telegram messages (no streaming needed for Telegram).
  app.post("/message", async (req, res) => {
    const body = req.body as {
      userId?: string;
      message?: string;
      channel?: string;
      connectionId?: string;
    };

    if (!body.userId || !body.message) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    deps.updateLastActivity();

    try {
      let prefix = deps.getAndClearHistoryPrefix?.() ?? "";
      if (body.channel === "telegram") {
        prefix +=
          "[System: Do not use markdown formatting (**bold**, *italic*, ```code``` etc). Respond in plain text.]\n";
      }
      const messageToSend = prefix ? prefix + body.message : body.message;

      const generator = deps.openclawClient.sendMessage(body.userId, messageToSend);
      let fullResponse = "";
      for await (const chunk of generator) {
        fullResponse += chunk;
      }

      // Save conversation (delegated to Worker via D1 in the new architecture)
      if (deps.onMessageComplete && fullResponse) {
        await deps.onMessageComplete(body.userId, body.message, fullResponse).catch(() => {});
      }

      res.json({ response: fullResponse });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  app.get("/status", (_req, res) => {
    res.json({
      status: "running",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      lastActivity: deps.getLastActivity().toISOString(),
    });
  });

  return app;
}
