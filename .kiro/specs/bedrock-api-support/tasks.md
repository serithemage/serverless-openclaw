# Implementation Plan: Bedrock API Support

## Overview

Add Amazon Bedrock as an alternative AI provider alongside Anthropic. Implementation proceeds bottom-up: shared provider config module → Lambda path (config-init, handler, agent-runner) → Fargate path (patch-config) → CDK infrastructure (IAM, env vars, conditional secrets) → .env.example documentation. Each step builds on the previous, with property-based and unit tests validating correctness incrementally.

## Tasks

- [x] 1. Create shared provider config module
  - [x] 1.1 Install `fast-check` as a dev dependency in the root workspace
    - Run `npm install -D fast-check` at the monorepo root
    - _Requirements: Testing infrastructure for property-based tests_

  - [x] 1.2 Create `packages/shared/src/provider-config.ts`
    - Export `AiProvider` type (`"anthropic" | "bedrock"`)
    - Export `ProviderConfig` interface with `provider`, `openclawProvider`, `openclawApi`, `openclawAuth`, `defaultModel`, `bedrockDiscovery` fields
    - Implement `validateProvider(value: string)` — throws descriptive error for invalid values including the invalid value in the message
    - Implement `resolveModel(provider, aiModel?)` — returns `aiModel` if set, otherwise provider-specific default
    - Implement `resolveProviderConfig(env?)` — reads `AI_PROVIDER` (default `"anthropic"`), validates, returns full `ProviderConfig`
    - Define `PROVIDER_DEFAULTS` constant with Anthropic and Bedrock defaults per design
    - Export from `packages/shared/src/index.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3_

  - [ ]* 1.3 Write property tests for provider config (`packages/shared/__tests__/provider-config.test.ts`)
    - **Property 1: Provider validation accepts valid values and rejects invalid values with descriptive errors**
    - **Validates: Requirements 1.1, 1.5**

  - [ ]* 1.4 Write property test for model override (`packages/shared/__tests__/provider-config.test.ts`)
    - **Property 2: Model override takes precedence over provider defaults**
    - **Validates: Requirements 2.1**

  - [ ]* 1.5 Write property test for provider config consistency (`packages/shared/__tests__/provider-config.test.ts`)
    - **Property 4: Provider config internal consistency**
    - **Validates: Requirements 1.3, 1.4, 3.1, 3.3, 9.1, 9.2**

  - [ ]* 1.6 Write unit tests for provider config defaults and edge cases (`packages/shared/__tests__/provider-config.test.ts`)
    - Default provider is `anthropic` when `AI_PROVIDER` is unset (Req 1.2)
    - Bedrock defaults to model `anthropic.claude-sonnet-4-20250514-v1:0` (Req 2.3)
    - Anthropic defaults to model `claude-sonnet-4-20250514` (Req 2.2)
    - _Requirements: 1.2, 2.2, 2.3_

- [x] 2. Checkpoint — Ensure shared module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Modify Lambda path for provider support
  - [x] 3.1 Modify `packages/lambda-agent/src/config-init.ts` to accept provider config
    - Add `provider?: AiProvider` and `awsRegion?: string` to `InitConfigOptions`
    - When `provider === "bedrock"`: set `models.bedrockDiscovery.enabled: true` with `region`
    - When `provider === "anthropic"` or unset: keep `bedrockDiscovery.enabled: false` (current behavior)
    - Skip setting `ANTHROPIC_API_KEY` env var when `provider === "bedrock"`
    - Import `AiProvider` from `@serverless-openclaw/shared`
    - _Requirements: 3.1, 3.2, 3.3, 4.2, 9.3_

  - [x] 3.2 Modify `packages/lambda-agent/src/handler.ts` for conditional secret resolution
    - Import `resolveProviderConfig` from `@serverless-openclaw/shared`
    - Read provider config at cold start via `resolveProviderConfig()`
    - When `bedrock`: skip SSM resolution for Anthropic API key
    - When `anthropic`: resolve Anthropic key from SSM (preserve current behavior)
    - Pass `provider` and `awsRegion` to `initConfig()`
    - Pass resolved provider/api/model to `runAgent()`
    - _Requirements: 4.2, 4.3_

  - [x] 3.3 Modify `packages/lambda-agent/src/agent-runner.ts` to accept provider params
    - Add `provider?: string` and `api?: string` to `RunAgentParams`
    - Replace hardcoded `provider: "anthropic"` with `params.provider ?? "anthropic"`
    - Replace hardcoded model with `params.model ?? "claude-sonnet-4-20250514"`
    - Pass `api` to `runEmbeddedPiAgent()` when provided
    - _Requirements: 1.3, 1.4, 9.1, 9.2_

  - [ ]* 3.4 Write property test for Bedrock discovery region in config-init (`packages/lambda-agent/__tests__/config-init.test.ts`)
    - **Property 3: Bedrock discovery region matches input region**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 3.5 Write unit tests for config-init provider changes (`packages/lambda-agent/__tests__/config-init.test.ts`)
    - Bedrock: writes `bedrockDiscovery.enabled: true` with region (Req 3.1, 3.2)
    - Anthropic: writes `bedrockDiscovery.enabled: false` (Req 3.3)
    - Bedrock: does not set `ANTHROPIC_API_KEY` env var (Req 9.3)
    - _Requirements: 3.1, 3.2, 3.3, 9.3_

  - [ ]* 3.6 Write unit tests for handler provider changes (`packages/lambda-agent/__tests__/handler.test.ts`)
    - Bedrock: skips SSM resolution for Anthropic key (Req 4.2)
    - Anthropic: resolves Anthropic key from SSM (Req 4.3)
    - Bedrock: passes correct provider/api params to runAgent (Req 1.3, 9.1, 9.2)
    - _Requirements: 4.2, 4.3, 1.3, 9.1, 9.2_

  - [ ]* 3.7 Write unit tests for agent-runner provider changes (`packages/lambda-agent/__tests__/agent-runner.test.ts`)
    - Bedrock: passes `amazon-bedrock` provider, `bedrock-converse-stream` API (Req 1.3, 9.1, 9.2)
    - Anthropic: passes `anthropic` provider (Req 1.4)
    - Response includes `provider` and `model` fields (Req 9.4)
    - _Requirements: 1.3, 1.4, 9.1, 9.2, 9.4_

- [x] 4. Checkpoint — Ensure Lambda path tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Modify Fargate path for provider support
  - [x] 5.1 Modify `packages/container/src/patch-config.ts` to accept provider config
    - Add `aiProvider?: AiProvider` and `awsRegion?: string` to `PatchOptions`
    - When `aiProvider === "bedrock"`: set `llm.provider` to `"amazon-bedrock"`, `llm.api` to `"bedrock-converse-stream"`, remove `llm.apiKey`
    - When `aiProvider === "bedrock"`: set `models.bedrockDiscovery.enabled: true` with region
    - When `aiProvider === "bedrock"`: set `process.env.AWS_PROFILE = "default"`
    - When `aiProvider === "anthropic"` or unset: preserve current behavior (`bedrockDiscovery.enabled: false`)
    - Import `AiProvider` from `@serverless-openclaw/shared`
    - _Requirements: 3.4, 3.5, 4.4, 10.1, 10.2, 10.3_

  - [ ]* 5.2 Write unit tests for patch-config provider changes (`packages/container/__tests__/patch-config.test.ts`)
    - Bedrock: sets `llm.provider`, `llm.api`, removes `apiKey` (Req 10.1, 10.2)
    - Bedrock: enables `bedrockDiscovery` with region (Req 3.4)
    - Bedrock: sets `AWS_PROFILE=default` (Req 4.4)
    - Anthropic: preserves current behavior (Req 3.5, 10.3)
    - _Requirements: 3.4, 3.5, 4.4, 10.1, 10.2, 10.3_

- [x] 6. Modify CDK stacks for Bedrock support
  - [x] 6.1 Modify `packages/cdk/lib/stacks/lambda-agent-stack.ts`
    - Add `aiProvider?: string` and `aiModel?: string` to `LambdaAgentStackProps`
    - Add Bedrock IAM policy: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:ListFoundationModels` on `*` (always provisioned)
    - Add `AI_PROVIDER` and `AI_MODEL` (when set) to Lambda environment variables
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2_

  - [x] 6.2 Modify `packages/cdk/lib/stacks/compute-stack.ts`
    - Add `aiProvider?: string` and `aiModel?: string` to `ComputeStackProps`
    - Add Bedrock IAM policy to task role: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:ListFoundationModels` on `*` (always provisioned)
    - Add `AI_PROVIDER`, `AI_MODEL` (when set), `AWS_REGION` to container environment
    - Conditionally include `ANTHROPIC_API_KEY` secret only when `aiProvider !== "bedrock"`
    - _Requirements: 5.4, 5.5, 5.6, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 6.3 Modify `packages/cdk/lib/stacks/secrets-stack.ts`
    - Add `aiProvider?: string` to `SecretsStackProps`
    - Conditionally skip Anthropic API key SSM parameter when `aiProvider === "bedrock"`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.4 Update CDK app entry point to pass `aiProvider` and `aiModel` from `process.env` to all modified stacks
    - Read `AI_PROVIDER` and `AI_MODEL` from `process.env`
    - Pass to `LambdaAgentStack`, `ComputeStack`, `SecretsStack` constructors
    - _Requirements: 6.1, 6.3_

  - [ ]* 6.5 Write CDK synth assertion tests (`packages/cdk/__tests__/stacks.e2e.test.ts`)
    - Lambda stack has Bedrock IAM permissions (Req 5.1-5.3)
    - Compute stack has Bedrock IAM permissions (Req 5.4-5.6)
    - Lambda stack passes `AI_PROVIDER` env var (Req 6.1)
    - Compute stack passes `AI_PROVIDER`, `AWS_REGION` env vars (Req 6.3, 6.5)
    - Compute stack omits `ANTHROPIC_API_KEY` secret when bedrock (Req 6.6)
    - Compute stack includes `ANTHROPIC_API_KEY` secret when anthropic (Req 6.7)
    - Secrets stack skips Anthropic key when bedrock (Req 7.1)
    - Secrets stack provisions Anthropic key when anthropic (Req 7.2)
    - _Requirements: 5.1-5.6, 6.1, 6.3, 6.5, 6.6, 6.7, 7.1, 7.2_

- [x] 7. Checkpoint — Ensure CDK synth tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update `.env.example` documentation
  - [x] 8.1 Add provider and model variables to `.env.example`
    - Add `AI_PROVIDER` with comment documenting valid values (`anthropic`, `bedrock`) and default
    - Add `AI_MODEL` with comment documenting example values for both providers
    - Add comment documenting that Bedrock uses IAM role credentials (no API key needed)
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases from acceptance criteria
- Bedrock IAM permissions are always provisioned (static in CDK, no cost) per Requirement 5.7
- The `fast-check` library is needed for property-based tests (Properties 1-4)
