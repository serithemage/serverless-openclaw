# AGENTS.md

This repository supports both Claude Code and Codex.

Agent-facing rules, skills, and workflow instructions must stay shareable across both tools.

## Shared Agent Structure

- Canonical skill source lives in `.agents/skills/`
- Generated mirrors live in `.claude/skills/` and `.codex/skills/`
- Edit the canonical source first, then run `npm run skills:sync`
- `npm run skills:check` is the drift gate for the mirrored skill trees
- Keep `AGENTS.md` and `CLAUDE.md` aligned when agent-facing rules change
- Prefer agent-neutral commands, paths, and workflows
- If a workflow benefits from subagents, describe that as optional and provide a sequential fallback
- Do not let critical process rules exist only in an agent-specific directory

## Core Commands

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
npm run test:integration
npm run skills:sync
npm run skills:check
```

## Project Constraints

- Documentation and maintainer-facing notes must be in English
- No NAT Gateway, ALB, or Interface Endpoints
- No secrets written to disk
- Build `packages/web/dist/` before `cdk synth`
- Keep Bridge authentication and IDOR protections intact
- Prefer reversible, reviewable changes and verify before reporting completion
