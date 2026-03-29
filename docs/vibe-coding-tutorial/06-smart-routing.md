# Chapter 6: Smart Routing — Best of Both Worlds

> **Time**: ~3 hours (Mar 14–19)
> **Cost**: $0.00 (within Free Tier)
> **Key Insight**: Don't choose between Lambda and Fargate — let the system choose for each request.

## Context

Lambda was fast and cheap but limited (15-minute timeout, `/tmp` workspace, no plugins). Fargate was powerful but slow to start and expensive to idle. The user realized both had a place:

```
Lambda나 Fargate 어느 한 쪽만 쓸게 아니라 병행해서 사용하는 방식으로 하고
작업 성격에 따라 스위칭 하는 구조로 하면 좋겠네
```

_(Instead of using only Lambda or Fargate, let's use both together and switch based on the task type.)_

## The Prompt

The implementation was kicked off with a single directive:

```
이슈 생성하고, 설계 구체화 하고, 테스트 계획 세운다음 구현 및 테스트 작업 진행시켜.
문서화, 리뷰, 릴리즈까지 ralph loop로 진행해.
```

_(Create issues, refine the design, plan tests, then implement and test. Documentation, review, and release via ralph loop.)_

This was a "full auto" prompt — from issue creation to release, all in one go.

## What Happened

### Step 1: Route Classifier Design

The routing logic needed to be simple and predictable. Four rules, in priority order:

```typescript
// packages/gateway/src/services/route-classifier.ts

function classifyRoute(params: ClassifyRouteParams): RouteDecision {
  // Rule 1: Reuse running Fargate container (don't waste it)
  if (taskState?.status === "Running" && taskState.publicIp) {
    return "fargate-reuse";
  }

  // Rule 2: User explicitly requests Fargate
  if (message.startsWith("/heavy") || message.startsWith("/fargate")) {
    return "fargate-new";
  }

  // Rule 3: Default to Lambda (fast, cheap)
  return "lambda";
}

// Rule 4 (in routeMessage): Lambda failure → Fargate fallback
```

### Step 2: Cold Start Preview

A creative solution to Fargate's cold start problem:

```
ECS가 사용되는 작업에 대해서는 컨테이너가 콜드스타트 하는 경우
추가적인 맥락을 람다를 통해서 수집해서 기다리는 시간을 좀 덜 지루하게 만들 수 있지 않을까?
```

_(When ECS cold starts, could we use Lambda to gather context and make the wait less boring?)_

The idea: when a user requests Fargate (via `/heavy` hint), start the container AND invoke Lambda simultaneously. Lambda responds in ~2-5 seconds with a "preview" (tools disabled), while Fargate boots up for the full response.

```
User: "/heavy analyze this codebase"
  │
  ├─ Start Fargate task (40-60s)
  │
  └─ Fire-and-forget: Lambda (disableTools=true, ~2-5s)
       │
       └─ Preview delivered immediately: "I'll analyze the codebase.
          Based on the structure, this appears to be a monorepo
          with 6 packages..."
```

The preview is non-fatal — if Lambda fails, the user just waits for Fargate normally.

### Step 3: Handler Wiring

Both `ws-message` and `telegram-webhook` handlers needed to pass routing deps:

```typescript
routeMessage({
  // ... base deps ...
  agentRuntime: process.env.AGENT_RUNTIME ?? "fargate",
  invokeLambdaAgent: lambdaArn ? invokeLambdaAgent : undefined,
  lambdaAgentFunctionArn: lambdaArn || undefined,
  onColdStartPreview: async (text) => {
    // Push preview to client (WebSocket or Telegram)
  },
});
```

### Debugging Story: Routing Only Goes to Fargate

A week after deployment, a bug was discovered:

```
설계에 의하면 요청 내용에 따라 람다 또는 ECS/Fargate 스팟을 사용하도록 되어 있는데,
실제로는 요청내용과 상관 없이 ECS로만 라우팅이 되는것 같아.
```

_(According to the design, it should route to Lambda or Fargate based on the request. But in practice, everything routes to ECS regardless.)_

**Root Cause**: The `AGENT_RUNTIME` and `LAMBDA_AGENT_FUNCTION_ARN` environment variables were set in CDK but the handlers weren't reading them and passing them to `routeMessage`. Without these values, routing defaulted to Fargate.

**Fix**: Wire the env vars through both handlers:

```typescript
const agentRuntime = process.env.AGENT_RUNTIME ?? "fargate";
const lambdaArn = process.env.LAMBDA_AGENT_FUNCTION_ARN;
```

**Lesson**: CDK setting an env var is only half the job — the code must read and use it.

### Step 4: Session Continuity

A new problem emerged with hybrid routing:

```
봇과 대화를 나눠보면 이전 콘텍스트를 기억 못하는 경우가 있는데
```

_(When chatting with the bot, it sometimes doesn't remember previous context.)_

```
히스토리 통합해서 기억해야 연속성이 생기지 않을까?
```

_(Shouldn't we unify the history so it maintains continuity?)_

Lambda and Fargate had separate session stores — Lambda used S3, Fargate used local filesystem. When routing switched between them, conversation context was lost.

**Fix**: Unified session storage on S3 (`sessions/{userId}/{sessionId}.jsonl`). Both runtimes read/write the same location.

## The Result

| Scenario                             | Before                  | After                        |
| ------------------------------------ | ----------------------- | ---------------------------- |
| Simple chat, no Fargate running      | Lambda ($0)             | Lambda ($0)                  |
| Simple chat, Fargate already running | Lambda + Fargate wasted | **Fargate reuse**            |
| Complex task (/heavy)                | Lambda timeout risk     | **Fargate + Lambda preview** |
| Lambda fails                         | Error to user           | **Fargate auto-fallback**    |
| Cross-runtime conversation           | Context lost            | **Unified S3 sessions**      |

## Lessons Learned

1. **"Use both" is often the right answer.** Lambda vs Fargate isn't an either/or decision. Smart routing lets each request use the optimal runtime.

2. **Preview responses improve perceived performance.** A 2-second partial answer while waiting 40 seconds for the full response makes the experience dramatically better.

3. **Env var wiring is the most common deployment bug.** CDK setting a value and code reading it are two separate concerns that both need to work.

4. **Session unification is essential for hybrid architectures.** If two runtimes can handle the same user's requests, they must share state.

5. **The "ralph loop" works.** A single prompt drove the entire lifecycle: issue → design → test plan → implementation → review → release. This is the power of vibe coding at scale.

## Try It Yourself

```bash
# Deploy with both runtimes
# Set AGENT_RUNTIME=both in CDK context

# Test routing: simple message → Lambda
# (Send a regular message via web UI or Telegram)

# Test routing: Fargate hint
# Send: "/heavy analyze this codebase"
# Observe: quick preview + full Fargate response

# Test fallback: Lambda timeout → Fargate
# (Send a complex task that exceeds Lambda's capabilities)
```

### Running Cost

| Phase            | Action                 | Cost   | Cumulative |
| ---------------- | ---------------------- | ------ | ---------- |
| Design           | Documentation only     | $0.00  | $0.00      |
| MVP Build        | Local development only | $0.00  | $0.00      |
| First Deploy     | CDK deploy + debugging | ~$0.10 | ~$0.10     |
| Cold Start       | Multiple task launches | ~$0.15 | ~$0.25     |
| Lambda Migration | Lambda Free Tier       | $0.00  | ~$0.25     |
| Smart Routing    | Within Free Tier       | $0.00  | ~$0.25     |
