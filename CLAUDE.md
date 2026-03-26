# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Serverless OpenClaw — Runs the OpenClaw AI agent on-demand on AWS serverless infrastructure. Web UI + Telegram interface. Cost target ~$1/month.

## Build & Dev Commands

```bash
npm run build          # tsc --build (all packages via project references)
npm run lint           # eslint "packages/**/*.ts"
npm run format         # prettier
npm run test           # vitest run (unit tests, excludes *.e2e.test.ts)
npm run test:e2e       # vitest e2e (CDK synth E2E tests)

# Single test file
npx vitest run packages/gateway/__tests__/handlers/ws-connect.test.ts

# Single test by name
npx vitest run -t "should verify JWT"

# CDK
cd packages/cdk && npx cdk synth       # Generate CloudFormation
cd packages/cdk && npx cdk deploy      # Deploy to AWS

# Makefile operations (requires .env with AWS_PROFILE, AWS_REGION)
make task-status       # Fargate container status
make deploy-web        # Build + upload + CloudFront invalidation
make deploy-all        # CDK deploy all stacks
make task-logs         # Tail container logs
make cold-start        # Measure cold start time (waits for container idle)
make cold-start-warm   # Measure warm start time (skip idle wait)
make telegram-webhook  # Register Telegram webhook with SSM secret
make help              # Show all targets
```

**Git Hooks** (husky): pre-commit -> build + lint + UT, pre-push -> E2E tests

TypeScript: ES2022, Node16 module resolution, strict, composite builds. `.js` extension required in import paths.

## Architecture

```
packages/
├── shared/        # Types + constants (TABLE_NAMES, BRIDGE_PORT, key prefixes)
├── cdk/           # CDK stacks (lib/stacks/)
├── gateway/       # 7 Lambda handlers (ws-connect/message/disconnect, telegram-webhook, api-handler, watchdog, prewarm)
├── container/     # Fargate container (Bridge server + OpenClaw JSON-RPC client)
├── lambda-agent/  # Lambda Container Image (runs OpenClaw runEmbeddedPiAgent() directly)
└── web/           # React SPA (Vite, amazon-cognito-identity-js for auth)
```

**Data Flow (Fargate — default):** Client -> API Gateway (WS/REST) -> Lambda -> Bridge(:8080 HTTP) -> OpenClaw Gateway(:18789 WS, JSON-RPC 2.0)

**Data Flow (Lambda — AGENT_RUNTIME=lambda):** Client -> API Gateway -> Lambda -> Lambda Agent Container -> runEmbeddedPiAgent() -> Anthropic API (S3 session sync)

**CDK Stacks:** SecretsStack + NetworkStack -> StorageStack -> {AuthStack, ComputeStack, LambdaAgentStack} -> ApiStack -> WebStack + MonitoringStack

**Cross-stack decoupling:** ComputeStack writes TaskDefinition/Role ARNs to SSM Parameter Store (`packages/cdk/lib/stacks/ssm-params.ts`), LambdaAgentStack writes Lambda function ARN to SSM, ApiStack reads from SSM. No CloudFormation cross-stack exports.

**AGENT_RUNTIME feature flag:** `fargate` (default) | `lambda` | `both`. Controls which compute stacks are deployed and which routing path `routeMessage` uses. When `both`: Smart routing via `classifyRoute()` — Lambda default, Fargate reuse when running, `/heavy`/`/fargate` hint for Fargate, Lambda failure fallback to Fargate.

**AI_PROVIDER feature flag:** `anthropic` (default) | `bedrock`. Controls which AI backend is used. Bedrock uses IAM role credentials (no API key needed). `AI_MODEL` overrides the provider-default model. SecretsStack skips `AnthropicApiKey` when `AI_PROVIDER=bedrock`.

## Critical Constraints

Violating these rules will cause cost spikes or security incidents:

- **No NAT Gateway** — `natGateways: 0` required. Use Fargate Public IP + VPC Gateway Endpoints
- **No ALB, no Interface Endpoints** — Use API Gateway only
- **DynamoDB PAY_PER_REQUEST** — Provisioned mode prohibited
- **No secrets written to disk** — API keys/tokens delivered only via environment variables (SSM Parameter Store SecureString), not included in `openclaw.json`
- **Telegram webhook-only** — Long polling prohibited (API rejects simultaneous use)
- **Bridge Bearer token required** — For all endpoints except `/health`
- **Server-side userId only** — Client-provided userId prohibited (IDOR prevention)
- **No `launchType` in RunTask** — Use `capacityProviderStrategy` only (cannot be specified simultaneously)
- **No hardcoded S3 bucket names** — CDK auto-generates them (global uniqueness)

## DynamoDB Tables (5)

| Table | PK | SK | TTL | GSI |
|-------|----|----|-----|-----|
| Conversations | `USER#{userId}` | `CONV#{id}#MSG#{ts}` | `ttl` | — |
| Settings | `USER#{userId}` | `SETTING#{key}` | — | — |
| TaskState | `USER#{userId}` | — | `ttl` | — |
| Connections | `CONN#{connId}` | — | `ttl` | `userId-index` |
| PendingMessages | `USER#{userId}` | `MSG#{ts}#{uuid}` | `ttl` | — |

Table names use the `TABLE_NAMES` constant from `@serverless-openclaw/shared`.

## Development Rules

- **Documentation language: English** — All project documentation (`docs/`, `README.md`, code comments, commit messages, GitHub issues/PRs) must be written in English
- **TDD required** — For all implementations except the UI (web package), write tests first before implementing
- **Git Hooks:**
  - `pre-commit`: Must pass unit tests (vitest) + lint (eslint)
  - `pre-push`: Must pass E2E tests
