import { Container } from "@cloudflare/containers";
import type { Env } from "./env.js";

/**
 * OpenClawContainer — Cloudflare Container class for running the Bridge + OpenClaw Gateway.
 *
 * Each user gets their own container instance (identified by userId).
 * The container runs the same Docker image as the previous Fargate task:
 *   - Bridge server on port 8080
 *   - OpenClaw Gateway on port 18789 (internal)
 *
 * The Worker forwards HTTP and WebSocket requests to port 8080 via container.fetch().
 */
export class OpenClawContainer extends Container<Env> {
  // Bridge server port
  defaultPort = 8080;

  // Sleep after 15 minutes of inactivity (matches previous INACTIVITY_TIMEOUT_MS)
  sleepAfter = "15m";

  // Environment variables injected at class level (overridden per-instance in Worker)
  envVars = {};

  override onStart(): void {
    console.log("[container] OpenClaw container started");
  }

  override onStop(): void {
    console.log("[container] OpenClaw container stopped");
  }

  override onError(error: unknown): void {
    console.error("[container] OpenClaw container error:", error);
  }
}
