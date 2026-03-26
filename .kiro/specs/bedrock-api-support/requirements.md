# Requirements Document

## Introduction

Add Amazon Bedrock as an alternative AI provider alongside the existing Anthropic API. The system currently hardcodes Anthropic as the sole provider. This feature introduces environment-variable-driven provider selection, Bedrock credential handling via the AWS SDK default credential chain, automatic model discovery, and the necessary IAM permissions — across both Lambda and Fargate compute paths.

## Glossary

- **Provider_Selector**: The `AI_PROVIDER` environment variable that determines which AI provider the system uses. Valid values: `anthropic` (default), `bedrock`.
- **Bedrock_Provider**: The Amazon Bedrock integration using OpenClaw's `amazon-bedrock` provider with `bedrock-converse-stream` API and `aws-sdk` auth.
- **Anthropic_Provider**: The existing Anthropic API integration using direct API key authentication.
- **Agent_Runner**: The module (`packages/lambda-agent/src/agent-runner.ts`) that invokes OpenClaw's `runEmbeddedPiAgent()` with provider and model parameters.
- **Config_Initializer**: The module (`packages/lambda-agent/src/config-init.ts`) that writes OpenClaw's JSON config file at startup.
- **Config_Patcher**: The module (`packages/container/src/patch-config.ts`) that patches OpenClaw's JSON config for the Fargate container.
- **Compute_Stack**: The CDK stack (`packages/cdk/lib/stacks/compute-stack.ts`) that defines the Fargate task definition and IAM permissions.
- **Lambda_Agent_Stack**: The CDK stack (`packages/cdk/lib/stacks/lambda-agent-stack.ts`) that defines the Lambda agent function and IAM permissions.
- **Bedrock_Discovery**: OpenClaw's automatic model discovery feature that calls `bedrock:ListFoundationModels` and caches results.
- **Credential_Chain**: The AWS SDK default credential chain used by Bedrock (IAM role in Lambda/Fargate, no API key needed).
- **Model_Selector**: The `AI_MODEL` environment variable that optionally overrides the default model for the selected provider.

## Requirements

### Requirement 1: Provider Selection via Environment Variable

**User Story:** As a deployer, I want to select the AI provider via an environment variable, so that I can switch between Anthropic and Bedrock without code changes.

#### Acceptance Criteria

1. THE Provider_Selector SHALL accept the values `anthropic` and `bedrock`
2. WHEN the Provider_Selector is not set, THE system SHALL default to `anthropic`
3. WHEN the Provider_Selector is set to `bedrock`, THE Agent_Runner SHALL pass `amazon-bedrock` as the provider and `bedrock-converse-stream` as the API to OpenClaw
4. WHEN the Provider_Selector is set to `anthropic`, THE Agent_Runner SHALL pass `anthropic` as the provider (preserving current behavior)
5. WHEN the Provider_Selector is set to an unsupported value, THE system SHALL fail at startup with a descriptive error message naming the invalid value

### Requirement 2: Model Selection via Environment Variable

**User Story:** As a deployer, I want to optionally override the default AI model, so that I can choose specific Bedrock or Anthropic models.

#### Acceptance Criteria

1. WHEN the Model_Selector environment variable is set, THE Agent_Runner SHALL use the specified model instead of the default
2. WHEN the Model_Selector is not set and the Provider_Selector is `anthropic`, THE Agent_Runner SHALL use `claude-sonnet-4-20250514` as the default model
3. WHEN the Model_Selector is not set and the Provider_Selector is `bedrock`, THE Agent_Runner SHALL use `anthropic.claude-sonnet-4-20250514-v1:0` as the default model

### Requirement 3: Bedrock Model Discovery in Config

**User Story:** As a deployer using Bedrock, I want automatic model discovery enabled, so that OpenClaw can list available Bedrock models.

#### Acceptance Criteria

1. WHEN the Provider_Selector is `bedrock`, THE Config_Initializer SHALL set `models.bedrockDiscovery.enabled` to `true` in the OpenClaw config
2. WHEN the Provider_Selector is `bedrock`, THE Config_Initializer SHALL set `models.bedrockDiscovery.region` to the value of the `AWS_REGION` environment variable
3. WHEN the Provider_Selector is `anthropic`, THE Config_Initializer SHALL set `models.bedrockDiscovery.enabled` to `false` in the OpenClaw config
4. WHEN the Provider_Selector is `bedrock`, THE Config_Patcher SHALL set `models.bedrockDiscovery.enabled` to `true` in the OpenClaw config
5. WHEN the Provider_Selector is `anthropic`, THE Config_Patcher SHALL set `models.bedrockDiscovery.enabled` to `false` in the OpenClaw config

### Requirement 4: Bedrock Credential Handling

**User Story:** As a deployer using Bedrock, I want the system to authenticate via IAM roles, so that no additional API keys are needed for Bedrock.

#### Acceptance Criteria

1. WHEN the Provider_Selector is `bedrock`, THE system SHALL authenticate to Bedrock using the AWS SDK default credential chain (Lambda execution role or Fargate task role)
2. WHEN the Provider_Selector is `bedrock`, THE system SHALL skip resolving the Anthropic API key from SSM
3. WHEN the Provider_Selector is `anthropic`, THE system SHALL resolve the Anthropic API key from SSM (preserving current behavior)
4. WHEN the Provider_Selector is `bedrock` and the compute path is Fargate, THE Config_Patcher SHALL set `AWS_PROFILE` to `default` in the process environment to signal that credentials are available via the SDK chain

