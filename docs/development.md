# Development Guide

This guide covers local development environment setup and workflows for contributing to the Serverless OpenClaw project.

---

## 1. Local Development Environment Setup

### Required Tools

| Tool        | Minimum Version | Purpose                             |
| ----------- | --------------- | ----------------------------------- |
| Node.js     | v22+            | Runtime                             |
| npm         | v9+             | Package manager (workspaces)        |
| Docker      | Latest          | Container build/test                |
| AWS CLI     | v2              | CDK deployment, resource inspection |
| AWS CDK CLI | v2.170+         | Infrastructure deployment           |

### Initial Setup

```bash
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw

# Install dependencies (all packages)
npm install

# TypeScript build
npm run build

# Git hooks setup (husky — runs automatically with npm install)
# pre-commit: build + lint + unit tests
# pre-push: E2E tests
```

### AWS Profile Configuration

Copy the example file and set your AWS profile:

```bash
cp .env.example .env
# Edit .env:
#   AWS_PROFILE=your-aws-profile-name
#   AWS_REGION=ap-northeast-2
```

Load before running CDK or AWS CLI commands:

```bash
export $(cat .env | xargs)
```

> `.env` is in `.gitignore` and will not be committed. See `.env.example` for the template.

---

## 2. Project Structure

```
serverless-openclaw/
├── packages/
│   ├── shared/        # Shared types, constants (TABLE_NAMES, BRIDGE_PORT, etc.)
│   ├── gateway/       # 7 Lambda handlers + 9 services
│   ├── container/     # Fargate container (Bridge server + OpenClaw client)
│   ├── lambda-agent/  # Lambda Container Image (OpenClaw agent runtime)
│   ├── web/           # React SPA (Vite + TypeScript)
│   └── cdk/           # AWS CDK infrastructure definitions (9 stacks)
├── docs/            # Design/deployment/development docs
├── scripts/         # Deployment helper scripts
├── references/      # Reference projects (excluded from build/test)
├── vitest.config.ts        # Unit test config
└── vitest.e2e.config.ts    # E2E test config
```

### Package Dependencies

```
shared ← gateway
shared ← container
shared ← cdk
         web (Vite bundler resolves shared directly)
```

Managed as an npm workspaces monorepo + TypeScript project references. Inter-package dependencies use `"*"` (`"workspace:*"` is pnpm-specific).

---

## 3. Build Commands

| Command            | Description                                    |
| ------------------ | ---------------------------------------------- |
| `npm run build`    | TypeScript build (`tsc --build`, all packages) |
| `npm run lint`     | ESLint check (`packages/**/*.ts`)              |
| `npm run format`   | Prettier formatting                            |
| `npm run test`     | Unit tests (vitest)                            |
| `npm run test:e2e` | E2E tests (vitest, `*.e2e.test.ts`)            |

### CDK Commands

```bash
cd packages/cdk
npx cdk synth        # Generate CloudFormation templates
npx cdk diff         # Preview changes
npx cdk deploy       # Deploy to AWS
npx cdk destroy      # Delete resources
```

---

## 4. Per-Package Development

### shared

Defines shared types and constants. Since all other packages reference this, check the impact scope when making changes.

- `src/constants.ts` — TABLE_NAMES, KEY_PREFIX, BRIDGE_PORT, timeouts, etc.
- `src/types.ts` — Shared type definitions

### gateway

Consists of 7 Lambda handlers and 9 services.

```
packages/gateway/
├── src/
│   ├── handlers/    # ws-connect, ws-disconnect, ws-message,
│   │                # telegram-webhook, api-handler, watchdog, prewarm
│   ├── services/    # task-state, connections, conversations,
│   │                # container, message, telegram,
│   │                # identity, lambda-agent, secrets
│   └── index.ts     # Handler re-export
└── __tests__/       # Unit tests (vitest)
```

**DI pattern:** All services receive an injected `send` function. This can be replaced with a mock in tests.

```typescript
// Example: createTaskStateService(send)
const send = vi.fn();
const service = createTaskStateService(send);
```

### container

The Bridge server and OpenClaw client running on Fargate.

```
packages/container/
├── src/
│   ├── bridge.ts        # HTTP server (Express, Bearer token auth)
│   ├── openclaw-client.ts  # JSON-RPC 2.0 / MCP over WebSocket
│   └── lifecycle.ts     # Container lifecycle management
├── Dockerfile
└── start-openclaw.sh
```

### web

React SPA (Vite + TypeScript). Cognito SRP auth, WebSocket real-time communication.

