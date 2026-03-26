import fs from "node:fs";
import path from "node:path";
import type { AiProvider } from "@serverless-openclaw/shared";
import type { ConfigInitResult } from "./types.js";

interface InitConfigOptions {
  anthropicApiKey?: string;
  provider?: AiProvider;
  awsRegion?: string;
}

/**
 * Initialize OpenClaw config and directory structure in $HOME/.openclaw.
 * Sets HOME=/tmp in Lambda so OpenClaw reads from /tmp/.openclaw/.
 *
 * Idempotent — safe to call multiple times.
 */
export async function initConfig(
  options?: InitConfigOptions,
): Promise<ConfigInitResult> {
  const home = process.env.HOME ?? "/tmp";
  const configDir = path.join(home, ".openclaw");
  const sessionsDir = path.join(configDir, "agents", "default", "sessions");

  // Create directory structure
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Write minimal config optimized for Lambda execution:
  // - gateway.mode: "local" — no WS server needed
  // - models.bedrockDiscovery: enabled only when using Bedrock provider
  const configPath = path.join(configDir, "openclaw.json");
  const isBedrock = options?.provider === "bedrock";
  const bedrockDiscovery = isBedrock
    ? { enabled: true, region: options.awsRegion }
    : { enabled: false };
  const config = {
    gateway: { mode: "local" },
    models: { bedrockDiscovery },
  };
  fs.writeFileSync(configPath, JSON.stringify(config), "utf-8");

  // Set API key via environment variable (OpenClaw reads from env)
  // Skip when using Bedrock — it authenticates via IAM role credentials
  if (!isBedrock && options?.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
  }

  return { configDir, sessionsDir };
}
