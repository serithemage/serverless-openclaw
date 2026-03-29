---
name: solo-maintainer-guard
description: Runs recurring guard sweeps for operations, cost, security, workflow health, and docs drift. Use when the maintainer wants the repository checked and cleaned up without micromanaging each subsystem.
argument-hint: "[optional focus, e.g. security|cost|ops|docs]"
---

# Solo Maintainer Guard

## Required Context

Read the shared policy first:

- [solo-maintainer-policy.md](../_shared/references/solo-maintainer-policy.md)

## Guard Sweep

1. Run repository safety checks:
   - `npm run check:secrets`
   - `npm run build`
   - `npm run lint`
   - `npm run test`
2. Review failed or flaky automation with `gh run list` and inspect the most recent failed jobs when present.
3. Check dependency and supply-chain drift when the request calls for it or when a recent PR added dependencies.
4. If AWS credentials and `.env` are configured, run the relevant operational probes such as `make task-status`, cold-start checks, or deployment verification commands.
5. Look for docs drift after code or infra changes and update docs automatically when the fix is straightforward and safe.
6. Open or update tracking issues only when the problem cannot be fixed in the same pass.

## Stop Conditions

- Anything that matches the suspicious-change policy
- cost or security changes that need explicit product direction
- operational failures that require irreversible cloud-side actions
