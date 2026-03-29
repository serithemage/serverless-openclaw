---
name: dev
description: Development workflow guide. Covers build, test, lint, format commands, package structure, Git hooks, TDD methodology, and coding conventions. Use when setting up dev environment, running tests, or following project conventions.
allowed-tools: Read, Bash, Glob, Grep
---

# Development Workflow

Full guide: [docs/development.md](../../../docs/development.md)

## Quick Command Reference

```bash
npm run build          # tsc --build (all packages via project references)
npm run lint           # eslint "packages/**/*.ts"
npm run format         # prettier
npm run test           # vitest run (unit tests, excludes *.e2e.test.ts)
npm run test:e2e       # vitest e2e (CDK synth E2E tests)
npm run skills:sync    # sync shared skills into Claude/Codex mirrors
npm run skills:check   # verify shared skill mirrors are in sync

# Single test file
npx vitest run packages/gateway/__tests__/handlers/ws-connect.test.ts

# Single test by name
npx vitest run -t "should verify JWT"
```

## Package Structure (6 packages)

```
packages/
├── shared/      # Types + constants (TABLE_NAMES, BRIDGE_PORT, key prefixes)
├── cdk/         # CDK stacks (lib/stacks/)
├── gateway/     # 7 Lambda handlers (ws-connect/message/disconnect, telegram-webhook, api-handler, watchdog, prewarm)
├── container/   # Fargate container (Bridge server + OpenClaw JSON-RPC client)
├── lambda-agent/ # Lambda agent (Phase 2 — OpenClaw embedded in Lambda)
└── web/         # React SPA (Vite, amazon-cognito-identity-js for auth)
```

## Git Hooks (husky)

| Hook         | Checks                                        |
| ------------ | --------------------------------------------- |
| `pre-commit` | `npm run build` + `npm run lint` + unit tests |
| `pre-push`   | E2E tests (CDK synth verification)            |

## TDD Rules

- **Tests first** for all packages except `web`
- Write test → watch it fail → implement → watch it pass
- Unit tests: `packages/<pkg>/__tests__/`
- E2E tests: `packages/<pkg>/__tests__/*.e2e.test.ts`

## Import Path Rule

TypeScript uses `NodeNext` module resolution. All imports **must** use `.js` extension:

```typescript
// Correct
import { TABLE_NAMES } from "@serverless-openclaw/shared/constants.js";
import { routeMessage } from "../services/message.js";

// Wrong — omitting .js will fail at runtime
import { TABLE_NAMES } from "@serverless-openclaw/shared/constants";
```

## Coding Conventions

- **DI pattern**: Inject `send` function (same pattern as container package)
- **AWS SDK send binding**: `ddb.send.bind(ddb) as (cmd: any) => Promise<any>` cast needed
- **vi.mock hoisting**: Use `vi.hoisted()` when referencing variables in module-level mocks
- **npm workspaces**: Use `"*"` for local dependencies (`"workspace:*"` is pnpm-only)
- **TypeScript**: ES2022, Node16 module resolution, strict, composite builds
