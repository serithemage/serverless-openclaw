# Project Structure

npm workspaces monorepo with TypeScript project references.

```
packages/
├── shared/        # Types, constants (TABLE_NAMES, KEY_PREFIX, ports, timeouts)
│                  # Imported as @serverless-openclaw/shared
├── cdk/           # AWS CDK infrastructure
│   └── lib/stacks/  # One file per stack (api, auth, compute, lambda-agent, monitoring, network, secrets, storage, web)
│                     # Cross-stack decoupling via SSM Parameter Store (ssm-params.ts)
├── gateway/       # 7 Lambda handlers
│   ├── src/handlers/   # ws-connect, ws-message, ws-disconnect, telegram-webhook, api-handler, watchdog, prewarm
│   └── src/services/   # Shared logic (connections, container, message routing, secrets, etc.)
├── container/     # Fargate container: Bridge HTTP server + OpenClaw JSON-RPC client
├── lambda-agent/  # Lambda Container Image: runs runEmbeddedPiAgent() directly
│   └── src/           # handler, agent-runner, session-sync, session-lock
└── web/           # React SPA (Vite), Cognito auth, WebSocket chat
    └── src/           # components/, hooks/, services/

docs/              # Architecture, deployment, development guides, PRD
__tests__/         # Integration tests
```

## CDK Stack Dependency Order
```
SecretsStack + NetworkStack → StorageStack → {AuthStack, ComputeStack, LambdaAgentStack} → ApiStack → WebStack + MonitoringStack
```

## Data Flow
- **Lambda path** (default): Client → API Gateway → Lambda → Lambda Agent Container → Anthropic API (S3 session sync)
- **Fargate path**: Client → API Gateway (WS/REST) → Lambda → Bridge(:8080) → OpenClaw Gateway(:18789 WS, JSON-RPC 2.0)

## DynamoDB Tables (5)
| Table | PK | SK |
|-------|----|----|
| Conversations | `USER#{userId}` | `CONV#{id}#MSG#{ts}` |
| Settings | `USER#{userId}` | `SETTING#{key}` |
| TaskState | `USER#{userId}` | — |
| Connections | `CONN#{connId}` | — |
| PendingMessages | `USER#{userId}` | `MSG#{ts}#{uuid}` |

Table names from `TABLE_NAMES` in `@serverless-openclaw/shared`.

## Critical Cost Constraints
- No NAT Gateway (`natGateways: 0`)
- No ALB or VPC Interface Endpoints
- DynamoDB PAY_PER_REQUEST only
- No hardcoded S3 bucket names (CDK auto-generates)
