---
name: troubleshoot
description: Troubleshoots common issues. Covers CDK deploy failures, Docker build errors, Lambda agent issues, test failures, and OpenClaw compatibility. Use when encountering errors during development or deployment.
argument-hint: "[error description]"
allowed-tools: Read, Bash, Glob, Grep
---

# Troubleshooting

Problem to investigate: **$ARGUMENTS**

Full references:

- [docs/deployment.md §10](../../../docs/deployment.md) — Deployment troubleshooting
- [docs/lambda-migration-journey.md](../../../docs/lambda-migration-journey.md) — Deployment Obstacles section

## Common Issues & Solutions

### CDK / Synth

| Problem                                | Cause                              | Solution                                                                                                      |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Cannot find asset` during `cdk synth` | `packages/web/dist/` missing       | Run `cd packages/web && npx vite build` first                                                                 |
| `CDK Bootstrap version mismatch`       | Outdated bootstrap                 | Run `cdk bootstrap`                                                                                           |
| `ROLLBACK_FAILED` on SecretsStack      | AwsCustomResource partial failure  | `aws cloudformation delete-stack --stack-name SecretsStack --deletion-mode FORCE_DELETE_STACK`, then redeploy |
| `ECR repository already exists`        | CDK trying to create existing repo | Use `--force` delete or `Repository.fromRepositoryName()`                                                     |
| Cross-stack export removal error       | Stack import in use                | Use `--exclusively` flag + SSM decoupling pattern                                                             |

### Docker Build

| Problem                                 | Cause                            | Solution                                                               |
| --------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| TS error with `openclaw` dynamic import | Static analysis of dynamic path  | Use variable path: `const mod = await import(/* @vite-ignore */ path)` |
| `OCI manifest` push error               | Default buildx provenance        | Add `--provenance=false` flag to `docker buildx build`                 |
| `npm ci` fails (husky postinstall)      | prepare script runs in container | `npm pkg delete scripts.prepare && npm ci`                             |

### Lambda Agent

| Problem                          | Cause                                               | Solution                                                               |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `Cannot find package`            | Package installed globally, not in LAMBDA_TASK_ROOT | Install in `$LAMBDA_TASK_ROOT`, not `/usr/local`                       |
| `exports map` resolution failure | Node ESM named exports                              | Use `file://` URL import: `import(\`file://${path}\`)`                 |
| Bedrock discovery timeout (56s)  | Auto-discovery scans all regions                    | Set `bedrockDiscovery.enabled: false` in OpenClaw config               |
| `extensionAPI not found`         | Not in exports map                                  | Use `file://` URL: `import(\`file://${ocRoot}/dist/extensionAPI.js\`)` |

### OpenClaw Compatibility

| Problem                           | Cause                                              | Solution                                     |
| --------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| v2026.2.14 breaks: scope error    | Default-deny scope system, device pairing required | Pin to v2026.2.13 (fastest compatible)       |
| `operator.write` stripped         | Missing device pairing in v2026.2.14+              | Use v2026.2.13 or implement device pairing   |
| `device` field validation fails   | Empty publicKey/signature strings                  | Omit `device` field entirely (it's Optional) |
| `client.mode: "operator"` invalid | Not a valid Literal type                           | Use `"backend"` or `"node"`                  |

### Tests

| Problem                         | Cause                                          | Solution                                             |
| ------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `vi.mock` variable not in scope | Hoisting moves mock above variable declaration | Use `vi.hoisted()` for variables referenced in mocks |
| E2E tests run with unit tests   | Default vitest include matches all `.test.ts`  | Exclude `**/*.e2e.test.ts` in `vitest.config.ts`     |
| `workspace:*` not resolved      | pnpm syntax used in npm workspace              | Use `"*"` for workspace dependencies                 |

### AWS / IAM

| Problem                                            | Cause                             | Solution                                                            |
| -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `launchType` + `capacityProviderStrategy` conflict | Cannot specify both in RunTask    | Remove `launchType`, use `capacityProviderStrategy` only            |
| Lambda env var `{{resolve:ssm-secure:...}}` fails  | Not supported for Lambda env vars | Pass SSM path as env var, resolve at runtime via `resolveSecrets()` |
| ECS Task new secret inaccessible                   | Execution role not updated        | Add `ssm:GetParameters` to execution role policy                    |
| Empty env vars from `.env`                         | `export $(cat .env                | xargs)` silently sets empty                                         | Verify with `${#VAR}` length check |
