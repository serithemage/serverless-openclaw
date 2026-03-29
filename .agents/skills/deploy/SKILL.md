---
name: deploy
description: Deploys Serverless OpenClaw CDK stacks to AWS. Handles SecretsStack parameter injection, full/individual stack deployment, and Docker image push.
argument-hint: "[target: secrets|all|<StackName>|image]"
allowed-tools: Read, Bash, Glob, Grep
---

# Serverless OpenClaw Deployment

Deploy target: **$ARGUMENTS**

## Prerequisites

1. Load environment variables: `export $(cat .env | xargs)`
2. Ensure `packages/web/dist/` exists: `cd packages/web && npx vite build`
3. Ensure TypeScript build passes: `npm run build`

## Deployment Targets

### `secrets` — Deploy SecretsStack (first-time setup)

SecretsStack uses `AwsCustomResource` to create SSM SecureString parameters. On first deploy, all 5 values must be provided.

```bash
cd packages/cdk
export $(cat .env | xargs)

npx cdk deploy SecretsStack \
  --parameters "BridgeAuthToken=$(openssl rand -hex 32)" \
  --parameters "OpenclawGatewayToken=$OPENCLAW_GATEWAY_TOKEN" \
  --parameters "AnthropicApiKey=$ANTHROPIC_API_KEY" \
  --parameters "TelegramBotToken=$TELEGRAM_BOT_TOKEN" \
  --parameters "TelegramWebhookSecret=$(openssl rand -hex 32)" \
  --profile $AWS_PROFILE --region $AWS_REGION --require-approval never
```

- `BridgeAuthToken` and `TelegramWebhookSecret` can be randomly generated
- `OpenclawGatewayToken`, `AnthropicApiKey`, `TelegramBotToken` must come from `.env`
- On subsequent deploys, CloudFormation reuses previous values (`UsePreviousValue`)

### `all` — Deploy All Stacks

```bash
cd packages/cdk
npx cdk deploy --all --profile $AWS_PROFILE --region $AWS_REGION --require-approval broadening
```

Stack order (automatic): SecretsStack + NetworkStack -> StorageStack -> {AuthStack, ComputeStack} -> ApiStack -> WebStack + MonitoringStack

### `<StackName>` — Deploy Individual Stack

```bash
cd packages/cdk
npx cdk deploy <StackName> --profile $AWS_PROFILE --region $AWS_REGION --require-approval never
```

Use `--exclusively` flag to skip dependency resolution when needed.

### `image` — Push Docker Image to ECR

```bash
./scripts/deploy-image.sh          # standard push
./scripts/deploy-image.sh --soci   # with SOCI lazy loading (Linux only)
```

### `lambda-image` — Build + Push Lambda Container Image

```bash
./scripts/deploy-lambda-image.sh   # build + push Lambda container image to ECR
```

### `lambda-stack` — Deploy LambdaAgentStack

```bash
cd packages/cdk
npx cdk deploy LambdaAgentStack --profile $AWS_PROFILE --region $AWS_REGION --require-approval never
```

### `lambda-update` — Update Lambda Function Code (after image rebuild)

```bash
aws lambda update-function-code \
  --function-name serverless-openclaw-agent \
  --image-uri $ECR_REPO:latest \
  --profile $AWS_PROFILE --region $AWS_REGION
```

See [Deployment Guide §9](../../../docs/deployment.md) for full Lambda deployment walkthrough.

## Post-Deployment

- Register Telegram webhook: `./scripts/setup-telegram-webhook.sh`
- Verify: send a message via Telegram or Web UI
- Check ECS tasks: `make task-status`

## Troubleshooting

- **SecretsStack ROLLBACK_FAILED**: Force delete with `aws cloudformation delete-stack --stack-name SecretsStack --deletion-mode FORCE_DELETE_STACK`, then redeploy
- **Empty parameter values**: Verify `.env` has non-empty values for `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `OPENCLAW_GATEWAY_TOKEN`
- **CDK synth fails on web dist**: Run `cd packages/web && npx vite build` first

## References

- [Deployment Guide](../../../docs/deployment.md)
- [CDK Stacks](../../../packages/cdk/lib/stacks/)
- [SSM Parameters](../../../packages/cdk/lib/stacks/ssm-params.ts)
