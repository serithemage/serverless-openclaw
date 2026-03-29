# Vibe Coding Tutorial: Building Serverless OpenClaw

> How one developer built a full-stack serverless AI agent platform on AWS — for $1/month — using conversational AI coding with Claude Code.

## What Is This?

This tutorial reconstructs the real development journey of [Serverless OpenClaw](../../README.md), built entirely through "vibe coding" — conversational prompts to an AI coding assistant (Claude Code). Every prompt, decision, failure, and fix is documented from actual conversation logs.

**You'll learn:**

- How to direct an AI assistant to build production infrastructure
- AWS serverless architecture patterns (CDK, Lambda, Fargate, DynamoDB)
- Real debugging stories — what breaks and how to fix it
- Cost optimization techniques that reduced hosting from ~$18/month to ~$0.23/month

## Prerequisites

- Basic TypeScript/Node.js knowledge
- AWS account with CDK bootstrapped
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Familiarity with AWS services (Lambda, DynamoDB, API Gateway) is helpful but not required

## Table of Contents

| #   | Chapter                                                    | Time     | Key Topics                                   |
| --- | ---------------------------------------------------------- | -------- | -------------------------------------------- |
| 1   | [The $1/Month Challenge](01-the-one-dollar-challenge.md)   | ~2 hours | PRD, architecture design, cost analysis      |
| 2   | [MVP in a Weekend](02-mvp-in-a-weekend.md)                 | ~8 hours | 10-step Phase 1, CDK stacks, TDD             |
| 3   | [Deployment Reality Check](03-deployment-reality-check.md) | ~4 hours | Docker, secrets, auth, first real deploy     |
| 4   | [The Cold Start Battle](04-cold-start-battle.md)           | ~6 hours | Docker optimization, CPU tuning, pre-warming |
| 5   | [Lambda Migration](05-lambda-migration.md)                 | ~4 hours | Phase 2, embedded agent, S3 sessions         |
| 6   | [Smart Routing](06-smart-routing.md)                       | ~3 hours | Hybrid execution, cold start preview         |
| 7   | [Release Automation](07-release-automation.md)             | ~2 hours | Skills, parallel review, GitHub releases     |
| 8   | [Appendix: Cost Summary](appendix-cost-summary.md)         | —        | Full cost breakdown and comparison           |

**Total estimated time**: ~29 hours across 5 weeks (Feb 8 – Mar 19, 2026)

## Timeline

```
Feb 8-9   ████░░░░░░░░░░░░░░░░  Design & planning
Feb 9-11  ████████░░░░░░░░░░░░  Phase 1 MVP (10 steps)
Feb 12-13 ████████████░░░░░░░░  First deployment + debugging
Feb 13-16 ████████████████░░░░  Cold start optimization (#2-#9)
Feb 25-26 ████████████████░░░░  OpenClaw deep analysis
Mar 14-15 ██████████████████░░  Phase 2 Lambda migration + releases
Mar 18-19 ████████████████████  Smart routing + session continuity
```

## How to Read This Tutorial

Each chapter follows a consistent structure:

- **Context** — What we're trying to achieve
- **The Prompt** — The actual prompt given to Claude Code (the "vibe")
- **What Happened** — Step-by-step narrative of the AI's work
- **The Result** — Output, metrics, what was produced
- **Lessons Learned** — Insights and gotchas
- **Try It Yourself** — Reproducible commands

> **Note**: Prompts were originally in Korean. They are shown verbatim with English translations where helpful.

---

_Generated from Claude Code conversation logs on 2026-03-29._
_Last log analyzed: session `787dc3e3` (2026-03-19)_
