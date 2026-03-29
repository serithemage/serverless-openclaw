# Gatekeeping Architecture

This repository applies a five-layer gatekeeping model adapted from OpenClaw's quality controls.

## Layer 1. Local Pre-Commit Gate

- `.husky/pre-commit` runs `scripts/pre-commit-gate.mjs`
- staged TypeScript and JavaScript files are auto-fixed with ESLint
- staged code, docs, workflow, and JSON files are auto-formatted with Prettier
- non-doc commits must pass `npm run check`

## Layer 2. Unified Quality Gate

`npm run check` is the single local and CI gate:

1. `npm run check:no-conflict-markers`
2. `npm run check:arch-boundaries`
3. `npm run format:check`
4. `npm run typecheck`
5. `npm run lint`

Additional security scanning is available through `npm run check:secrets`.

### Architecture boundaries enforced

- workspace packages may not import another package through `packages/*/...` file paths
- internal workspace imports may only use package roots like `@serverless-openclaw/shared`
- `@serverless-openclaw/shared` cannot depend on runtime packages
- relative imports may not escape a package root

## Layer 3. CI Gate

`.github/workflows/ci.yml` adds:

- `preflight` scope detection
- `security` for secret scanning
- `check` for the unified quality gate
- `unit-tests`, optional `integration-tests` when live test env vars exist, and `e2e-tests`
- `web-build` only when the web surface changes

The preflight job skips heavy work for docs-only changes and keeps web and E2E jobs path-aware.

## Layer 4. PR Lifecycle Gate

GitHub PR automation now includes:

- `.github/labeler.yml` + `.github/workflows/labeler.yml` for path-based area labels
- `.github/workflows/pull-request-hygiene.yml` for size labels, evidence-template checks, and noisy-PR hints
- `.github/workflows/stale.yml` for inactive issue and PR cleanup
- `.github/pull_request_template.md` for scope boundaries, security impact, evidence, and human verification

## Layer 5. Release Gate

`.github/workflows/deploy-image.yml` now requires:

- manual dispatch
- `main` branch execution
- release preflight via `npm run release:check`
- `image-release` environment approval before the image push job
- CODEOWNERS protection for release and security-sensitive surfaces

## Required GitHub Settings

Two protections still require repo settings outside the codebase:

1. enable branch protection on `main` and require the `CI` workflow plus code owner review
2. configure required reviewers for the `image-release` environment
