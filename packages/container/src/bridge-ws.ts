/**
 * WebSocket handler for the Bridge server.
 *
 * In the Cloudflare Containers architecture, the Worker forwards WebSocket
 * connections directly to the container. This handler manages the WebSocket
 * lifecycle and routes messages to the OpenClaw client.
 *
 * Protocol (same as the existing WebSocket protocol):
 *   Client → { action: "sendMessage", message: "..." }
 *   Client → { action: "getStatus" }
 *   Server → { type: "stream_chunk", content: "..." }
 *   Server → { type: "stream_end" }
 *   Server → { type: "status", status: "Running" }
 *   Server → { type: "error", error: "..." }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

interface BridgeWsDeps {
  openclawClient: {
    sendMessage(userId: string, message: string): AsyncGenerator<string>;
  };
  onMessageComplete?: (
    userId: string,
    userMsg: string,
    assistantMsg: string,
  ) => Promise<void>;
  getAndClearHistoryPrefix?: () => string;
  updateLastActivity: () => void;
}

interface ClientMessage {
  action: "sendMessage" | "getStatus" | "ping";
  message?: string;
}

export function attachWebSocketHandler(
  server: Server,
  deps: BridgeWsDeps,
): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req) => {
    // Extract userId from query params (set by Worker)
    const url = new URL(req.url ?? "/", "http://localhost");
    const userId = url.searchParams.get("userId") ?? "unknown";

    console.log(`[ws] Client connected: ${userId}`);
    deps.updateLastActivity();

    // Send initial status
    ws.send(JSON.stringify({ type: "status", status: "Running" }));

    ws.on("message", (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
        return;
      }

      deps.updateLastActivity();

      if (msg.action === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.action === "getStatus") {
        ws.send(JSON.stringify({ type: "status", status: "Running" }));
        return;
      }

      if (msg.action === "sendMessage" && msg.message) {
        void processMessage(ws, userId, msg.message, deps);
        return;
      }

      ws.send(JSON.stringify({ type: "error", error: "Unknown action" }));
    });

    ws.on("close", () => {
      console.log(`[ws] Client disconnected: ${userId}`);
    });

    ws.on("error", (err) => {
      console.error(`[ws] WebSocket error for ${userId}:`, err);
    });
  });

  console.log("[ws] WebSocket handler attached at /ws");
}

async function processMessage(
  ws: WebSocket,
  userId: string,
  message: string,
  deps: BridgeWsDeps,
): Promise<void> {
  try {
    // Prepend history context if available
    const prefix = deps.getAndClearHistoryPrefix?.() ?? "";
    const messageToSend = prefix ? prefix + message : message;

    const generator = deps.openclawClient.sendMessage(userId, messageToSend);
    let fullResponse = "";

    for await (const chunk of generator) {
      fullResponse += chunk;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stream_chunk", content: chunk }));
      }
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stream_end" }));
    }

    // Save conversation
    if (deps.onMessageComplete && fullResponse) {
      await deps.onMessageComplete(userId, message, fullResponse).catch(() => {});
    }
  } catch (err) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        }),
      );
    }
  }
}
