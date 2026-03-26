export type AiProvider = "anthropic" | "bedrock";

export interface ProviderConfig {
  provider: AiProvider;
  openclawProvider: string;
  openclawApi: string;
  openclawAuth: string;
  defaultModel: string;
}

// Base Bedrock model ID (without CRIS prefix)
export const BEDROCK_BASE_MODEL = "anthropic.claude-sonnet-4-20250514-v1:0";

// Maps AWS region → cross-region inference system (CRIS) geographic prefix.
// Bedrock uses these prefixes to route requests within a geographic boundary.
// Regions not listed here have no CRIS support — base model ID is used directly.
const REGION_CRIS_PREFIX: Record<string, string> = {
  // United States
  "us-east-1": "us",
  "us-east-2": "us",
  "us-west-1": "us",
  "us-west-2": "us",
  "ca-central-1": "us",
  "ca-west-1": "us",
  // Europe
  "eu-central-1": "eu",
  "eu-west-1": "eu",
  "eu-west-2": "eu",
  "eu-west-3": "eu",
  "eu-north-1": "eu",
  "eu-south-1": "eu",
  "eu-south-2": "eu",
  // Asia Pacific
  "ap-northeast-1": "apac",
  "ap-northeast-2": "apac",
  "ap-northeast-3": "apac",
  "ap-south-1": "apac",
  "ap-south-2": "apac",
  "ap-southeast-1": "apac",
  "ap-southeast-2": "apac",
  "ap-southeast-3": "apac",
  "ap-southeast-4": "apac",
  "ap-southeast-5": "apac",
  "ap-southeast-7": "apac",
};

export const PROVIDER_DEFAULTS = {
  anthropic: {
    openclawProvider: "anthropic",
    openclawApi: "anthropic",
    openclawAuth: "api-key",
    defaultModel: "claude-sonnet-4-20250514",
  },
  bedrock: {
    openclawProvider: "amazon-bedrock",
    openclawApi: "bedrock-converse-stream",
    openclawAuth: "aws-sdk",
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

/**
 * Returns the CRIS geographic prefix for a given AWS region, or undefined
 * if the region does not have a cross-region inference system prefix.
 */
export function resolveCrisPrefix(region?: string): string | undefined {
  if (!region) return undefined;
  return REGION_CRIS_PREFIX[region];
}

/**
 * Resolves the Bedrock model ID to use:
 * - If aiModel is explicitly set, returns it as-is (caller's responsibility to use correct format)
 * - Otherwise, prepends the CRIS geographic prefix for the given region
 * - Falls back to the base model ID for regions without CRIS support
 */
export function resolveBedrockModel(region?: string, aiModel?: string): string {
  if (aiModel) return aiModel;
  const prefix = resolveCrisPrefix(region);
  return prefix ? `${prefix}.${BEDROCK_BASE_MODEL}` : BEDROCK_BASE_MODEL;
}

export function resolveModel(provider: "anthropic", aiModel?: string): string {
  return aiModel || PROVIDER_DEFAULTS[provider].defaultModel;
}

export function resolveProviderConfig(
  env?: { AI_PROVIDER?: string; AI_MODEL?: string; AWS_REGION?: string },
): ProviderConfig {
  const resolved = env ?? process.env;
  const raw = resolved.AI_PROVIDER ?? "anthropic";
  validateProvider(raw);

  const defaults = PROVIDER_DEFAULTS[raw];

  const defaultModel =
    raw === "bedrock"
      ? resolveBedrockModel(resolved.AWS_REGION, resolved.AI_MODEL)
      : resolveModel(raw, resolved.AI_MODEL);

  return {
    provider: raw,
    openclawProvider: defaults.openclawProvider,
    openclawApi: defaults.openclawApi,
    openclawAuth: defaults.openclawAuth,
    defaultModel,
  };
}
