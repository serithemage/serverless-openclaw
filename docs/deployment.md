# Deployment Guide

This guide covers the complete process for deploying Serverless OpenClaw on a clean AWS account.

---

## 1. Prerequisites

| Item | Minimum Version | Verification Command |
|------|----------------|---------------------|
| AWS CLI | v2 | `aws --version` |
| AWS CDK CLI | v2.170+ | `npx cdk --version` |
| Node.js | v20+ | `node -v` |
| Docker | Latest | `docker --version` |
| npm | v9+ | `npm -v` |

### AWS Account Setup

```bash
# Configure AWS CLI profile
aws configure --profile <YOUR_PROFILE_NAME>
```

### Configure `.env`

Copy the example file and set your AWS profile name:

```bash
cp .env.example .env
# Edit .env with your values:
#   AWS_PROFILE=your-aws-profile-name
#   AWS_REGION=ap-northeast-2
#   FARGATE_CPU=1024       # optional (256/512/1024/2048/4096), default: 1024
#   FARGATE_MEMORY=2048    # optional (must be compatible with CPU), default: 2048
#   PREWARM_SCHEDULE=0 9 ? * MON-FRI *   # optional, comma-separated cron expressions
#   PREWARM_DURATION=60                   # optional, minutes (default: 60)
```

Then load the environment before running any AWS/CDK commands:

```bash
export $(cat .env | xargs)
```

> `.env` is in `.gitignore` and will not be committed. See `.env.example` for the template.

### CDK Bootstrap

```bash
# CDK Bootstrap (once per account)
export $(cat .env | xargs)
npx cdk bootstrap aws://<ACCOUNT_ID>/$AWS_REGION
```

---

## 2. Secret Setup (SecretsStack)

Secrets are managed by CDK via `SecretsStack`. On the first deploy, provide all secret values as CloudFormation parameters. On subsequent deploys, CloudFormation automatically reuses the previous values (`UsePreviousValue`).

### Prepare Secret Values

| Parameter | How to Obtain |
|-----------|--------------|
| `BridgeAuthToken` | Random string: `openssl rand -hex 32` |
| `OpenclawGatewayToken` | Your OpenClaw Gateway token |
| `AnthropicApiKey` | Your Anthropic API key |
| `TelegramBotToken` | (Optional) Token from @BotFather |
| `TelegramWebhookSecret` | (Optional) Random string: `openssl rand -hex 32` (must **not** contain `:`) |

### When Using Telegram Bot (Optional)

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Enter a display name (e.g., `My OpenClaw`)
4. Enter a username ending with `bot` (e.g., `my_openclaw_bot`)
5. BotFather will reply with an **HTTP API token** (e.g., `123456789:ABCdefGHI...`). Use this as `TelegramBotToken`.

### Deploy SecretsStack (First Time)

```bash
cd packages/cdk

# With Telegram
npx cdk deploy SecretsStack \
  --parameters "BridgeAuthToken=$(openssl rand -hex 32)" \
  --parameters "OpenclawGatewayToken=<YOUR_GATEWAY_TOKEN>" \
  --parameters "AnthropicApiKey=<YOUR_ANTHROPIC_API_KEY>" \
  --parameters "TelegramBotToken=<TOKEN_FROM_BOTFATHER>" \
  --parameters "TelegramWebhookSecret=$(openssl rand -hex 32)" \
  --profile $AWS_PROFILE

# Without Telegram (use placeholder values for Telegram parameters)
npx cdk deploy SecretsStack \
  --parameters "BridgeAuthToken=$(openssl rand -hex 32)" \
  --parameters "OpenclawGatewayToken=<YOUR_GATEWAY_TOKEN>" \
  --parameters "AnthropicApiKey=<YOUR_ANTHROPIC_API_KEY>" \
  --parameters "TelegramBotToken=unused" \
  --parameters "TelegramWebhookSecret=unused" \
  --profile $AWS_PROFILE
```

> On subsequent deploys (`cdk deploy --all`), SecretsStack parameters are automatically reused — no need to provide them again.

---

## 3. Build

```bash
# Clone the repository
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw

# Install dependencies
npm install

# TypeScript build
npm run build

# Web UI build (required before CDK synth)
cd packages/web && npx vite build && cd ../..
```

> **Important:** The `packages/web/dist/` directory must exist for CDK synth to succeed. `WebStack`'s `BucketDeployment` validates the existence of this path.

