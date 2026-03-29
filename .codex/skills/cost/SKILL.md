---
name: cost
description: References Serverless OpenClaw cost optimization guidelines. Validates that no resources exceeding the cost target ($1/month) are created during implementation. Use when writing CDK stacks or making infrastructure changes.
allowed-tools: Read, Glob, Grep
---

# Cost Optimization Reference

## Detailed Cost Analysis

Per-service cost breakdown, before/after optimization comparison, checklist:

- [cost-optimization.md](../../../docs/cost-optimization.md)
- [cold-start-optimization.md](../../../docs/cold-start-optimization.md) — Cold start optimization with cost impact analysis (Phase 1 complete, Phase 2 in progress)

## Cost Validation (Required for Infrastructure Changes)

Verify the following resources are **NOT created**:

| Prohibited Resource  | Monthly Cost | Alternative                          |
| -------------------- | ------------ | ------------------------------------ |
| NAT Gateway          | ~$33         | Fargate Public IP                    |
| ALB/ELB              | ~$18-25      | API Gateway                          |
| Interface Endpoint   | ~$7/each     | Public IP for public endpoint access |
| DynamoDB Provisioned | Variable     | PAY_PER_REQUEST                      |
| Lambda in VPC        | Requires NAT | Deploy outside VPC                   |

## Cost Targets

| Category         | Target          |
| ---------------- | --------------- |
| Within Free Tier | ~$0.23/month    |
| After Free Tier  | ~$1.07/month    |
| Maximum allowed  | Under $10/month |

## Lambda Agent Cost (Phase 2)

See [cost-optimization.md §9](../../../docs/cost-optimization.md) for full Lambda cost analysis.

| Resource               | Cost Model    | Notes                               |
| ---------------------- | ------------- | ----------------------------------- |
| Lambda invocations     | Per-request   | 1M requests/month free tier         |
| Lambda duration        | Per GB-second | 400K GB-seconds/month free tier     |
| Lambda container image | ECR storage   | ~$0.10/GB/month after 500MB free    |
| No Fargate idle cost   | —             | Lambda scales to zero automatically |

**Key advantage**: Lambda charges only for actual execution time — no idle Fargate cost when no users are active. For low-traffic usage, Lambda runtime cost approaches $0/month within free tier.
