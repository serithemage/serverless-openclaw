# Appendix: Cost Summary

> **Total project AWS cost**: ~$0.25
> **Ongoing monthly cost**: ~$0.23 (within Free Tier) / ~$1-2 (after Free Tier)

## Development Cost

| Phase                    | Duration      | AWS Cost   | Notes                          |
| ------------------------ | ------------- | ---------- | ------------------------------ |
| Ch 1: Design             | 2 hours       | $0.00      | Documentation only             |
| Ch 2: MVP Build          | 8 hours       | $0.00      | Local development              |
| Ch 3: First Deploy       | 4 hours       | ~$0.10     | CDK deploy + debugging         |
| Ch 4: Cold Start         | 6 hours       | ~$0.15     | Multiple Fargate task launches |
| Ch 5: Lambda Migration   | 4 hours       | $0.00      | Lambda Free Tier               |
| Ch 6: Smart Routing      | 3 hours       | $0.00      | Within Free Tier               |
| Ch 7: Release Automation | 2 hours       | $0.00      | No AWS resources               |
| **Total**                | **~29 hours** | **~$0.25** |                                |

## Monthly Cost Breakdown (After Free Tier)

| Service                  | Usage                   | Monthly Cost |
| ------------------------ | ----------------------- | ------------ |
| API Gateway (WebSocket)  | ~1000 connections       | ~$0.01       |
| API Gateway (HTTP)       | ~500 requests           | ~$0.00       |
| Lambda                   | ~2000 invocations       | ~$0.00       |
| DynamoDB                 | ~5000 R/W units         | ~$0.01       |
| S3                       | ~100MB storage          | ~$0.00       |
| CloudFront               | ~1GB transfer           | ~$0.09       |
| ECR                      | ~1.5GB image            | ~$0.15       |
| CloudWatch               | 1 dashboard, 10 metrics | ~$0.00       |
| Fargate Spot (on-demand) | ~2 hours/month          | ~$0.05       |
| **Total**                |                         | **~$0.31**   |

> **Note**: Fargate cost assumes `AGENT_RUNTIME=both` with occasional heavy tasks routed to Fargate. With `AGENT_RUNTIME=lambda`, Fargate cost drops to $0.

## What We Eliminated

These are the services we intentionally avoided to stay under budget:

| Service                 | Would Have Cost | How We Avoided It                         |
| ----------------------- | --------------- | ----------------------------------------- |
| NAT Gateway             | $32+/month      | Fargate Public IP + VPC Gateway Endpoints |
| ALB                     | $18+/month      | API Gateway (WebSocket + HTTP)            |
| VPC Interface Endpoints | $7+/month each  | Gateway Endpoints (free for S3/DynamoDB)  |
| RDS                     | $15+/month      | DynamoDB on-demand (Free Tier)            |
| Fargate (always-on)     | $15+/month      | On-demand only + Lambda default           |
| EC2 (traditional)       | $20+/month      | Fully serverless architecture             |
| **Total avoided**       | **$107+/month** |                                           |

## Cost Evolution

```
Traditional approach:     ~$107/month
Phase 1 (Fargate only):  ~$15/month  (85% reduction)
Phase 2 (Lambda):         ~$0.23/month (99.8% reduction)
Phase 3 (Smart routing):  ~$0.31/month (hybrid, both available)
```

## Cost Per Conversation

Assuming ~100 conversations/month:

| Runtime              | Cost/Conversation   |
| -------------------- | ------------------- |
| Lambda               | ~$0.001 (1/10 cent) |
| Fargate (warm)       | ~$0.003             |
| Fargate (cold start) | ~$0.02              |

## Free Tier Coverage

Within the first 12 months of an AWS account:

| Service     | Free Tier Allowance        | Our Usage               | Covered? |
| ----------- | -------------------------- | ----------------------- | -------- |
| Lambda      | 1M requests, 400K GB-sec   | ~2K requests            | Yes      |
| DynamoDB    | 25 RCU, 25 WCU, 25GB       | ~5K ops, <1GB           | Yes      |
| S3          | 5GB, 20K GET, 2K PUT       | ~100MB                  | Yes      |
| CloudFront  | 1TB transfer, 10M requests | ~1GB                    | Yes      |
| API Gateway | 1M HTTP calls              | ~500                    | Yes      |
| CloudWatch  | 10 metrics, 3 dashboards   | 10 metrics, 1 dashboard | Yes      |

**Within Free Tier, the entire platform costs ~$0.23/month** (mainly ECR storage and minimal CloudWatch).

## Comparison: Traditional vs Serverless OpenClaw

| Metric       | EC2 Instance        | Serverless OpenClaw            |
| ------------ | ------------------- | ------------------------------ |
| Monthly cost | $20-50              | $0.23-1.00                     |
| Cold start   | 0s (always on)      | 1.35s (Lambda) / 0s (pre-warm) |
| Maintenance  | OS updates, patches | Zero                           |
| Scaling      | Manual              | Automatic                      |
| Availability | Single AZ           | Multi-AZ (managed)             |
| Deployment   | SSH + scripts       | `cdk deploy`                   |

The 99% cost reduction comes from a fundamental shift: **pay for what you use, not for what you have**.