---

## 4. Deployment

### Deploy All Stacks at Once

```bash
cd packages/cdk
npx cdk deploy --all --profile $AWS_PROFILE --require-approval broadening
```

### Deploy Stacks Individually (Optional)

Deployment order based on dependencies:

```bash
cd packages/cdk

# Step 1: Secrets + Base infrastructure
npx cdk deploy SecretsStack --parameters "..." --profile $AWS_PROFILE  # see Section 2
npx cdk deploy NetworkStack StorageStack --profile $AWS_PROFILE

# Step 2: Auth + Compute
npx cdk deploy AuthStack --profile $AWS_PROFILE
npx cdk deploy ComputeStack --profile $AWS_PROFILE
npx cdk deploy LambdaAgentStack --profile $AWS_PROFILE  # only when AGENT_RUNTIME=lambda or both

# Step 3: API Gateway + Lambda
npx cdk deploy ApiStack --profile $AWS_PROFILE

# Step 4: Web UI + Monitoring
npx cdk deploy WebStack --profile $AWS_PROFILE
npx cdk deploy MonitoringStack --profile $AWS_PROFILE
```

### Push Docker Image

To run the Fargate container, you need to push a Docker image to ECR.

```bash
# Option A: Use the deploy script (recommended)
./scripts/deploy-image.sh

# Option B: Manual steps
aws ecr get-login-password --region <REGION> --profile $AWS_PROFILE \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

docker build -f packages/container/Dockerfile -t serverless-openclaw .
docker tag serverless-openclaw:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
```

### SOCI Lazy Loading (Optional — Reduces Cold Start)

SOCI (Seekable OCI) enables lazy loading of container image layers, reducing Fargate cold start by ~50%. Requires `soci` CLI (Linux only).

```bash
# Install soci CLI (Linux)
wget https://github.com/awslabs/soci-snapshotter/releases/latest/download/soci-snapshotter-grpc-linux-amd64.tar.gz
tar -xzf soci-snapshotter-grpc-linux-amd64.tar.gz
sudo mv soci /usr/local/bin/

# Build and push image with SOCI index
./scripts/deploy-image.sh --soci
```

> **Note:** SOCI requires Fargate platform version 1.4.0+ (default). The SOCI index is stored alongside the image in ECR. Fargate automatically detects and uses the index for lazy loading — no task definition changes needed.

---

## 5. Post-Deployment Configuration

### Register Telegram Webhook (When Using Telegram)

After deployment, check the `HttpApiEndpoint` value from CDK Output and register the webhook.

```bash
# Using Makefile (recommended) — reads secret from SSM automatically
make telegram-webhook

# Or manual registration
# <TELEGRAM_SECRET_TOKEN> = value from /serverless-openclaw/secrets/telegram-webhook-secret in SSM Parameter Store
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<HTTP_API_ENDPOINT>/telegram",
    "secret_token": "<TELEGRAM_SECRET_TOKEN>"
  }'
```

### Create Cognito Test User

```bash
# Using Makefile (recommended)
make user-create EMAIL=user@example.com PASS="YourPassword1!"

# Or manually
aws cognito-idp sign-up \
  --client-id <USER_POOL_CLIENT_ID> \
  --username user@example.com \
  --password "YourPassword1!" \
  --user-attributes Name=email,Value=user@example.com \
  --profile $AWS_PROFILE

aws cognito-idp admin-confirm-sign-up \
  --user-pool-id <USER_POOL_ID> \
  --username user@example.com \
  --profile $AWS_PROFILE

aws cognito-idp admin-update-user-attributes \
  --user-pool-id <USER_POOL_ID> \
  --username user@example.com \
  --user-attributes Name=email_verified,Value=true \
  --profile $AWS_PROFILE
```

> **Note:** `admin-create-user` is incompatible with SRP authentication. Use the `sign-up` API instead.

---

## 6. Environment Variables Reference

Key values available from CDK Output:

| CDK Output | Purpose |
|------------|---------|
| `WebStack.WebAppUrl` | Web UI access URL |
| `WebStack.DistributionDomainName` | CloudFront domain |
| `ApiStack.WebSocketApiEndpoint` | WebSocket connection URL |
| `ApiStack.HttpApiEndpoint` | REST API + Telegram webhook URL |
| `AuthStack.UserPoolId` | Cognito User Pool ID |
| `AuthStack.UserPoolClientId` | Cognito App Client ID |
| `ComputeStack.ClusterArn` | ECS cluster ARN |
| `StorageStack.EcrRepositoryUri` | Docker image push target |

