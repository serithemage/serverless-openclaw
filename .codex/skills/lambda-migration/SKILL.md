---
name: lambda-migration
description: Guides Phase 2 Lambda Container Migration steps. Pass a specific step number (2-1 through 2-5) to get the goals, deliverables, validation criteria, and detailed design for that step.
argument-hint: "[step-number, e.g. 2-1]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Phase 2: Lambda Container Migration Guide

Step to implement: **$ARGUMENTS**

## Implementation Procedure

1. Read the detailed plan for the step in the references below
2. Verify that dependent steps are completed
3. Create/modify files specified in the deliverables
4. Write tests first (TDD) before implementing
5. Verify results according to validation criteria
6. Update step status in `docs/progress.md`

## References

- Full migration plan with architecture and design: [lambda-migration-plan.md](../../../docs/lambda-migration-plan.md)
- OpenClaw analysis (internals, API surface, serverless blockers): [openclaw-analysis.md](../../../docs/openclaw-analysis.md)
- Current architecture: [architecture.md](../../../docs/architecture.md)
- Cost constraints: [cost-optimization.md](../../../docs/cost-optimization.md)
- Deployment procedures: [deployment.md](../../../docs/deployment.md)

## Step Overview

| Step | Title                                   | Dependencies | Key Deliverables                        |
| ---- | --------------------------------------- | ------------ | --------------------------------------- |
| 2-1  | Lambda Container Image + Handler        | None         | Dockerfile, handler.ts, session-sync.ts |
| 2-2  | CDK LambdaAgentStack                    | 2-1          | lambda-agent-stack.ts, ECR, IAM         |
| 2-3  | Response Streaming Integration          | 2-1, 2-2     | routeMessage update, WS push, Telegram  |
| 2-4  | Session Lifecycle Management            | 2-1, 2-3     | S3 lifecycle, locking, compaction       |
| 2-5  | Fargate Deprecation + Cost Verification | 2-1~2-4      | Feature flag, docs, cost dashboard      |

## Critical Constraints (Must Check Every Step)

- **Zero OpenClaw code modifications** — Wrapper layer only, upstream compatible
- **Zero fixed costs** — No resources that incur charges while idle
- **No NAT Gateway** — Lambda outside VPC (accesses S3 via public endpoint)
- **No secrets on disk** — API keys via env vars (SSM SecureString resolved at runtime)
- **Backward compatible** — Fargate path must remain functional as fallback
- **Cost target** — Total monthly cost < $1 at low usage (< 100 requests)

## Key Technical Details

### OpenClaw Library Import

```typescript
// Use extensionAPI.js — avoids CLI/Gateway initialization
import { runEmbeddedPiAgent } from "openclaw/dist/extensionAPI.js";
```

### Session File Path Convention

```
S3: s3://{bucket}/sessions/{userId}/{sessionId}.jsonl
Lambda /tmp: /tmp/.openclaw/agents/default/sessions/{sessionId}.jsonl
```

### SessionManager Behavior

- `SessionManager.open(path)` → calls `loadEntriesFromFile(path)`
- File not found → returns empty array (no error)
- Uses sync fs: `readFileSync`, `appendFileSync`, `writeFileSync`
- All operations work on Lambda `/tmp`

### Config Initialization

```typescript
// HOME=/tmp → OpenClaw reads /tmp/.openclaw/openclaw.json
process.env.HOME = '/tmp';
// Minimal config (no gateway server needed)
{ "gateway": { "mode": "local" } }
```

## Post-Validation Tasks

After implementation of each step:

1. Update step status in `docs/progress.md`
2. Check if `docs/architecture.md` needs updating
3. Run full test suite: `npm run test && npm run test:e2e`
