# Cloudflare Containers Migration Guide

## Overview

This document describes the migration from AWS Serverless (Fargate + Lambda + API Gateway + DynamoDB) to Cloudflare Containers (Workers + Containers + D1 + R2).

## Architecture Comparison

### Before (AWS)
```
Client → API Gateway (WS/REST) → Lambda → Bridge(:8080) → OpenClaw(:18789)
                                    ↕
                                 DynamoDB
```

- 7 CDK Stacks (Network, Storage, Auth, Compute, Api, Web, Monitoring)
- 6 Lambda functions (ws-connect, ws-message, ws-disconnect, telegram-webhook, api-handler, watchdog)
- Fargate container with public IP discovery
- DynamoDB (5 tables, PAY_PER_REQUEST)
- S3 for workspace persistence
- CloudFront + S3 for web hosting
- Cognito for authentication

### After (Cloudflare)
```
Client → Worker (HTTP/WS/REST) → Container (Bridge:8080 + OpenClaw:18789)
                ↕
            D1 / R2 / KV
```

- 1 Cloudflare Worker (replaces all Lambda + API Gateway)
- Cloudflare Container via Durable Object (replaces Fargate)
- D1 SQLite database (replaces DynamoDB)
- R2 object storage (replaces S3)
- KV namespace (replaces DynamoDB Connections table)
- Worker Assets (replaces CloudFront + S3 for web hosting)
- Cognito authentication preserved (verified by Worker)

## Key Benefits

1. **Simpler architecture**: 1 Worker replaces 7 CDK stacks + 6 Lambdas
2. **Direct WebSocket forwarding**: No callback URL / API Gateway Management API
3. **No VPC/networking**: No NAT Gateway, security groups, or public IP discovery
4. **Automatic container lifecycle**: `sleepAfter` replaces watchdog Lambda
5. **Global edge deployment**: Worker runs at Cloudflare edge worldwide
6. **Simpler deployment**: `wrangler deploy` replaces CDK stack management

## Package Structure

```
packages/
├── shared/      # Types + constants (unchanged, Cloudflare constants added)
├── worker/      # NEW: Cloudflare Worker (replaces gateway + cdk)
├── container/   # ADAPTED: Dockerfile.cloudflare + bridge-cloudflare.ts
├── web/         # UNCHANGED: React SPA (env vars point to Worker URL)
├── cdk/         # LEGACY: AWS CDK stacks (kept for reference)
└── gateway/     # LEGACY: Lambda handlers (kept for reference)
```

## New Files

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Cloudflare Worker + Container configuration |
| `migrations/0001_init.sql` | D1 database schema |
| `packages/worker/src/index.ts` | Worker entry point (routes, auth, WebSocket) |
| `packages/worker/src/container.ts` | Container class (Durable Object) |
| `packages/worker/src/env.ts` | Environment type definitions |
| `packages/worker/src/services/db.ts` | D1 database operations |
| `packages/worker/src/services/auth.ts` | JWT verification (Cognito) |
| `packages/worker/src/services/telegram.ts` | Telegram Bot API helper |
| `packages/container/Dockerfile.cloudflare` | Container image (linux/amd64) |
| `packages/container/src/index-cloudflare.ts` | Container entry point (no AWS) |
| `packages/container/src/bridge-cloudflare.ts` | Simplified Bridge server |
| `packages/container/src/bridge-ws.ts` | WebSocket handler for direct forwarding |

## Deployment Steps

### 1. Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 2. Create Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create serverless-openclaw-db
# → Copy the database_id to wrangler.jsonc

# Create R2 bucket
wrangler r2 bucket create serverless-openclaw-data

# Create KV namespace
wrangler kv namespace create SESSIONS
# → Copy the id to wrangler.jsonc
```

### 3. Apply D1 Migrations

```bash
npm run cf:db:migrate
```

### 4. Set Secrets

```bash
npx wrangler secret put BRIDGE_AUTH_TOKEN
npx wrangler secret put OPENCLAW_GATEWAY_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_SECRET_TOKEN
```

### 5. Build and Deploy

```bash
# Build web UI
npm run build --workspace=packages/web

# Deploy Worker + Container
npm run cf:deploy
```

### 6. Configure Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://serverless-openclaw.your-subdomain.workers.dev/api/telegram/webhook",
    "secret_token": "'${TELEGRAM_SECRET_TOKEN}'"
  }'
```

## Data Flow Changes

### WebSocket (Web Client)
**Before:**
1. Client → API GW WebSocket → ws-connect Lambda (verify JWT, save connection)
2. Client sends message → ws-message Lambda → HTTP to Bridge → callback to API GW → Client

**After:**
1. Client → Worker `/api/ws?token=JWT` → verify JWT → `container.fetch(wsUpgrade)` → Container
2. Client sends message → Container Bridge (WebSocket) → OpenClaw → stream back to Client

### Telegram
**Before:**
1. Telegram → webhook Lambda → routeMessage → HTTP to Bridge → callback sender → Telegram API

**After:**
1. Telegram → Worker `/api/telegram/webhook` → `container.fetch(POST /message)` → response → Telegram API

### REST API
**Before:**
1. Client → API GW HTTP → api-handler Lambda → DynamoDB

**After:**
1. Client → Worker `/api/v1/*` → D1 database

## Cost Comparison

| Component | AWS Cost | Cloudflare Cost |
|-----------|----------|-----------------|
| Compute | Fargate Spot ~$0.30/mo | Containers (included in Workers plan) |
| API Gateway | ~$0.10/mo | Workers (included) |
| Lambda | ~$0.01/mo | Workers (included) |
| Database | DynamoDB ~$0.05/mo | D1 (5M reads/day free) |
| Storage | S3 ~$0.01/mo | R2 (10GB free) |
| CDN/Hosting | CloudFront ~$0.01/mo | Workers Assets (included) |
| Auth | Cognito (50K MAU free) | Cognito (external, free tier) |
| **Total** | **~$0.50-1.00/mo** | **~$5/mo (Workers Paid plan)** |

Note: Cloudflare Workers Paid plan ($5/mo) is required for Containers.
The cost profile shifts from pay-per-use to a flat subscription model.

## Migration Checklist

- [x] Create Worker package (`packages/worker/`)
- [x] Create D1 schema (`migrations/0001_init.sql`)
- [x] Create Container class (`OpenClawContainer`)
- [x] Adapt container Dockerfile for linux/amd64
- [x] Add WebSocket support to Bridge server
- [x] Create simplified Bridge (no AWS callbacks)
- [x] Implement JWT verification in Worker
- [x] Implement D1 database operations
- [x] Create Telegram webhook handler
- [x] Create REST API endpoints
- [x] Update wrangler.jsonc configuration
- [ ] Create Cloudflare resources (D1, R2, KV)
- [ ] Set secrets via wrangler
- [ ] Deploy and test
- [ ] Migrate existing DynamoDB data to D1
- [ ] Update Telegram webhook URL
- [ ] DNS cutover (if using custom domain)
