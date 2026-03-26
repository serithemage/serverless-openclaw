# Product: Serverless OpenClaw

Serverless OpenClaw runs the OpenClaw AI agent on-demand on AWS serverless infrastructure. It provides a Web UI (React SPA) and Telegram bot as chat interfaces.

## Goals
- Cost target ~$1/month for personal use (zero idle cost)
- Single-command deployment via `cdk deploy`
- No server management — fully serverless/managed services

## Dual Compute Model
- **Lambda Container Image** (default): Runs OpenClaw's `runEmbeddedPiAgent()` directly. 1.35s cold start, $0 idle cost.
- **ECS Fargate Spot** (fallback): For long-running tasks (>15 min). ~68s cold start.
- Controlled by `AGENT_RUNTIME` env var: `fargate` | `lambda` | `both`

## Interfaces
- **Web Chat UI**: React SPA on S3 + CloudFront, real-time via WebSocket
- **Telegram Bot**: Webhook-based, linked to Web identity via OTP

## Current Status
- Phase 1 (MVP): Complete
- Phase 2 (Lambda Migration): Complete
- Phase 3 (Browser automation, custom skills): Planned
