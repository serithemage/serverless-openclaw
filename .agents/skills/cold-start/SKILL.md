---
name: cold-start
description: References cold start optimization history and techniques. Covers Docker image optimization, Fargate CPU tuning, SOCI lazy loading, and Lambda Bedrock discovery fix. Use when optimizing startup performance.
allowed-tools: Read, Glob, Grep
---

# Cold Start Optimization Reference

Full analysis: [docs/cold-start-optimization.md](../../../docs/cold-start-optimization.md)

## Results Summary

| Target             | Before            | After            | Savings       |
| ------------------ | ----------------- | ---------------- | ------------- |
| Docker image size  | 2.22 GB           | 1.27 GB          | 43% reduction |
| Fargate cold start | ~120s (0.25 vCPU) | ~40-57s (1 vCPU) | ~80s          |
| Lambda cold start  | 56s               | 1.35s            | ~54s          |

## Measurement Commands

```bash
make cold-start        # Full measurement (stops tasks + cleans TaskState first)
make cold-start-warm   # Warm start measurement (skip idle wait)
make task-status       # Verify task state before measuring
make task-stop         # Stop all tasks
make task-stop-recent  # Stop only most recent task
```

**Important**: Always use `make cold-start` — never run the measurement script directly without stopping existing tasks first.

## Docker Image Optimizations (Fargate)

| Optimization                     | Savings           | Technique                                                                    |
| -------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| Remove AWS CLI                   | -358 MB           | Replaced `aws s3 sync` with `@aws-sdk/client-s3` Node.js code (`s3-sync.ts`) |
| chown layer optimization         | -134 MB           | `COPY --chown=openclaw:openclaw` instead of separate RUN chown               |
| Pre-generated openclaw config    | —                 | Handled in Dockerfile (skip runtime onboard)                                 |
| start-openclaw.sh simplification | —                 | Removed S3 restore/onboard/sleep 2                                           |
| zstd compression (P6)            | -16% (258→217 MB) | `--compression zstd` in docker buildx                                        |

### SOCI Lazy Loading

```bash
./scripts/deploy-image.sh --soci   # Linux only, ~50% additional pull-time reduction
```

SOCI CI: `.github/workflows/deploy-image.yml`

## Fargate CPU Tuning (P7)

| CPU       | Memory  | Cold Start           |
| --------- | ------- | -------------------- |
| 0.25 vCPU | 512 MB  | OOM Kill             |
| 0.25 vCPU | 2048 MB | ~120s                |
| 0.5 vCPU  | 2048 MB | ~80s                 |
| 1 vCPU    | 2048 MB | ~40-57s (default)    |
| 2 vCPU    | 4096 MB | Configurable via env |

Configure via env vars: `FARGATE_CPU`, `FARGATE_MEMORY`

## Container Startup Parallelization

- S3 restore + History load run via `Promise.all` (~3-5s saved)
- IP discovery runs non-blocking (Bridge starts serving while discovery continues)
- Stale IP fix: Bridge HTTP timeout 10s→3s, fallback to PendingMessages on failure

## Lambda Cold Start (Phase 2 — The Biggest Win)

**Root cause**: Bedrock auto-discovery scanned all AWS regions on startup → 56s delay

**Fix**: `bedrockDiscovery.enabled: false` in OpenClaw config → 1.35s cold start

```json
{
  "bedrockDiscovery": { "enabled": false }
}
```

### Lambda Optimization Techniques

- `runEmbeddedPiAgent()` — bypasses Gateway WS server (no :18789 socket bind)
- `extensionAPI.js` via `file://` URL (not in exports map)
- HOME=/tmp (Lambda read-only filesystem)
- Sessions in /tmp (ephemeral, acceptable for Lambda)
- No S3 session restore (Lambda starts fresh each cold start)

## OpenClaw Version Impact on Cold Start

| Version    | Cold Start | Status                |
| ---------- | ---------- | --------------------- |
| v2026.2.9  | 65.3s      | Working               |
| v2026.2.13 | 57.9s      | Working — **pinned**  |
| v2026.2.14 | N/A        | BROKEN (scope system) |

Pin location: `packages/container/Dockerfile`

```
ARG OPENCLAW_VERSION=2026.2.13
```

Configurable via build-arg or env var.

## Watchdog Dynamic Timeout

- Active hours: 30-min idle timeout
- Inactive hours: 10-min idle timeout
- Based on CloudWatch activity metrics
- Watchdog skips pre-warmed tasks where `now < prewarmUntil`