```
packages/web/
├── src/
│   ├── components/   # Auth/, Chat/, Status/
│   ├── hooks/        # useAuth, useWebSocket
│   └── services/     # auth, websocket, api
├── vite.config.ts
└── index.html
```

**Local development:**

```bash
cd packages/web

# Configure .env.local (requires deployed AWS resources)
cat > .env.local << 'EOF'
VITE_WS_URL=wss://<api-id>.execute-api.<region>.amazonaws.com/prod
VITE_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com
VITE_COGNITO_USER_POOL_ID=<user-pool-id>
VITE_COGNITO_CLIENT_ID=<client-id>
EOF

npx vite dev   # http://localhost:5173
```

### cdk

Consists of 9 CDK stacks.

| Stack            | Key Resources                                                      |
| ---------------- | ------------------------------------------------------------------ |
| SecretsStack     | SSM SecureString parameters (5 secrets)                            |
| NetworkStack     | VPC, public subnets, VPC Gateway Endpoints, Security Group         |
| StorageStack     | 5 DynamoDB tables, S3, ECR                                         |
| AuthStack        | Cognito User Pool, App Client                                      |
| ComputeStack     | ECS cluster, Fargate Task Definition                               |
| LambdaAgentStack | Lambda Container Image (DockerImageFunction, ARM64, 2048MB, 15min) |
| ApiStack         | WebSocket API, HTTP API, 7 Lambda functions, EventBridge           |
| WebStack         | S3 (web assets), CloudFront (OAC)                                  |
| MonitoringStack  | CloudWatch Dashboard (6 rows, 10 custom metrics)                   |

**Dependencies:** SecretsStack + NetworkStack → StorageStack → {AuthStack, ComputeStack, LambdaAgentStack} → ApiStack → WebStack + MonitoringStack

---

## 5. TDD Workflow

**All implementations except UI (web package) follow TDD.**

1. **Write tests first** — write a failing test
2. **Minimal implementation** — write the minimum code to pass the test
3. **Refactor** — clean up code (keeping tests passing)

```bash
# Run a specific test file
npx vitest run packages/gateway/__tests__/services/message.test.ts

# Watch mode
npx vitest packages/gateway/__tests__/services/message.test.ts
```

### Test Writing Rules

- `vi.mock` hoisting: use `vi.hoisted()` when referencing variables in module-level mocks
- AWS SDK send binding: cast as `ddb.send.bind(ddb) as (cmd: any) => Promise<any>`
- Use DI pattern: inject `send` function as a mock

---

## 6. Git Hooks

Managed with husky and configured automatically.

| Hook         | Execution                                       | Purpose                                 |
| ------------ | ----------------------------------------------- | --------------------------------------- |
| `pre-commit` | `npm run build && npm run lint && npm run test` | Ensure build, lint, and unit tests pass |
| `pre-push`   | `npm run test:e2e`                              | Ensure E2E tests pass                   |

> You can bypass hooks with the `--no-verify` flag, but this is not recommended as it may cause CI failures.

---

## 7. CDK Development

### Pre-synth Checklist

1. `npm run build` — TypeScript build succeeds
2. `cd packages/web && npx vite build` — web dist/ generated
3. Secrets Manager secrets exist (only for deployment)

### When Adding a New Stack

1. Create a stack file in `packages/cdk/lib/stacks/`
2. Add export to `packages/cdk/lib/stacks/index.ts`
3. Create instance + wire dependencies in `packages/cdk/bin/app.ts`
4. Add stack verification to E2E tests

---

## 8. Coding Conventions

### TypeScript

- **Target:** ES2022
- **Module:** Node16 resolution
- **strict** mode enabled
- **`.js` extension required** in import paths (ESM)

```typescript
// Good
import { TABLE_NAMES } from "@serverless-openclaw/shared/constants.js";

// Bad
import { TABLE_NAMES } from "@serverless-openclaw/shared/constants";
```

### General Rules

- Follow ESLint + Prettier configuration
- Use `"*"` for inter-package dependencies (npm workspaces)
- Never hardcode environment variables/secrets in code
- Never hardcode S3 bucket names (CDK auto-generates them)

### Critical Constraints

Mandatory rules to prevent cost explosion or security incidents:

- Never create NAT Gateways (`natGateways: 0`)
- Never create ALB or VPC Interface Endpoints
- DynamoDB must use `PAY_PER_REQUEST` only
- userId must only be generated server-side (IDOR prevention)
- Use `capacityProviderStrategy` instead of `launchType` for RunTask calls

Details: see [CLAUDE.md](../CLAUDE.md)