### Requirement 5: IAM Permissions for Bedrock

**User Story:** As a deployer using Bedrock, I want the correct IAM permissions provisioned, so that the Lambda and Fargate roles can invoke Bedrock models.

#### Acceptance Criteria

1. THE Lambda_Agent_Stack SHALL grant the Lambda execution role the `bedrock:InvokeModel` permission
2. THE Lambda_Agent_Stack SHALL grant the Lambda execution role the `bedrock:InvokeModelWithResponseStream` permission
3. THE Lambda_Agent_Stack SHALL grant the Lambda execution role the `bedrock:ListFoundationModels` permission
4. THE Compute_Stack SHALL grant the Fargate task role the `bedrock:InvokeModel` permission
5. THE Compute_Stack SHALL grant the Fargate task role the `bedrock:InvokeModelWithResponseStream` permission
6. THE Compute_Stack SHALL grant the Fargate task role the `bedrock:ListFoundationModels` permission
7. WHEN the Provider_Selector is `anthropic`, THE Bedrock IAM permissions SHALL still be provisioned (permissions are static in CDK and do not incur cost)

### Requirement 6: CDK Environment Variable Propagation

**User Story:** As a deployer, I want the provider and model configuration propagated to both compute paths, so that Lambda and Fargate use the same provider settings.

#### Acceptance Criteria

1. THE Lambda_Agent_Stack SHALL pass the `AI_PROVIDER` environment variable to the Lambda function
2. THE Lambda_Agent_Stack SHALL pass the `AI_MODEL` environment variable to the Lambda function when set
3. THE Compute_Stack SHALL pass the `AI_PROVIDER` environment variable to the Fargate container
4. THE Compute_Stack SHALL pass the `AI_MODEL` environment variable to the Fargate container when set
5. THE Compute_Stack SHALL pass the `AWS_REGION` environment variable to the Fargate container
6. WHEN the Provider_Selector is `bedrock`, THE Compute_Stack SHALL omit the `ANTHROPIC_API_KEY` secret from the Fargate container definition
7. WHEN the Provider_Selector is `anthropic`, THE Compute_Stack SHALL include the `ANTHROPIC_API_KEY` secret in the Fargate container definition (preserving current behavior)

### Requirement 7: Secrets Stack Conditional Provisioning

**User Story:** As a deployer using Bedrock, I want the Anthropic API key to be optional during deployment, so that I do not need to provide it when using Bedrock only.

#### Acceptance Criteria

1. WHEN the Provider_Selector is `bedrock`, THE Secrets_Stack SHALL skip provisioning the Anthropic API key SSM parameter
2. WHEN the Provider_Selector is `anthropic`, THE Secrets_Stack SHALL provision the Anthropic API key SSM parameter (preserving current behavior)
3. WHEN the Provider_Selector is `bedrock`, THE deployment SHALL succeed without providing an Anthropic API key CloudFormation parameter

### Requirement 8: Environment Example Documentation

**User Story:** As a deployer, I want the `.env.example` file to document provider selection, so that I know how to configure Bedrock.

#### Acceptance Criteria

1. THE `.env.example` file SHALL include the `AI_PROVIDER` variable with valid values documented as a comment
2. THE `.env.example` file SHALL include the `AI_MODEL` variable with example values for both providers documented as a comment
3. THE `.env.example` file SHALL document that Bedrock uses IAM role credentials and does not require an API key

### Requirement 9: Lambda Agent Bedrock Runtime Support

**User Story:** As a deployer using Bedrock on the Lambda path, I want the Lambda agent to correctly invoke Bedrock models, so that messages are processed via Bedrock.

#### Acceptance Criteria

1. WHEN the Provider_Selector is `bedrock`, THE Agent_Runner SHALL pass `aws-sdk` as the auth method to OpenClaw
2. WHEN the Provider_Selector is `bedrock`, THE Agent_Runner SHALL pass `bedrock-converse-stream` as the API identifier to OpenClaw
3. WHEN the Provider_Selector is `bedrock`, THE Agent_Runner SHALL omit the Anthropic API key from the process environment
4. THE LambdaAgentResponse SHALL continue to include the `provider` and `model` fields reflecting the actual provider and model used

### Requirement 10: Fargate Container Bedrock Runtime Support

**User Story:** As a deployer using Bedrock on the Fargate path, I want the Fargate container to correctly invoke Bedrock models, so that messages are processed via Bedrock.

#### Acceptance Criteria

1. WHEN the Provider_Selector is `bedrock`, THE Config_Patcher SHALL configure the OpenClaw LLM section with `provider: "amazon-bedrock"` and `api: "bedrock-converse-stream"`
2. WHEN the Provider_Selector is `bedrock`, THE Config_Patcher SHALL remove any `apiKey` field from the LLM config section
3. WHEN the Provider_Selector is `anthropic`, THE Config_Patcher SHALL preserve the current Anthropic LLM configuration behavior
