# Chapter 4: The Cold Start Battle

> **Time**: ~6 hours (Feb 13–16)
> **Cost**: ~$0.15 (multiple Fargate task launches for testing)
> **Key Insight**: Cold start optimization is an 8-issue saga. Each fix reveals the next bottleneck.

## Context

The system worked, but the first message took **~120 seconds** to get a response. The user sends a message → Lambda starts a Fargate container → container downloads OpenClaw → starts the Gateway → connects → ready. Two minutes of waiting is unacceptable.

## The Prompt

```
이제 콜드 스타트 시간을 단축해 보자.
```

_(Let's reduce the cold start time.)_

This single prompt triggered a multi-day optimization marathon that produced **8 GitHub issues** (#2–#9), each targeting a different bottleneck.

## What Happened

### Issue #2: Fargate CPU — 0.25 → 1 vCPU

**Before**: 0.25 vCPU, 512MB → 120+ seconds
**After**: 1 vCPU, 2048MB → ~60 seconds

The OpenClaw Gateway startup is CPU-intensive (Node.js compilation, plugin loading). Quadrupling CPU cut startup time in half.

```
perf: increase Fargate CPU to 1 vCPU and memory to 2048 MB (#2)
```

---

### Issue #3: SOCI Lazy Loading

**Concept**: AWS SOCI (Seekable OCI) indexes allow Fargate to start containers without downloading the entire image first.

```
ci: add GitHub Actions workflow for SOCI image deployment (#3)
```

Created `scripts/deploy-image.sh --soci` for SOCI index generation. This reduced effective image pull time by ~50% on large images.

---

### Issue #4: Startup Parallelization

**Before**: Sequential startup — S3 restore → history load → IP discovery → Gateway start
**After**: `Promise.all()` — S3 + history in parallel, IP discovery non-blocking

```
perf: parallelize container startup serial tasks (#4)
```

Saved ~3-5 seconds by running independent operations concurrently.

---

### Issue #6: Stale IP Timeout

**Problem**: When a Fargate task was terminating, the old IP was still in TaskState. Lambda would try to send messages to the dead container and hang for 10 seconds.

**Fix**: Reduce Bridge HTTP timeout from 10s to 3s, fallback to PendingMessages on failure, add stale detection to watchdog.

```
fix: stale IP timeout with 3s Bridge timeout and fallback logic (#6)
```

---

### Issue #7: Docker Image zstd Compression

**Before**: 258MB compressed image
**After**: 217MB with zstd compression (-16%)

```
perf: apply zstd compression to container image (#7)
```

Gotcha: Docker Buildx `--compression` is NOT a valid CLI flag. Must use:

```bash
docker buildx build --output type=image,push=true,compression=zstd,compression-level=3,force-compression=true
```

---

### Issue #8: Configurable CPU

Made Fargate CPU/memory configurable via environment variables, so users can trade cost for speed:

```
perf: upgrade Fargate to 2 vCPU / 4096 MB with configurable env vars (#8)
```

---

### Issue #9: OpenClaw Version Pinning

**Discovery**: OpenClaw v2026.2.14 broke with a new "default-deny scope system" that required device pairing. v2026.2.13 was the fastest compatible version.

```
perf: pin OpenClaw v2026.2.13 and revert Fargate defaults to 1 vCPU (#9)
```

| Version    | Status     | Cold Start |
| ---------- | ---------- | ---------- |
| v2026.2.9  | Working    | 65.3s      |
| v2026.2.13 | Working    | 57.9s      |
| v2026.2.14 | **BROKEN** | N/A        |

---

### The Docker Image Diet (Issue #4 Prerequisite)

The single biggest optimization was shrinking the Docker image:

**Before**: 2.22GB
**After**: 1.27GB (43% reduction)

How:

1. **Remove AWS CLI** (-358MB): Replace `aws s3 sync` with `@aws-sdk/client-s3` Node.js code
2. **COPY --chown optimization** (-134MB): Avoid separate `chown` layer that duplicates files
3. **Pre-generate config**: Skip runtime `openclaw onboard` step

```
perf: optimize cold start — Docker image 2.22GB → 1.27GB (43% reduction)
```

---

### P9: Predictive Pre-Warming (Feb 16)

The ultimate cold start solution: eliminate it entirely.

```
feat: add predictive pre-warming to eliminate cold start (P9)
```

**How it works**:

1. EventBridge cron triggers a prewarm Lambda
2. Lambda starts a Fargate task with `USER_ID=system:prewarm`
3. Container starts and waits (warm, ready for any user)
4. First real user message "claims" the container (TaskState ownership transfer)
5. Watchdog skips prewarm tasks (doesn't shut them down prematurely)

**Result**: 0 second cold start during configured active hours.

## The Result

| Optimization                 | Cold Start | Reduction |
| ---------------------------- | ---------- | --------- |
| Baseline (0.25 vCPU)         | ~120s      | —         |
| 1 vCPU + 2048MB              | ~60s       | -50%      |
| Docker image diet            | ~50s       | -17%      |
| Startup parallelization      | ~45s       | -10%      |
| zstd compression             | ~42s       | -7%       |
| Version pinning (v2026.2.13) | ~40s       | -5%       |
| **Predictive pre-warming**   | **~0s**    | **-100%** |

Eight issues, eight fixes, from 120 seconds to zero.

## Lessons Learned

1. **Measure before optimizing.** `make cold-start` was created early and used consistently. Without precise measurements, you can't tell which optimizations actually matter.

2. **The biggest wins are eliminations.** Removing AWS CLI (-358MB) and removing the `chown` layer (-134MB) dwarfed all other image optimizations combined.

3. **Version management is performance management.** A single OpenClaw version bump (v2026.2.13 → v2026.2.14) broke everything. Pin your dependencies.

4. **Pre-warming is the cheat code.** All the optimization above reduced cold start from 120s to 40s. Pre-warming eliminated it entirely. Sometimes the answer is "don't have the problem."

5. **CloudWatch metrics are essential.** Custom metrics (`StartupTotal`, `StartupS3Restore`, `StartupGatewayWait`) made it possible to identify exactly which phase was the bottleneck at each stage.

## Try It Yourself

```bash
# Measure current cold start (stops existing tasks first)
make cold-start

# Measure warm start (skip idle wait)
make cold-start-warm

# Check Fargate task status
make task-status

# View container logs
make task-logs
```

### Running Cost

| Phase        | Action                 | Cost   | Cumulative |
| ------------ | ---------------------- | ------ | ---------- |
| Design       | Documentation only     | $0.00  | $0.00      |
| MVP Build    | Local development only | $0.00  | $0.00      |
| First Deploy | CDK deploy + debugging | ~$0.10 | ~$0.10     |
| Cold Start   | Multiple task launches | ~$0.15 | ~$0.25     |
