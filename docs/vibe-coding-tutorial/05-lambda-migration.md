# Chapter 5: Lambda Migration — Eliminating Fixed Costs

> **Time**: ~4 hours (Mar 14–15)
> **Cost**: $0.00 (Lambda Free Tier)
> **Key Insight**: Running OpenClaw directly inside Lambda eliminated the Fargate middleman — 1.35s cold start, $0 idle cost.

## Context

Phase 1 used Fargate exclusively. Even with all the cold start optimizations from Chapter 4, Fargate had a fundamental cost problem: ~$15/month when active. The question was whether OpenClaw could run directly inside a Lambda function.

## The Prompt

The investigation started with an exploratory question:

```
OpenClaw 자체를 고쳐서 AWS 람다에서 동작하도록 할 수 있을지 방법을 찾아줘
```

_(Find out if we can modify OpenClaw itself to run on AWS Lambda)_

Then a key strategic discussion:

```
OpenClaw는 엄청나게 빠르게 개발되고 진화되어가는 오픈소스 프로젝트임.
하지만 고정비용이 최대한 들지 않게끔 만들고 싶어.
이 두 가지를 전제로했을때 가장 좋은 접근 방식은 어떤껄까?
```

_(OpenClaw is a rapidly evolving open-source project. But I want to minimize fixed costs. Given both constraints, what's the best approach?)_

## What Happened

### Step 1: Deep Analysis of OpenClaw Internals

Before attempting migration, Claude Code analyzed the entire OpenClaw codebase (~675K lines of TypeScript):

- **Gateway**: WebSocket server on port 18789, JSON-RPC 2.0 protocol
- **Agent runtime**: Pi Agent with `streamSimple()`, in-process embedded mode
- **Session**: JSONL transcript files, append-only with periodic compaction
- **Tools**: bash exec, file read/write/edit, MCP — all in-process
- **Key discovery**: `runEmbeddedPiAgent()` — a function that runs the agent without the full Gateway server

This analysis revealed that the Gateway server (the 30-35s startup bottleneck) was only needed for WebSocket communication. If Lambda could call `runEmbeddedPiAgent()` directly, the Gateway could be bypassed entirely.

### Step 2: Architecture Decision

Three approaches were considered:

| Approach                   | Pros              | Cons                             |
| -------------------------- | ----------------- | -------------------------------- |
| A) OpenClaw as library     | Fastest, cheapest | Tightly coupled to internal APIs |
| B) HTTP API mode           | Clean interface   | Still needs Gateway startup      |
| C) Split control/execution | Flexible          | Complex                          |
| **A/E Hybrid** (chosen)    | **Best of both**  | **Minimal coupling**             |

The hybrid approach: use `runEmbeddedPiAgent()` as a library call (Approach A) with S3-based session sync (from Approach E).

```
최종 권장: 접근법 A/E 하이브리드로 진행해 보자.
```

_(Final recommendation: Let's go with the A/E hybrid approach.)_

### Step 3: Implementation (5 Sub-steps)

The migration was planned as 5 steps and executed via skills:

**2-1: Lambda Container Image + Handler**

- Docker image with OpenClaw installed
- Handler that calls `runEmbeddedPiAgent()` directly
- No Gateway server, no Bridge — direct function invocation

**2-2: CDK LambdaAgentStack**

- Lambda function with container image
- 10GB ephemeral storage (for `/tmp` workspace)
- 15-minute timeout (Lambda maximum)
- SSM parameter for cross-stack reference

**2-3: Response Streaming Integration**

- Lambda returns response synchronously
- Gateway Lambda forwards to WebSocket/Telegram

**2-4: Session Lifecycle Management**

- S3-based session storage (`sessions/{userId}/{sessionId}.jsonl`)
- Download session before agent run, upload after
- Enables context continuity across invocations

**2-5: Feature Flag + Documentation**

- `AGENT_RUNTIME` env var: `fargate` | `lambda` | `both`
- CDK conditionally deploys stacks based on flag
- Documentation and release notes

### Step 4: Deployment and Verification

```
배포해서 실제 E2E테스트를 진행해 줄 수 있어?
```

_(Can you deploy and run actual E2E tests?)_

The deployment succeeded. Lambda cold start: **1.35 seconds**. Warm invocation: **0.12 seconds**.

Compare with Fargate: **40-60 seconds** cold start even after all optimizations.

## The Result

| Metric      | Fargate    | Lambda              | Improvement        |
| ----------- | ---------- | ------------------- | ------------------ |
| Cold start  | ~40s       | 1.35s               | **97% faster**     |
| Warm start  | instant    | 0.12s               | N/A                |
| Idle cost   | ~$15/month | $0                  | **100% reduction** |
| Max runtime | Unlimited  | 15 min              | Trade-off          |
| Full tools  | Yes        | Limited (/tmp only) | Trade-off          |

**Why so fast?** Lambda skips the entire Gateway server startup (30-35s). `runEmbeddedPiAgent()` initializes only what's needed for a single conversation turn.

**Why $0?** Lambda Free Tier includes 1M requests/month and 400,000 GB-seconds of compute. Personal use barely scratches this.

## Lessons Learned

1. **Analyze before migrating.** The deep analysis of OpenClaw's internals (675K lines) revealed `runEmbeddedPiAgent()` — without this discovery, the migration would have been impossible or much slower.

2. **The fastest code is code that doesn't run.** Lambda's speed advantage came from _not_ running the Gateway server, not from any optimization of it.

3. **S3 as session store works surprisingly well.** JSONL files synced to S3 before/after each Lambda invocation provide conversation continuity with minimal latency.

4. **Feature flags enable gradual migration.** `AGENT_RUNTIME=both` allowed running Lambda and Fargate simultaneously during the transition, with no risk of breaking existing users.

5. **The cost story is compelling.** Going from ~$15/month (Fargate) to $0 (Lambda Free Tier) is the kind of result that makes the entire project worthwhile.

## Try It Yourself

```bash
# Deploy with Lambda runtime
# Set AGENT_RUNTIME=lambda in your CDK context or environment

cd packages/cdk
npx cdk deploy --all

# Verify Lambda function exists
aws lambda get-function --function-name serverless-openclaw-lambda-agent

# Test invocation (via WebSocket or Telegram)
# Send a message through the web UI or Telegram bot
# Check CloudWatch logs for Lambda execution time
```

### Running Cost

| Phase            | Action                 | Cost   | Cumulative |
| ---------------- | ---------------------- | ------ | ---------- |
| Design           | Documentation only     | $0.00  | $0.00      |
| MVP Build        | Local development only | $0.00  | $0.00      |
| First Deploy     | CDK deploy + debugging | ~$0.10 | ~$0.10     |
| Cold Start       | Multiple task launches | ~$0.15 | ~$0.25     |
| Lambda Migration | Lambda Free Tier       | $0.00  | ~$0.25     |
