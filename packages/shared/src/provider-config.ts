export type AiProvider = "anthropic" | "bedrock";

export interface ProviderConfig {
  provider: AiProvider;
  openclawProvider: string;
  openclawApi: string;
  openclawAuth: string;
  defaultModel: string;
  bedrockDiscovery: boolean;
}

export const PROVIDER_DEFAULTS = {
  anthropic: {
    openclawProvider: "anthropic",
    openclawApi: "anthropic",
    openclawAuth: "api-key",
    defaultModel: "claude-sonnet-4-20250514",
    bedrockDiscovery: false,
  },
  bedrock: {
    openclawProvider: "amazon-bedrock",
    openclawApi: "bedrock-converse-stream",
    openclawAuth: "aws-sdk",
    defaultModel: "anthropic.claude-sonnet-4-20250514-v1:0",
    bedrockDiscovery: true,
  },
} as const;

const VALID_PROVIDERS: readonly string[] = ["anthropic", "bedrock"];

export function validateProvider(value: string): asserts value is AiProvider {
  if (!VALID_PROVIDERS.includes(value)) {
    throw new Error(
      `Unsupported AI_PROVIDER: '${value}'. Valid values: anthropic, bedrock`,
    );
  }
}

export function resolveModel(provider: AiProvider, aiModel?: string): string {
  return aiModel || PROVIDER_DEFAULTS[provider].defaultModel;
}

export function resolveProviderConfig(
  env?: { AI_PROVIDER?: string; AI_MODEL?: string; AWS_REGION?: string },
): ProviderConfig {
  const resolved = env ?? process.env;
  const raw = resolved.AI_PROVIDER ?? "anthropic";
  validateProvider(raw);

  const defaults = PROVIDER_DEFAULTS[raw];
  return {
    provider: raw,
    openclawProvider: defaults.openclawProvider,
    openclawApi: defaults.openclawApi,
    openclawAuth: defaults.openclawAuth,
    defaultModel: resolveModel(raw, resolved.AI_MODEL),
    bedrockDiscovery: defaults.bedrockDiscovery,
  };
}
