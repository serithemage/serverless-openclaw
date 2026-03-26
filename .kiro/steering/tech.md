# Tech Stack & Build System

## Language & Runtime
- TypeScript 5.7, ES2022 target, Node16 module resolution, strict mode
- `.js` extension required in all import paths (Node16 ESM resolution)
- Composite builds with project references across packages

## Monorepo
- npm workspaces (`packages/*`)
- Package scope: `@serverless-openclaw/*`

## Key Frameworks & Libraries
- **IaC**: AWS CDK 2.x (TypeScript)
- **API**: API Gateway (WebSocket + REST)
- **Compute**: Lambda (Node.js), ECS Fargate
- **Frontend**: React 19 + Vite 6
- **Auth**: AWS Cognito (`amazon-cognito-identity-js`, `aws-jwt-verify`)
- **DB**: DynamoDB (AWS SDK v3 `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`)
- **Testing**: Vitest 3
- **Linting**: ESLint 9 (flat config) + typescript-eslint
- **Formatting**: Prettier (double quotes, semicolons, trailing commas, 100 char width)
- **Git hooks**: Husky (pre-commit: build + lint + unit tests, pre-push: E2E tests)

## Common Commands

```bash
# Build & Quality
npm run build          # tsc --build (all packages)
npm run lint           # eslint "packages/**/*.ts"
npm run format         # prettier --write

# Testing
npm run test           # vitest run (unit tests)
npm run test:e2e       # vitest run (CDK synth E2E tests)
npx vitest run packages/gateway/__tests__/handlers/ws-connect.test.ts  # single file
npx vitest run -t "should verify JWT"                                   # single test by name

# CDK
cd packages/cdk && npx cdk synth    # generate CloudFormation
cd packages/cdk && npx cdk deploy   # deploy to AWS

# Makefile (requires .env with AWS_PROFILE, AWS_REGION)
make deploy-all        # CDK deploy all stacks
make deploy-web        # build + upload + CloudFront invalidation
make task-status       # Fargate container status
make task-logs         # tail container logs
make cold-start        # measure cold start time
make help              # show all targets
```

## TypeScript Conventions
- Strict mode enabled across all packages
- Use `as const` for constant objects (see `packages/shared/src/constants.ts`)
- AWS SDK v3 clients instantiated at module level, not inside handlers
- CDK: `externalModules: ["@aws-sdk/*"]` — SDK provided by Lambda runtime, never bundled
- Lambda secrets resolved at runtime via SSM parameter paths, not `{{resolve:ssm-secure:}}`

## Development Rules
- TDD required for all packages except `packages/web`
- Documentation language: English
- Web build (`packages/web/dist/`) must exist before `cdk synth`
