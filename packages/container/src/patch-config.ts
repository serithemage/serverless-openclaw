import { readFileSync, writeFileSync } from "node:fs";
import { GATEWAY_PORT } from "@serverless-openclaw/shared";
import type { AiProvider } from "@serverless-openclaw/shared";

interface PatchOptions {
  llmModel?: string;
  aiProvider?: AiProvider;
  awsRegion?: string;
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

  // Remove Telegram section entirely (webhook-only, configured via env)
  delete config.telegram;

  // Remove LLM secrets, optionally override model
  config.llm = { ...config.llm };
  delete config.llm.apiKey;
  if (options?.llmModel) {
    config.llm.model = options.llmModel;
  }

  if (options?.aiProvider === "bedrock") {
    // Configure LLM for Bedrock
    config.llm.provider = "amazon-bedrock";
    config.llm.api = "bedrock-converse-stream";
    delete config.llm.apiKey;

    // Enable Bedrock model discovery
    config.models = {
      ...config.models,
      bedrockDiscovery: { enabled: true, region: options.awsRegion },
    };

    // OpenClaw EC2/Fargate workaround — signal that credentials are available via SDK chain
    process.env.AWS_PROFILE = "default";
  } else {
    // Anthropic or unset — disable Bedrock discovery
    config.models = {
      ...config.models,
      bedrockDiscovery: { enabled: false },
    };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