- **E2E Test Deployment:**
  - Local: AWS profile information managed via `.env` file (included in `.gitignore`)
  - CI: AWS deployment via GitHub Actions + OIDC authentication
- **Cold start measurement:** Always use `make cold-start` (automatically stops tasks + cleans TaskState before measuring). Never run the measurement script directly without stopping existing tasks first. Use `make task-status` to verify, `make task-stop` to stop, and `make task-stop-recent` to stop only the most recent task.

## Key Design Patterns

- **Cold Start Message Queuing:** Messages during container startup -> stored in PendingMessages DDB -> consumed after Bridge starts (5-minute TTL)
- **Bridge 6-Layer Defense:** Security Group -> Bearer token -> TLS -> localhost binding -> non-root -> SSM Parameter Store
- **Fargate Public IP Lookup:** DescribeTasks -> ENI ID -> DescribeNetworkInterfaces -> PublicIp
- **OpenClaw Protocol:** JSON-RPC 2.0 / MCP over WebSocket, `?token=` query authentication
- **WebSocket Auth:** API Gateway WebSocket does NOT support JWT authorizers. ws-connect Lambda verifies Cognito JWT from `?token=` query param using `aws-jwt-verify`
- **CDK Lambda bundling:** `externalModules: ["@aws-sdk/*"]` — AWS SDK v3 is provided by Lambda runtime, do not bundle it
- **Lambda secrets:** `{{resolve:ssm-secure:...}}` is NOT supported in Lambda env vars. Lambda functions receive SSM parameter paths as env vars (`SSM_BRIDGE_AUTH_TOKEN`, etc.) and resolve SecureString values at runtime via `resolveSecrets()` in `packages/gateway/src/services/secrets.ts`
- **CDK deploy order for cross-stack changes:** Use `--exclusively` flag when deploying individual stacks to skip dependency resolution. See `docs/deployment.md` for migration procedures.
- **AI Provider abstraction:** `resolveProviderConfig()` in `packages/shared/src/provider-config.ts` centralises provider validation and defaults. Bedrock IAM permissions provisioned regardless of provider (avoids drift on switch).
- **Web build before CDK synth:** `packages/web/dist/` must exist before `cdk synth` because `BucketDeployment`'s `Source.asset()` validates the path
- **CloudWatch Custom Metrics:** Namespace `ServerlessOpenClaw`, 10 metrics (startup phases, message latency, response length, prewarm). Controlled by `METRICS_ENABLED` env var. MonitoringStack creates dashboard with 6 rows (cold start, messages, Lambda, API GW, prewarm, ECS/DynamoDB)
- **Predictive Pre-Warming:** Optional EventBridge cron → prewarm Lambda → ECS RunTask with `USER_ID=system:prewarm`. Container claimed by first real user message (TaskState ownership transfer). Watchdog skips tasks where `now < prewarmUntil`. Configured via `PREWARM_SCHEDULE` (comma-separated crons) and `PREWARM_DURATION` (minutes, default 60) env vars. Disabled by default (no EventBridge rules created without schedule).
- **Telegram-Web Identity Linking:** OTP-based linking via Settings table. Web UI generates 6-digit OTP -> Telegram `/link {code}` verifies and creates bilateral link records -> resolveUserId maps telegram userId to cognitoId for container sharing. Unlinking is Web-only (IDOR prevention). REST API: POST /link/generate-otp, GET /link/status, POST /link/unlink (all JWT-authenticated)
- **HTTP API CORS:** `corsPreflight` required — Web (CloudFront) → API Gateway is cross-origin. `allowOrigins: ["*"]`, `allowHeaders: [Authorization, Content-Type]`

## Phase 1 Progress (10/10 — Complete)

Completed: 1-1 (Project init), 1-2 (NetworkStack + StorageStack), 1-3 (Container), 1-4 (Gateway Lambda), 1-5 (API Gateway), 1-6 (Cognito), 1-7 (Compute), 1-8 (Web UI), 1-9 (Telegram), 1-10 (Integration tests/documentation)

Details: See `docs/progress.md`. Implementation guide: Use `/implement 1-{N}` skill.

## Phase 2 Progress (5/5 — Complete)

Lambda Container Migration: Run OpenClaw directly in Lambda, eliminating $15/month Fargate fixed cost.

Completed: 2-1 (Lambda Container Image + Handler), 2-2 (CDK LambdaAgentStack), 2-3 (Response Streaming Integration), 2-4 (Session Lifecycle Management), 2-5 (Feature Flag + Documentation)

Cold start: 1.35s, Warm: 0.12s (Lambda Duration). Implementation guide: Use `/lambda-migration 2-{N}` skill. Journey: `docs/lambda-migration-journey.md`.

## Reference Docs

- `docs/architecture.md` — Network, CDK, DynamoDB schema, security model
- `docs/implementation-plan.md` — Bridge protocol, container flow, Telegram strategy
- `docs/cost-optimization.md` — Fargate Spot, API Gateway vs ALB analysis
- `docs/PRD.md` — Product requirements
- `docs/deployment.md` — AWS deployment guide (secrets, build, deploy, verification)
- `docs/development.md` — Local development guide (environment, TDD, coding rules)
- `docs/cold-start-optimization.md` — Cold start optimization (Phase 1 complete, Phase 2 complete via Lambda migration)
- `docs/lambda-migration-plan.md` — Phase 2 Lambda migration plan (architecture, steps, cost analysis)
- `docs/lambda-migration-journey.md` — Phase 2 migration journey (timeline, obstacles, learnings)