### `.env.local` for Web UI Local Development

```env
VITE_WS_URL=<ApiStack.WebSocketApiEndpoint>
VITE_API_URL=<ApiStack.HttpApiEndpoint>
VITE_COGNITO_USER_POOL_ID=<AuthStack.UserPoolId>
VITE_COGNITO_CLIENT_ID=<AuthStack.UserPoolClientId>
```

### Deploy-time Feature Flags

Set in `.env` or exported before running CDK commands.

| Variable | Default | Values | Purpose |
|----------|---------|--------|---------|
| `AGENT_RUNTIME` | `fargate` | `fargate` \| `lambda` \| `both` | Compute path selection |
| `AI_PROVIDER` | `anthropic` | `anthropic` \| `bedrock` | AI provider selection |
| `AI_MODEL` | _(provider default)_ | any model ID | Override default model |
| `DEPLOY_WEB` | `true` | `true` \| `false` | Include WebStack deployment |

---

## 7. Verification

### Web UI Access

1. Navigate to `WebStack.WebAppUrl` (CloudFront URL)
2. Sign up or log in
3. Send a chat message → verify agent response

### WebSocket Connection Test

```bash
# Using wscat
npm install -g wscat
wscat -c "<WebSocketApiEndpoint>?token=<ID_TOKEN>"
> {"action":"sendMessage","data":{"message":"hello"}}
```

### Telegram Test

1. Send a message to the bot in Telegram
2. Verify "Waking up..." response (cold start)
3. Verify agent response

### Telegram-Web Identity Linking Test

1. Web UI → Settings → Click "Link Telegram" → Confirm 6-digit code (5-minute countdown)
2. Send `/link {code}` to the Telegram bot → Confirm "Account linked successfully!" response
3. Web UI → Settings → Confirm "Telegram ID {id} linked" is displayed
4. Send a Telegram message → Confirm routing to the same container as Web (TaskState PK is Cognito UUID)
5. (Optional) Web UI → "Unlink" → Confirm Telegram messages are routed to a separate container

### Cold Start Measurement

```bash
# Measure cold start (waits for container to become idle first)
make cold-start

# Measure warm start (skip idle wait)
make cold-start-warm
```

The script authenticates via Cognito, connects WebSocket, sends "Hello!", and reports timing breakdown (first response, stream complete) with a full message timeline.

### Check ECS Task Status

```bash
aws ecs list-tasks --cluster serverless-openclaw --profile $AWS_PROFILE
aws ecs describe-tasks --cluster serverless-openclaw --tasks <TASK_ARN> --profile $AWS_PROFILE
```

---

## 8. Update / Teardown

### Update

```bash
# After code changes
npm run build
cd packages/web && npx vite build && cd ../..
cd packages/cdk && npx cdk deploy --all --profile $AWS_PROFILE
```

### Update OpenClaw Container

```bash
# Build + push new image
./scripts/deploy-image.sh       # without SOCI
./scripts/deploy-image.sh --soci  # with SOCI (Linux only)

# If there are running tasks, stop them (next request will launch with the new image)
aws ecs list-tasks --cluster serverless-openclaw --profile $AWS_PROFILE
aws ecs stop-task --cluster serverless-openclaw --task <TASK_ID> --profile $AWS_PROFILE
```

### Full Teardown

```bash
cd packages/cdk
npx cdk destroy --all --profile $AWS_PROFILE
```

> Since `removalPolicy: DESTROY` is set, DynamoDB tables, S3 buckets, and ECR repositories will be deleted together. **If you have production data, back it up before deleting.**

---

## 9. Lambda Agent Deployment

### Current Operational Mode: `both`

The project currently runs with `AGENT_RUNTIME=both`, keeping both Lambda (primary) and Fargate (fallback) paths available. This allows gradual migration and instant rollback.

| Mode | Lambda Agent | Fargate | Use Case |
|------|-------------|---------|----------|
| `fargate` (default) | Skipped | Active | Original behavior, backward compatible |
| `lambda` | Active | Skipped | Lambda only, zero fixed cost |
| **`both`** | **Active (smart routing)** | **Active (reuse/fallback)** | **Current — smart routing based on task** |

### Prerequisites

