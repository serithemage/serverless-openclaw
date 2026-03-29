# Chapter 2: MVP in a Weekend

> **Time**: ~8 hours (Feb 9–11)
> **Cost**: $0.00 (development only, no deployment yet)
> **Key Insight**: With a solid plan and TDD, an AI assistant can implement 10 infrastructure steps in a weekend.

## Context

With the architecture designed (Chapter 1), it was time to build. Phase 1 had 10 steps covering everything from project initialization to a fully working Telegram bot. The plan was ambitious: build it all in one weekend.

## The Prompt

The implementation was kicked off step by step, using Claude Code skills:

```
/implement 1-1
```

Each step had its own skill file with goals, deliverables, and validation criteria. But the key "vibe" was always the same — tell the AI what step to implement, and let it figure out the details.

## What Happened

### Day 1 (Feb 9–10): Foundation → Gateway

**Step 1-1: Project Initialization** (~30 min)

```
feat: Phase 1 Step 1-1 프로젝트 초기화
```

- npm workspaces monorepo with 6 packages
- TypeScript config with project references (ES2022, Node16)
- Vitest for testing, ESLint + Prettier for formatting
- Husky git hooks (pre-commit: build + lint + test)

**Step 1-2: Infrastructure Base** (~45 min)

```
feat: Phase 1 Step 1-2 인프라 기반 (NetworkStack + StorageStack)
```

- VPC with **zero NAT Gateways** (the critical cost constraint)
- 5 DynamoDB tables (PAY_PER_REQUEST)
- VPC Gateway Endpoints for DynamoDB and S3

**Step 1-3: Container** (~1 hour)

```
feat: Phase 1 Step 1-3 OpenClaw 컨테이너 — Bridge 서버, OpenClaw 클라이언트, 라이프사이클 관리
```

- Bridge HTTP server (port 8080) — accepts messages from Lambda
- OpenClaw JSON-RPC client — connects to OpenClaw Gateway (port 18789)
- Challenge-response handshake implementation
- Container lifecycle: start OpenClaw → wait for Gateway → connect → ready

**Step 1-4: Gateway Lambdas** (~1.5 hours)

```
feat: Phase 1 Step 1-4 Gateway Lambda — 핸들러 6개, 서비스 5개, 단위 테스트 49개
```

This was the biggest single step — 6 Lambda handlers, 5 services, and **49 unit tests**:

- `ws-connect` — WebSocket connection with JWT verification
- `ws-message` — Route messages to Bridge or PendingMessages
- `ws-disconnect` — Clean up connection records
- `telegram-webhook` — Handle Telegram updates
- `api-handler` — REST endpoints (conversations, status, linking)
- `watchdog` — Auto-shutdown idle containers

The TDD approach was crucial here. Tests were written first, establishing the contract for each handler before implementation.

**Steps 1-5, 1-6, 1-7: CDK Infrastructure** (~2 hours)

```
feat: Phase 1 Steps 1-5, 1-6, 1-7 CDK 인프라 — AuthStack, ComputeStack, ApiStack
```

- AuthStack: Cognito User Pool + App Client
- ComputeStack: ECS Cluster, Fargate Task Definition, Security Groups
- ApiStack: WebSocket API + HTTP API + Lambda function wiring
- Cross-stack decoupling via SSM Parameter Store (no CloudFormation exports)

### Day 2 (Feb 11): UI → Completion

**Step 1-8: Web UI** (~1.5 hours)

```
feat: Phase 1 Step 1-8 웹 채팅 UI + WebStack CDK
```

- React SPA with Vite
- Cognito authentication (SRP — no Hosted UI)
- WebSocket client with `?token=` query auth
- WebStack: S3 + CloudFront with OAC

**Steps 1-9, 1-10: Telegram + Integration** (~2 hours)

```
feat: Phase 1 Steps 1-9, 1-10 Telegram 봇 + 통합 테스트/문서화 — Phase 1 MVP 완료
```

- Telegram webhook handler with secret token verification
- Response streaming: buffer chunks → send on completion (4096 char limit)
- 28 CDK synthesis E2E tests (all 8 stacks verified)
- Full documentation in English

## The Result

After one weekend:

| Metric          | Count |
| --------------- | ----- |
| Lambda handlers | 6     |
| Services        | 5     |
| CDK stacks      | 8     |
| Unit tests      | 49+   |
| E2E tests       | 28    |
| DynamoDB tables | 5     |
| Packages        | 6     |

**What worked well:**

- The skill-based approach (`/implement 1-N`) kept each step focused
- TDD caught integration issues early (especially DynamoDB key formats)
- CDK synthesis tests verified infrastructure without deploying

**What was challenging:**

- WebSocket auth: API Gateway WebSocket doesn't support JWT authorizers — had to verify in Lambda
- Cross-stack references: CloudFormation exports create tight coupling — switched to SSM Parameter Store
- Web build dependency: CDK synth fails if `packages/web/dist/` doesn't exist

## Lessons Learned

1. **Break the work into steps with clear deliverables.** Each `/implement 1-N` step had defined outputs and test criteria. This prevented scope creep within each step.

2. **TDD is non-negotiable for serverless.** You can't easily debug a Lambda in production. The 49 unit tests written during Step 1-4 caught dozens of issues that would have been painful to debug after deployment.

3. **CDK synthesis tests are your safety net.** `Template.fromStack()` with `aws-cdk-lib/assertions` verifies your infrastructure is valid without spending a cent on AWS.

4. **SSM Parameter Store > CloudFormation exports.** Cross-stack exports create ordering dependencies that make independent deployments impossible. SSM decouples stacks completely.

5. **AI can maintain context across steps.** Because CLAUDE.md was updated after each step, the AI always knew what was already built and what patterns to follow.

## Try It Yourself

```bash
# Clone and set up the project
git clone https://github.com/serithemage/serverless-openclaw.git
cd serverless-openclaw
npm install

# Run the full test suite to verify everything works
npm run build
npm run test

# Run CDK synthesis E2E tests
npm run test:e2e

# Look at the CDK stacks
cd packages/cdk && npx cdk synth --quiet
```

### Running Cost

| Phase     | Action                 | Cost  | Cumulative |
| --------- | ---------------------- | ----- | ---------- |
| Design    | Documentation only     | $0.00 | $0.00      |
| MVP Build | Local development only | $0.00 | $0.00      |
