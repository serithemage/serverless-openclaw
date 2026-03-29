---
name: implement
description: Guides Phase 1 MVP implementation steps. Pass a specific step number as an argument to get the goals, deliverables, validation criteria, and detailed design for that step.
argument-hint: "[step-number, e.g. 1-3]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Phase 1 MVP Implementation Guide

Step to implement: **$ARGUMENTS**

## Implementation Procedure

1. Check the goals, deliverables, and validation criteria for the step in the references below
2. Verify that dependent steps are completed
3. Create/modify files specified in the deliverables
4. Verify results according to validation criteria
5. Update the step status in `docs/progress.md`

## References

- Implementation steps, container/Bridge, Lambda design: [implementation-plan.md](../../../docs/implementation-plan.md)

## Required Checks During Implementation

- Verify no NAT Gateway is created
- Verify no secrets are written to disk (no API keys/tokens in `openclaw.json`)
- Use `capacityProviderStrategy` instead of `launchType` in RunTask
- Apply Bearer token authentication to Bridge endpoints (except `/health`)
- Determine userId server-side (IDOR prevention)
- Telegram webhook-only (delete `config.channels?.telegram` from config)

## Post-Validation Tasks

After implementation is complete:

1. Change the step status to "Complete" in `docs/progress.md`
2. Check if any related documents need to be updated