```bash
# Set in .env or export before deploy
export AGENT_RUNTIME=both
```

### Build and Push Lambda Container Image

```bash
# From project root (not packages/lambda-agent/)
# --provenance=false is required (Lambda doesn't support OCI manifests)
docker build --provenance=false --platform linux/arm64 \
  -f packages/lambda-agent/Dockerfile \
  -t {ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/serverless-openclaw-lambda-agent:latest .

# ECR login + push
aws ecr get-login-password --profile $AWS_PROFILE --region $AWS_REGION | \
  docker login --username AWS --password-stdin {ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com
docker push {ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/serverless-openclaw-lambda-agent:latest
```

Note: The ECR repository (`serverless-openclaw-lambda-agent`) must exist before first deploy. Create it manually or let LambdaAgentStack create it.

### Deploy

```bash
cd packages/cdk
AGENT_RUNTIME=both npx cdk deploy LambdaAgentStack --exclusively \
  --profile $AWS_PROFILE --region $AWS_REGION --require-approval never
```

### Update Lambda Function (after image rebuild)

```bash
aws lambda update-function-code \
  --function-name serverless-openclaw-agent \
  --image-uri {ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/serverless-openclaw-lambda-agent:latest \
  --profile $AWS_PROFILE --region $AWS_REGION
```

### Switching to Lambda-Only

When confident in Lambda stability (after 1-2 weeks of `both` mode):

```bash
# 1. Stop any running Fargate tasks
make task-stop

# 2. Redeploy with lambda-only
AGENT_RUNTIME=lambda npx cdk deploy --all --profile $AWS_PROFILE --region $AWS_REGION
```

ComputeStack resources will be skipped. To rollback: set `AGENT_RUNTIME=fargate` and redeploy.

---

## 10. AI Provider Configuration

By default the system uses Anthropic (requires `AnthropicApiKey` in SecretsStack). Set `AI_PROVIDER=bedrock` to use Amazon Bedrock instead — no API key needed, authentication uses the Lambda execution role / Fargate task role via the AWS SDK default credential chain.

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `anthropic` | `anthropic` or `bedrock` |
| `AI_MODEL` | _(provider default)_ | Override model ID (optional) |

**Default models:**
- Anthropic: `claude-sonnet-4-20250514`
- Bedrock: `anthropic.claude-sonnet-4-20250514-v1:0`

### Switching to Bedrock

```bash
# In .env
AI_PROVIDER=bedrock

# Deploy — AnthropicApiKey SSM parameter is skipped automatically
AI_PROVIDER=bedrock npx cdk deploy --all --profile $AWS_PROFILE --region $AWS_REGION
```

The SecretsStack skips the `AnthropicApiKey` SSM parameter when `AI_PROVIDER=bedrock`. Bedrock IAM permissions (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`) are provisioned on both Lambda and Fargate roles regardless of provider (no cost, avoids drift on provider switch).

### Switching back to Anthropic

```bash
AI_PROVIDER=anthropic npx cdk deploy --all --profile $AWS_PROFILE --region $AWS_REGION
```

---

## 11. Troubleshooting

### CDK synth failure: `Cannot find asset`

```
Error: Cannot find asset at /path/to/packages/web/dist
```

**Cause:** Web UI build was not run beforehand
**Solution:** `cd packages/web && npx vite build`

### CDK deploy failure: `Parameter not found`

```
Error: SSM parameter not found
```

**Cause:** SecretsStack not deployed before other stacks
**Solution:** Deploy SecretsStack first. See [2. Secret Setup](#2-secret-setup-secretsstack)

### Fargate Task Startup Failure

```bash
# Check CloudWatch logs
aws logs tail /ecs/serverless-openclaw --follow --profile $AWS_PROFILE
```

**Common causes:**
- Image not pushed to ECR → build and push Docker image
- Insufficient SSM parameter access permissions → redeploy with CDK
- Insufficient memory → adjust `memoryLimitMiB` in `ComputeStack`

### WebSocket Connection Failure

**Cause:** Cognito ID token expired or not provided
**Solution:** Pass a valid ID token via `?token=` query parameter

### Telegram Webhook Not Responding

```bash
# Check webhook status
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

**Common causes:**
- Webhook URL not registered → run `make telegram-webhook`
- Secret token mismatch (403 Forbidden) → run `make telegram-webhook` to re-register with SSM secret
- Lambda error → check CloudWatch logs for `telegram-webhook` function
