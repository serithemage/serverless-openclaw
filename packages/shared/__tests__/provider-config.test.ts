import { describe, it, expect } from "vitest";
import {
  resolveCrisPrefix,
  resolveBedrockModel,
  resolveProviderConfig,
  BEDROCK_BASE_MODEL,
} from "../src/provider-config.js";

describe("resolveCrisPrefix", () => {
  it("returns 'eu' for eu-central-1", () => {
    expect(resolveCrisPrefix("eu-central-1")).toBe("eu");
  });

  it("returns 'eu' for eu-west-1", () => {
    expect(resolveCrisPrefix("eu-west-1")).toBe("eu");
  });

  it("returns 'eu' for eu-west-2", () => {
    expect(resolveCrisPrefix("eu-west-2")).toBe("eu");
  });

  it("returns 'eu' for eu-north-1", () => {
    expect(resolveCrisPrefix("eu-north-1")).toBe("eu");
  });

  it("returns 'us' for us-east-1", () => {
    expect(resolveCrisPrefix("us-east-1")).toBe("us");
  });

  it("returns 'us' for us-west-2", () => {
    expect(resolveCrisPrefix("us-west-2")).toBe("us");
  });

  it("returns 'us' for ca-central-1", () => {
    expect(resolveCrisPrefix("ca-central-1")).toBe("us");
  });

  it("returns 'apac' for ap-northeast-1", () => {
    expect(resolveCrisPrefix("ap-northeast-1")).toBe("apac");
  });

  it("returns 'apac' for ap-southeast-2", () => {
    expect(resolveCrisPrefix("ap-southeast-2")).toBe("apac");
  });

  it("returns 'apac' for ap-south-1", () => {
    expect(resolveCrisPrefix("ap-south-1")).toBe("apac");
  });

  it("returns undefined for unknown region", () => {
    expect(resolveCrisPrefix("sa-east-1")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(resolveCrisPrefix(undefined)).toBeUndefined();
  });
});

describe("resolveBedrockModel", () => {
  it("returns eu-prefixed model for eu-central-1", () => {
    expect(resolveBedrockModel("eu-central-1")).toBe(
      `eu.${BEDROCK_BASE_MODEL}`,
    );
  });

  it("returns us-prefixed model for us-east-1", () => {
    expect(resolveBedrockModel("us-east-1")).toBe(`us.${BEDROCK_BASE_MODEL}`);
  });

  it("returns apac-prefixed model for ap-northeast-1", () => {
    expect(resolveBedrockModel("ap-northeast-1")).toBe(
      `apac.${BEDROCK_BASE_MODEL}`,
    );
  });

  it("returns base model for unknown region (no CRIS prefix)", () => {
    expect(resolveBedrockModel("sa-east-1")).toBe(BEDROCK_BASE_MODEL);
  });

  it("returns base model when region is undefined", () => {
    expect(resolveBedrockModel(undefined)).toBe(BEDROCK_BASE_MODEL);
  });

  it("returns AI_MODEL override as-is regardless of region", () => {
    expect(resolveBedrockModel("eu-central-1", "my-custom-model")).toBe(
      "my-custom-model",
    );
  });

  it("returns AI_MODEL override even for unknown region", () => {
    expect(resolveBedrockModel("sa-east-1", "my-custom-model")).toBe(
      "my-custom-model",
    );
  });

  it("ignores empty string AI_MODEL and uses region resolution", () => {
    expect(resolveBedrockModel("eu-central-1", "")).toBe(
      `eu.${BEDROCK_BASE_MODEL}`,
    );
  });
});

describe("resolveProviderConfig", () => {
  it("resolves bedrock model with CRIS prefix from AWS_REGION", () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: "bedrock",
      AWS_REGION: "eu-central-1",
    });
    expect(config.defaultModel).toBe(`eu.${BEDROCK_BASE_MODEL}`);
    expect(config.openclawProvider).toBe("amazon-bedrock");
    expect(config.openclawApi).toBe("bedrock-converse-stream");
  });

  it("uses AI_MODEL override over region resolution for bedrock", () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: "bedrock",
      AWS_REGION: "eu-central-1",
      AI_MODEL: "custom-model-id",
    });
    expect(config.defaultModel).toBe("custom-model-id");
  });

  it("falls back to base model for bedrock with unknown region", () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: "bedrock",
      AWS_REGION: "sa-east-1",
    });
    expect(config.defaultModel).toBe(BEDROCK_BASE_MODEL);
  });

  it("resolves anthropic defaults correctly", () => {
    const config = resolveProviderConfig({ AI_PROVIDER: "anthropic" });
    expect(config.openclawProvider).toBe("anthropic");
    expect(config.openclawApi).toBe("anthropic");
    expect(config.defaultModel).toBe("claude-sonnet-4-20250514");
  });

  it("applies AI_MODEL override for anthropic", () => {
    const config = resolveProviderConfig({
      AI_PROVIDER: "anthropic",
      AI_MODEL: "claude-opus-4-20250514",
    });
    expect(config.defaultModel).toBe("claude-opus-4-20250514");
  });

  it("defaults to anthropic when AI_PROVIDER is not set", () => {
    const config = resolveProviderConfig({});
    expect(config.provider).toBe("anthropic");
  });

  it("does not expose bedrockDiscovery on the config object", () => {
    const config = resolveProviderConfig({ AI_PROVIDER: "bedrock" });
    expect(config).not.toHaveProperty("bedrockDiscovery");
  });
});
