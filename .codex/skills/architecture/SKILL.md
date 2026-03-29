---
name: architecture
description: References Serverless OpenClaw architecture. Covers network design, CDK stack structure, DynamoDB data model, API protocols, and container design.
allowed-tools: Read, Glob, Grep
---

# Architecture Reference

## Design Documents

- [architecture.md](../../../docs/architecture.md) — VPC/network, security groups, CDK stacks, DynamoDB schema, API protocols, security model
- [implementation-plan.md](../../../docs/implementation-plan.md) — Detailed design based on MoltWorker reference
- [cold-start-optimization.md](../../../docs/cold-start-optimization.md) — Cold start optimization (Phase 1 complete, Phase 2 in progress)

## Core Architecture Principles

1. **Cost minimization**: No NAT Gateway, no ALB, no Interface Endpoints
2. **Serverless-first**: Lambda (events), Fargate Spot (long-running), DynamoDB (PAY_PER_REQUEST)
3. **Single responsibility**: 7 separate Lambdas, 9 separate CDK stacks
4. **Layer separation**: API Gateway → Lambda → Bridge → OpenClaw Gateway
5. **Protocol translation**: Lambda(HTTP) ↔ Bridge ↔ OpenClaw Gateway(JSON-RPC 2.0 WebSocket)

## AGENT_RUNTIME Feature Flag

Controls which agent backend handles requests:

| Value     | Behavior                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fargate` | Route all agent requests to Fargate container (Phase 1 mode)                                                                                          |
| `lambda`  | Route all agent requests to Lambda agent (Phase 2 mode)                                                                                               |
| `both`    | Smart routing via `classifyRoute()`: reuse running Fargate, honor `/heavy`/`/fargate` hints, default to Lambda, fallback to Fargate on Lambda failure |

See [architecture.md §12](../../../docs/architecture.md) for full Lambda architecture details and smart routing rules.

## Lambda Data Flow (Phase 2)

```
Client → API Gateway (WS/REST) → Gateway Lambda → Lambda Agent Function
                                                  → runEmbeddedPiAgent()
                                                  → OpenClaw in-process
```

## CDK Stacks (9 total)

SecretsStack + NetworkStack → StorageStack → {AuthStack, ComputeStack} → ApiStack → WebStack + MonitoringStack + **LambdaAgentStack**
