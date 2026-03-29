---
name: context
description: Loads Serverless OpenClaw project context. Provides background knowledge needed for development including project overview, tech stack, architecture decisions, and data models.
user-invocable: false
---

# Serverless OpenClaw Project Context

This skill provides core project context. It is automatically referenced during implementation tasks.

## Project Overview & Key Decisions

See [PRD.md](../../../docs/PRD.md) for details:

- Project definition, goals, tech stack
- 7 key architecture decisions with rationale
- Monorepo structure (6 packages: cdk, gateway, container, lambda, web, shared)
- DynamoDB 5-table schema
- Core data flows

## Phase Status

| Phase                                    | Status           |
| ---------------------------------------- | ---------------- |
| Phase 0 (docs + setup)                   | Complete         |
| Phase 1 (MVP — Fargate + Web + Telegram) | Complete (10/10) |
| Phase 2 (Lambda agent migration)         | Complete         |

**AGENT_RUNTIME feature flag**: `fargate` | `lambda` | `both` (current default)

**Test coverage**: 233 unit tests + 35 E2E tests = **268 total**

## Critical Constraints (Must Follow During Implementation)

1. **No NAT Gateway** — Use Fargate Public IP + VPC Gateway Endpoints
2. **No secrets on disk** — Secrets Manager → environment variables only. Never write API keys/tokens to `openclaw.json`
3. **Telegram webhook-only** — Long polling not allowed (API mutually exclusive)
4. **Bridge Bearer token required** — Authentication on all endpoints except `/health`
5. **IDOR prevention** — userId determined server-side (JWT/connectionId reverse lookup). Ignore client input
6. **RunTask API** — Use `capacityProviderStrategy` only. Cannot specify `launchType` simultaneously
7. **Cost target** — ~$1/month. No ALB, Interface Endpoint, or NAT Gateway creation allowed

## Related Documents

- Full PRD: [docs/PRD.md](../../../docs/PRD.md)
- Architecture: [docs/architecture.md](../../../docs/architecture.md)
- Implementation plan: [docs/implementation-plan.md](../../../docs/implementation-plan.md)
- Cost analysis: [docs/cost-optimization.md](../../../docs/cost-optimization.md)
- Progress: [docs/progress.md](../../../docs/progress.md)
- Cold start optimization: [docs/cold-start-optimization.md](../../../docs/cold-start-optimization.md)
