# Serverless OpenClaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![AWS CDK](https://img.shields.io/badge/AWS_CDK-2.x-orange.svg)](https://aws.amazon.com/cdk/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Alpha](https://img.shields.io/badge/Status-Alpha-red.svg)](#)

> **⚠️ Alpha — Development in Progress**
>
> This project is in an early alpha stage and has **not been fully tested** in production environments.
> It involves LLM API calls, which can incur **unexpected costs** and may expose **security risks** if misconfigured.
> **Use for development and testing purposes only.** The authors are not responsible for any costs or damages arising from its use.

An open-source project that runs [OpenClaw](https://github.com/openclaw/openclaw) on-demand on AWS serverless infrastructure, providing a web UI and Telegram as interfaces.

Inspired by the architecture of [Cloudflare MoltWorker](https://github.com/cloudflare/moltworker), this project delivers an independent serverless solution optimized for the AWS ecosystem.

## Key Features

- **Serverless On-demand Execution**: Minimizes cost (~$1/month) with dual compute — Lambda Container (default, zero idle cost) or ECS Fargate Spot (fallback)
- **Lambda Agent Runtime**: Runs OpenClaw directly in Lambda with 1.35s cold start, $0 idle cost, and S3 session persistence
- **Predictive Pre-Warming**: Optional EventBridge-scheduled container pre-warming eliminates cold start during active hours (0s first response)
- **Web Chat UI**: Real-time chat interface built with React SPA (hosted on S3 + CloudFront)
- **Telegram Bot Integration**: Chat with the AI agent from anywhere via Telegram, with Web-Telegram identity linking for container sharing
- **Multi-LLM Support**: Choose your preferred LLM provider — Claude, GPT, DeepSeek, and more
- **Task Automation**: Automate various tasks through OpenClaw skills
- **One-command Deployment**: Deploy the entire infrastructure with a single `cdk deploy`

## Project Goals

### Cost

- Operate at **under $1-2/month** for personal use (~$0.23 within Free Tier)
- 70% compute cost reduction with ECS Fargate Spot
- Eliminate $18-25/month fixed costs by using API Gateway instead of ALB
- Zero idle costs with automatic container termination during inactivity

### Management

- Deploy/update the entire infrastructure with a single `cdk deploy` command
- No server management required — all components are serverless or managed services
- OpenClaw version updates handled by changing the Docker image tag
- No separate monitoring infrastructure needed thanks to CloudWatch-based logging

### Scalability

- Easily adjust Fargate task specifications (vCPU, memory) via CDK configuration
- Multi-channel extensible Gateway architecture (Telegram, Discord, Slack, etc.)
- Feature extensibility through custom Skills
- Automatic traffic scaling with DynamoDB on-demand mode

### Security

- AWS Cognito-based JWT authentication — token verification applied to all API requests
- HTTPS enforced (CloudFront + API Gateway)
- Secrets managed via SSM Parameter Store SecureString
- Least-privilege IAM roles applied to Fargate containers
- Telegram webhook protected with secret token verification to prevent spoofing
- Public subnet + multi-layer defense (Security Group + Bridge token authentication + TLS + localhost binding)

## Architecture

```mermaid
graph TB
    User[User]

    subgraph "Interface"
        WebUI[React SPA\nS3 + CloudFront]
        TGBot[Telegram Bot]
    end

    subgraph "API Layer"
        APIGW[API Gateway\nWebSocket + REST]
        Lambda_GW[Gateway Lambda\nRouting/Auth/Container Management]
    end

    subgraph "Authentication"
        Cognito[AWS Cognito\nUser Pool]
    end

    subgraph "Compute"
        LambdaAgent[Lambda Agent Container\nrunEmbeddedPiAgent]
        Fargate[ECS Fargate Task\nOpenClaw Container]
    end

    subgraph "Storage"
        DynamoDB[(DynamoDB\nConversation History/Settings)]
        S3[(S3\nFiles/Backups)]
    end

    User --> WebUI
    User --> TGBot
    WebUI --> APIGW
    TGBot --> Lambda_GW
    APIGW --> Lambda_GW
    Lambda_GW --> Cognito
    Lambda_GW --> LambdaAgent
    Lambda_GW -.-> Fargate
    LambdaAgent --> DynamoDB
    LambdaAgent --> S3
    Fargate --> DynamoDB
    Fargate --> S3
```

## Tech Stack

| Layer            | Technology                                                |
| ---------------- | --------------------------------------------------------- |
| **IaC**          | AWS CDK (TypeScript)                                      |
| **API**          | API Gateway (WebSocket + REST)                            |
| **Gateway**      | Lambda (Node.js/TypeScript)                               |
| **Runtime**      | Lambda Container Image (primary) / ECS Fargate (fallback) |
| **Frontend**     | React + Vite + TypeScript                                 |
| **Auth**         | AWS Cognito                                               |
| **DB**           | DynamoDB                                                  |
| **File Storage** | S3                                                        |
| **Monitoring**   | CloudWatch                                                |
| **Messenger**    | Telegram Bot API                                          |

## Roadmap

### Phase 1: MVP (Complete)

- On-demand deployment of OpenClaw containers on AWS
- Web chat UI + Telegram bot integration
- AI conversation/chat + task automation
- Cognito authentication + data persistence

### Phase 2: Lambda Migration (Complete)

- Lambda Container Image runtime (zero idle cost)
- S3 session persistence with DynamoDB concurrency control
- `AGENT_RUNTIME` feature flag (fargate/lambda/both)
- Cold start: 1.35s, Warm: 0.12s

### Phase 3: Expansion

- Browser automation (headless Chromium)
- Custom Skills development support
- Settings management UI

### Phase 4: Advanced Features

- CloudWatch alerts + cost dashboard
- EventBridge-based scheduled task execution
- Additional messenger support (Discord, Slack)

## Estimated Cost

Extreme cost optimization with Lambda Container + API Gateway. (Assuming 100 requests/month, ~1.5s each)

| Runtime              | Monthly Cost (Free Tier) | Monthly Cost (After) |
| -------------------- | ------------------------ | -------------------- |
| **Lambda (default)** | **~$0.01/month**         | **~$0.01/month**     |
| Fargate (fallback)   | ~$0.27/month             | ~$1.11/month         |

Key: Lambda eliminates all idle costs. Fargate Spot available as fallback for long-running tasks (>15 min).

**Predictive Pre-Warming** (optional): Adds ~$0.003/hour on Spot when enabled. A weekday 1-hour schedule costs ~$0.07/month extra but eliminates the ~68s cold start entirely.

Detailed analysis: [Cost Optimization Document](docs/cost-optimization.md)

### Pre-Warming Configuration

Pre-warming is disabled by default. To enable, add to `.env`:

```bash
# Comma-separated EventBridge cron expressions
PREWARM_SCHEDULE=0 9 ? * MON-FRI *          # Weekdays at 9 AM UTC
# Duration in minutes to keep container alive (default: 60)
PREWARM_DURATION=60
```

Then redeploy: `cd packages/cdk && npx cdk deploy ApiStack`

## Claude Code Skills

Skills are provided that automatically load project context in Claude Code during development.

| Skill                | Invocation              | Description                                                |
| -------------------- | ----------------------- | ---------------------------------------------------------- |
| **context**          | Auto-loaded             | Project overview, tech stack, key decisions                |
| **implement**        | `/implement 1-3`        | Guide for Phase 1 implementation steps                     |
| **lambda-migration** | `/lambda-migration 2-1` | Guide for Phase 2 Lambda migration steps                   |
| **architecture**     | `/architecture`         | Network, data model, CDK stack reference                   |
| **security**         | `/security`             | Security checklist (Bridge defense, IDOR, secrets)         |
| **cost**             | `/cost`                 | Cost target verification (prohibited resources, checklist) |

## Project Structure

```
serverless-openclaw/
├── packages/
│   ├── shared/        # Shared types, constants
│   ├── cdk/           # AWS CDK infrastructure definitions
│   ├── gateway/       # Lambda functions (API Gateway handlers)
│   ├── container/     # Fargate container (Bridge server)
│   ├── lambda-agent/  # Lambda Container Image (OpenClaw agent runtime)
│   └── web/           # React SPA (Vite)
├── docs/              # Design documents
└── references/        # Reference projects (MoltWorker, etc.)
```

Organized as an npm workspaces monorepo with TypeScript project references.

## Getting Started

```bash
npm install          # Install dependencies
cp .env.example .env # Configure AWS profile (edit .env)
npm run build        # TypeScript build
npm run lint         # ESLint check
npm run format       # Prettier formatting
npm run test         # Unit tests (233 tests)
npm run test:e2e     # E2E tests (CDK synth, 35 tests)
```

AWS deployment: [Deployment Guide](docs/deployment.md) | Local development details: [Development Guide](docs/development.md)

## Tutorial

Follow the full journey of building this project through conversational AI coding:

**[Vibe Coding Tutorial](docs/vibe-coding-tutorial/README.md)** — 7 chapters covering idea → infrastructure → deployment → optimization → hybrid architecture

| Chapters     | Time      | Cost   | Key Topics                                                                               |
| ------------ | --------- | ------ | ---------------------------------------------------------------------------------------- |
| 7 + appendix | ~29 hours | ~$0.25 | CDK stacks, cold start optimization, Lambda migration, smart routing, release automation |

## Documentation

- [PRD (Product Requirements Document)](docs/PRD.md)
- [Architecture Design](docs/architecture.md)
- [Detailed Design & Implementation Plan](docs/implementation-plan.md)
- [Cost Optimization Analysis](docs/cost-optimization.md)
- [Deployment Guide](docs/deployment.md)
- [Development Guide](docs/development.md)
- [Project Progress Plan](docs/progress.md)
- [User Guide (Quick Start)](docs/user-guide.md)
- [OpenClaw Architecture Analysis](docs/openclaw-analysis.md)
- [Lambda Migration Plan](docs/lambda-migration-plan.md)
- [Lambda Migration Journey](docs/lambda-migration-journey.md)

## Contributing

Contributions are welcome! Please read the guidelines below before submitting.

### How to Contribute

1. **Bug fixes and small improvements** — Submit a Pull Request directly
2. **Major features or architecture changes** — Open a GitHub Issue first to discuss the approach
3. **Questions** — Open a GitHub Discussion

### Before Submitting a PR

- Fork the repository and create a feature branch from `main`
- Run the full build and test suite locally:
  ```bash
  npm run build && npm run lint && npm run test && npm run test:e2e
  ```
- Keep each PR focused on a **single change**
- Provide a clear description of what changed and why
- Ensure all CI checks pass

### Development Setup

```bash
git clone https://github.com/<your-fork>/serverless-openclaw.git
cd serverless-openclaw
npm install
cp .env.example .env   # Configure AWS profile
npm run build
npm run test            # Unit tests (233 tests)
npm run test:e2e        # E2E tests (35 tests)
```

For detailed local development instructions, see the [Development Guide](docs/development.md).

### Code Style

- TypeScript strict mode with ES2022 target
- `.js` extension required in all import paths
- ESLint + Prettier enforced via Git hooks (pre-commit)
- TDD required — write tests before implementation (except `packages/web`)

### AI-Assisted Contributions

AI-generated code is welcome. When submitting AI-assisted PRs:

- Indicate in the PR title or description that AI tools were used
- Document the testing level (untested / lightly tested / fully tested)
- Confirm that you understand what the code does

### Security Reporting

If you discover a security vulnerability, please **do not** open a public issue. Instead, report it via GitHub's private vulnerability reporting feature or contact the maintainers directly.

A complete report should include: severity level, affected components, reproduction steps, and suggested fixes.

## License

MIT License
