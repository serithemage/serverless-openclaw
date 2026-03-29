---
name: release
description: Runs a comprehensive release review before tagging and publishing a new version. Reviews code, docs, tests, security, cost, and operations; use platform-native parallelism when available and a sequential fallback otherwise.
argument-hint: "[version, e.g. v0.3.0]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Release Review & Publish

Target version: **$ARGUMENTS**

## Procedure

Run the six release lanes below, aggregate the evidence, and block release if any lane rejects.

## Step 1: Pre-flight Checks

Before lane review, verify basics:

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
```

All must pass before proceeding.

## Step 2: Review Lanes

If the platform supports subagents or workers, run independent lanes in parallel. Otherwise, run them sequentially.

Each lane must return APPROVE or REJECT with evidence.

### Lane 1: Code Review

Scope: `git diff v{previous-tag}...HEAD`

Checklist:

- no debug leftovers, TODOs, or silent catches
- types are sound and `any` is justified
- no backward-incompatible changes without documentation
- no secrets, credentials, or unsafe import/runtime patterns

### Lane 2: Documentation Review

Scope: `docs/`, `README.md`, `CLAUDE.md`, `RELEASE_NOTES.md`

Checklist:

- docs remain English-only
- architecture and test counts match current behavior
- release notes contain the target version
- broken links or stale commands are corrected

### Lane 3: Test Coverage Review

Scope: all changed tests and their neighboring source files

Checklist:

- new behavior has regression coverage
- no skipped tests or obviously flaky patterns
- edge cases and failure paths are covered

### Lane 4: Security Review

Scope: source, CDK, workflows, Dockerfiles

Checklist:

- no secrets in code or images
- IAM remains least-privilege
- Bridge auth, IDOR prevention, and SSM secret resolution stay intact
- no suspicious changes to release or security boundaries

### Lane 5: Cost Review

Scope: infrastructure and runtime configuration

Checklist:

- no NAT Gateway, ALB, or Interface Endpoint regressions
- PAY_PER_REQUEST remains in place
- log retention and idle-cost controls stay sane
- Lambda-only mode does not accidentally reintroduce fixed Fargate cost

### Lane 6: Operations Review

Scope: deployability, rollback, monitoring, and runbooks

Checklist:

- deployment and rollback paths are documented
- dashboards, watchdogs, and health probes still make sense
- make targets and operational commands still match the repo

## Step 3: Aggregate Results

Collect a compact table of lane verdicts and findings. Release only if all lanes approve and no critical or high-severity issue remains.

## Step 4: Publish

Only after approval:

```bash
git add -A
git commit -m "chore: prepare release $ARGUMENTS"
git push origin main
gh release create "$ARGUMENTS" --title "$ARGUMENTS" --notes-file RELEASE_NOTES.md --target main
```

## References

- [Deployment Guide](../../../docs/deployment.md)
- [Cost Optimization](../../../docs/cost-optimization.md)
- [Architecture](../../../docs/architecture.md)
- [Security Model](../../../docs/architecture.md#7-security-model)
- [Progress](../../../docs/progress.md)
- [Release Notes](../../../RELEASE_NOTES.md)
