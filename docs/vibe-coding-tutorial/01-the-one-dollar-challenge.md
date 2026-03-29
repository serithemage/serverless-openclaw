# Chapter 1: The $1/Month Challenge

> **Time**: ~2 hours
> **Cost**: $0.00 (design only)
> **Key Insight**: Start with constraints, not features. The $1/month budget forced every architectural decision.

## Context

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source AI agent that runs locally. We wanted to make it available anywhere — via web browser and Telegram — without paying $20-50/month for an always-on server.

The challenge: run a full AI agent platform on AWS for under $1/month.

## The Prompt

The very first prompt set the tone for the entire project:

```
프로젝트 PRD 및 README 초기 작성
```

_(Write the initial PRD and README for the project)_

But the real architectural constraints emerged through follow-up conversation. The key design prompts were:

```
비용 최적화 분석 추가 및 PRD/README 반영
```

_(Add cost optimization analysis and reflect in PRD/README)_

```
Lambda 컨테이너 vs Fargate Spot 비교 분석 추가
```

_(Add Lambda Container vs Fargate Spot comparison analysis)_

## What Happened

Claude Code analyzed the cost structure of running OpenClaw on AWS and produced several documents in rapid succession:

### Step 1: PRD with Cost Constraints

The PRD was written with **cost as the #1 requirement** — not a nice-to-have, but the primary constraint. This shaped every subsequent decision.

### Step 2: Cost Analysis — What NOT to Use

The most valuable output was identifying what to **avoid**:

| Resource                | Monthly Cost | Decision                                      |
| ----------------------- | ------------ | --------------------------------------------- |
| NAT Gateway             | $32+         | **Eliminated** — Use Fargate Public IP        |
| ALB                     | $18+         | **Eliminated** — Use API Gateway              |
| VPC Interface Endpoints | $7+ each     | **Eliminated** — Use Gateway Endpoints (free) |
| RDS                     | $15+         | **Eliminated** — Use DynamoDB on-demand       |
| Fargate (always-on)     | $15+         | **Minimized** — Run on-demand only            |

### Step 3: Architecture Emerges from Constraints

With those eliminations, the architecture practically designed itself:

```
Client → API Gateway (WebSocket/REST) → Lambda → Fargate (on-demand) → OpenClaw
```

Key decisions:

- **API Gateway** instead of ALB ($0 vs $18/month)
- **DynamoDB on-demand** instead of RDS ($0 within Free Tier)
- **Fargate Spot** with auto-shutdown (70% discount, zero idle cost)
- **S3 + CloudFront** for web hosting ($0 within Free Tier)
- **No NAT Gateway** — Fargate gets a public IP directly

### Step 4: Detailed Implementation Plan

The plan was broken into 10 steps, each with clear deliverables and test criteria. This became the Phase 1 roadmap.

## The Result

Six documents were produced in under 2 hours:

- `docs/PRD.md` — Product requirements with cost constraints
- `docs/architecture.md` — Network, CDK, DynamoDB schema, security model
- `docs/cost-optimization.md` — Detailed cost comparison
- `docs/implementation-plan.md` — 10-step build plan
- `README.md` — Project overview

**Estimated monthly cost**: ~$0.23 within AWS Free Tier, ~$1-2 after Free Tier expires.

## Lessons Learned

1. **Constraints drive creativity.** The $1/month budget eliminated obvious-but-expensive solutions (NAT Gateway, ALB, RDS) and led to a more elegant architecture.

2. **Design docs first, code second.** Spending 2 hours on design saved days of rework. Every CDK stack, every Lambda handler, every DynamoDB table was planned before a single line of code.

3. **Vibe coding works for architecture.** Conversational prompts like "add cost optimization analysis" produced thorough documents because the AI could explore trade-offs systematically.

4. **The MoltWorker inspiration.** Referencing Cloudflare's [MoltWorker](https://github.com/cloudflare/moltworker) gave Claude a concrete architecture to adapt, rather than designing from scratch.

## Try It Yourself

Start your own serverless project with a cost-constrained PRD:

```bash
# Initialize a new project
mkdir my-serverless-project && cd my-serverless-project
git init
npm init -y

# Open Claude Code and set your constraints
claude

# Then type:
# "I want to run [your service] on AWS for under $1/month.
#  Analyze the cost of each AWS service and write a PRD
#  with architecture decisions that minimize fixed costs."
```

### Running Cost

| Phase  | Action             | Cost  | Cumulative |
| ------ | ------------------ | ----- | ---------- |
| Design | Documentation only | $0.00 | $0.00      |
