import { readFileSync, writeFileSync } from "node:fs";
import { GATEWAY_PORT, resolveProviderConfig } from "@serverless-openclaw/shared";
import type { AiProvider } from "@serverless-openclaw/shared";

interface PatchOptions {
  llmModel?: string;
  aiProvider?: AiProvider;
  awsRegion?: string;
  workspacePath?: string;
}

export function patchConfig(configPath: string, options?: PatchOptions): void {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as Record<string, Record<string, unknown>>;

  // Set gateway port
  config.gateway = { ...config.gateway, port: GATEWAY_PORT };

  // Remove auth secrets from config (API keys delivered via env vars only)
  if (config.auth) {
    delete config.auth.token;
  }

  // Remove legacy llm section — not a valid OpenClaw v2026+ key, may contain secrets
  delete config.llm;

  // Remove Telegram section entirely (webhook-only, configured via env)
  delete config.telegram;

  // Disable Bedrock model discovery — model is set explicitly, discovery scans ~56s
  config.models = {
    ...config.models,
    bedrockDiscovery: { enabled: false },
  };

  if (options?.aiProvider === "bedrock") {
    // Signal that AWS credentials are available via SDK chain (EC2/Fargate IAM role)
    process.env.AWS_PROFILE = "default";
  }

  // Set agent defaults (model and workspace)
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const defaults = (agents.defaults ?? {}) as Record<string, unknown>;

  // Set model in OpenClaw's provider/model format (e.g. "amazon-bedrock/eu.anthropic...")
  if (options?.aiProvider || options?.llmModel) {
    const providerConfig = resolveProviderConfig({
      AI_PROVIDER: options.aiProvider,
      AI_MODEL: options.llmModel,
      AWS_REGION: options.awsRegion,
    });
    defaults.model = { primary: `${providerConfig.openclawProvider}/${providerConfig.defaultModel}` };
  }

  if (options?.workspacePath) {
    defaults.workspace = options.workspacePath;
  }

  agents.defaults = defaults;
  config.agents = agents;

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

// CLI entry point: node patch-config.js <configPath>
if (process.argv[1]?.endsWith("patch-config.js")) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: node patch-config.js <configPath>");
    process.exit(1);
  }
  const aiProvider = (process.env.AI_PROVIDER as AiProvider) ?? undefined;
  const llmModel = process.env.AI_MODEL ?? undefined;
  const awsRegion = process.env.AWS_REGION ?? undefined;
  const workspacePath = process.env.OPENCLAW_WORKSPACE ?? "/data/workspace";
  patchConfig(configPath, { aiProvider, llmModel, awsRegion, workspacePath });
  console.log("[patch-config] Config patched successfully");
}
