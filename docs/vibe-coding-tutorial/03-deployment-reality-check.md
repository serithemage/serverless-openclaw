# Chapter 3: Deployment Reality Check

> **Time**: ~4 hours (Feb 12–13)
> **Cost**: ~$0.10 (first AWS deployment)
> **Key Insight**: The gap between "CDK synth passes" and "it actually works on AWS" is where the real learning happens.

## Context

Phase 1 was complete — 8 CDK stacks, 6 Lambda handlers, 49 unit tests, 28 E2E tests. Everything synthesized perfectly. Time to deploy to AWS and find out what "works locally" really means.

## The Prompt

There wasn't a single "deploy" prompt. Instead, deployment uncovered a cascade of issues that each required investigation:

```
fix: separate telegram webhook secret and fix Docker build for deployment
```

```
fix: container env var alignment and Node 22 upgrade for OpenClaw CLI
```

```
fix: refactor OpenClaw client, increase Fargate memory to 1024 MiB
```

## What Happened

### Debugging Story #1: Docker Build in a Monorepo

**Symptom**: Docker build failed — couldn't find workspace dependencies.

**Root Cause**: The Dockerfile used `npm ci` which triggered husky's `prepare` script inside the container, which failed because git wasn't available.

**Fix**:

```dockerfile
# Delete the prepare script before installing
RUN npm pkg delete scripts.prepare && npm ci
```

**Time Lost**: ~30 minutes

---

### Debugging Story #2: Telegram Webhook Secret

**Symptom**: Telegram webhook registration failed with cryptic error.

**Root Cause**: Telegram's `secret_token` validation rejects strings containing `:` (colon). The initial implementation tried to use the bot token directly as the webhook secret.

**Fix**: Generate a separate random hex string as the webhook secret, store it in SSM Parameter Store.

**Time Lost**: ~45 minutes

---

### Debugging Story #3: Secrets in Lambda

**Symptom**: Lambda functions couldn't read SSM SecureString parameters.

**Root Cause**: CloudFormation's `{{resolve:ssm-secure:...}}` syntax is **not supported** in Lambda environment variables. This is a well-known AWS limitation but not obvious from the docs.

**Fix**: Pass SSM parameter _paths_ as env vars, resolve at runtime:

```typescript
// Instead of: process.env.BRIDGE_AUTH_TOKEN (resolved by CF)
// Do: process.env.SSM_BRIDGE_AUTH_TOKEN = "/serverless-openclaw/secrets/bridge-auth-token"
// Then resolve at runtime via GetParameters API
```

This led to creating `resolveSecrets()` — a batch resolver with caching.

**Time Lost**: ~1.5 hours

---

### Debugging Story #4: OpenClaw Config Path

**Symptom**: OpenClaw Gateway wouldn't start in the container.

**Root Cause**: Multiple issues layered:

1. Config path was `~/.config/openclaw/` — actually `~/.openclaw/openclaw.json`
2. `auth.method` key in config was invalid — OpenClaw rejected it
3. `gateway.mode: "local"` was required but missing
4. `openclaw gateway` just waits — need `openclaw gateway run` subcommand

**Fix**: Pre-generate the correct config in the Dockerfile and use the right command.

**Time Lost**: ~2 hours (the longest single debugging session)

---

### Debugging Story #5: Fargate Memory OOM

**Symptom**: Container started then immediately stopped. No useful logs.

**Root Cause**: 512MB memory was insufficient for OpenClaw + Node.js + Bridge server. The container was OOM-killed.

**Fix**: Increase to 1024MB (later 2048MB with 1 vCPU).

**Time Lost**: ~30 minutes

---

### Debugging Story #6: WebSocket Auth

**Symptom**: WebSocket connections failed with 401.

**Root Cause**: API Gateway WebSocket does **not** support JWT authorizers (unlike HTTP API). The `$connect` route needs a Lambda authorizer or query parameter auth.

**Fix**: Pass JWT as `?token=` query parameter, verify in the `ws-connect` Lambda using `aws-jwt-verify`.

**Time Lost**: ~45 minutes

## The Result

After a full day of debugging, the system was running on AWS:

```
✅ Gateway WebSocket handshake — working
✅ chat.send — working
✅ AI response streaming — working
✅ Telegram response routing — working
✅ Web UI authentication — working
```

The deployment uncovered **6 significant issues** that no amount of local testing could have caught. Each one was a lesson about the gap between CDK synthesis and real AWS behavior.

## Lessons Learned

1. **CDK synth is necessary but not sufficient.** Synthesis validates CloudFormation templates, but not runtime behavior. The secrets resolution, memory limits, and auth mechanisms all passed synth but failed in production.

2. **AWS has undocumented limitations everywhere.** `{{resolve:ssm-secure:...}}` not working in Lambda env vars, WebSocket not supporting JWT authorizers, Telegram rejecting `:` in secrets — none of these are obvious from primary documentation.

3. **Fargate debugging is blind.** When a container OOM-kills, you get almost no information. Always start with generous memory and dial down, not the other way around.

4. **OpenClaw is a moving target.** The config format, CLI commands, and gateway behavior all had undocumented quirks. Reading the source code was often the only way forward.

5. **Each fix generates a test.** Every debugging session produced a new unit test that prevented regression. The test count grew from 49 to 80+ during deployment.

## Try It Yourself

```bash
# Set up AWS credentials
cp .env.example .env
# Edit .env with your AWS_PROFILE and AWS_REGION

# Build everything first (web dist/ required for CDK synth)
npm run build
cd packages/web && npm run build && cd ../..

# Create SSM SecureString parameters
# (See docs/deployment.md for the full list)

# Deploy all stacks
cd packages/cdk && npx cdk deploy --all

# Verify
make task-status
```

### Running Cost

| Phase        | Action                 | Cost   | Cumulative |
| ------------ | ---------------------- | ------ | ---------- |
| Design       | Documentation only     | $0.00  | $0.00      |
| MVP Build    | Local development only | $0.00  | $0.00      |
| First Deploy | CDK deploy + debugging | ~$0.10 | ~$0.10     |
