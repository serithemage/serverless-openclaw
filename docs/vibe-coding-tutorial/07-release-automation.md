# Chapter 7: Release Automation with Skills

> **Time**: ~2 hours (Mar 14–15)
> **Cost**: $0.00
> **Key Insight**: Claude Code skills turn repeatable workflows into one-command operations. A `/release` skill with 6 parallel review lanes catches issues humans would miss.

## Context

By this point, the project had gone through multiple releases (v0.1.0 → v0.3.1). Each release required code review, documentation review, test review, security review, cost optimization review, and operational readiness review. Doing this manually each time was tedious and error-prone.

## The Prompt

```
문서들이 상시 활용될 수 있도록 공식 가이드에 따라 각종 작업용 스킬을 만들고
공식 가이드대로 문서들을 재 구성해줘.
```

_(Create various task skills following the official guide so documents can be used continuously. Reorganize documents per the official guide.)_

```
릴리즈를 위한 스킬도 만들어줘.
릴리즈를 요청하면 코드리뷰, 문서리뷰, 테스트 리뷰, 보안리뷰, 비용 최적화 리뷰,
운영성 리뷰(대시보드, 런북)가 병렬로 수행되도록 해줘.
```

_(Create a release skill too. When a release is requested, run code review, doc review, test review, security review, cost optimization review, and operational review in parallel.)_

## What Happened

### Step 1: Skill Ecosystem

Claude Code skills are markdown files in `.claude/skills/` that provide context and instructions for specific tasks. The project got a full skill ecosystem:

| Skill                   | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `/implement 1-N`        | Phase 1 step implementation guide              |
| `/lambda-migration 2-N` | Phase 2 migration guide                        |
| `/context`              | Project background and tech stack              |
| `/architecture`         | Network, CDK, DynamoDB design                  |
| `/security`             | 6-layer defense model checklist                |
| `/cost`                 | Cost optimization guidelines                   |
| `/deploy`               | Deployment procedures                          |
| `/dev`                  | Development workflow (TDD, hooks, conventions) |
| `/troubleshoot`         | Common issues and fixes                        |
| `/openclaw`             | OpenClaw internals reference                   |
| `/cold-start`           | Cold start optimization history                |
| `/status`               | Project progress and coverage                  |
| `/release`              | **6-lane parallel release review**             |

### Step 2: The /release Skill

The release skill orchestrates 6 independent review agents in parallel:

```
/release v0.2.1
```

This triggers:

1. **Code Review** — Check for bugs, security issues, code quality
2. **Documentation Review** — Verify docs match current implementation
3. **Test Review** — Assess test coverage and quality
4. **Security Review** — OWASP Top 10, secrets handling, auth flows
5. **Cost Review** — Verify no resources exceed $1/month target
6. **Operational Review** — Dashboard completeness, monitoring, runbooks

All 6 run in parallel. Results are aggregated into a summary with PASS/FAIL verdicts and specific action items.

### Step 3: Document Reorganization

Skills reference documents, so the docs needed to be well-organized:

```
docs/
├── architecture.md          # Referenced by /architecture skill
├── deployment.md            # Referenced by /deploy skill
├── development.md           # Referenced by /dev skill
├── cold-start-optimization.md
├── cost-optimization.md
├── implementation-plan.md
├── lambda-migration-plan.md
├── lambda-migration-journey.md
├── smart-routing-design.md
├── PRD.md
└── progress.md
```

### Step 4: Broken Link Audit

```
구조가 많이 바뀌어서 깨진 링크들이 있을것 같아.
리드미를 포함 문서들의 링크를 확인해줘.
```

_(The structure changed a lot, so there might be broken links. Check all document links including README.)_

Claude Code found and fixed 22 documentation issues across all files, ranging from CRITICAL (incorrect architecture diagrams) to LOW (missing cross-references).

### Release Timeline

| Version | Date   | Key Changes                             |
| ------- | ------ | --------------------------------------- |
| v0.1.0  | Feb 16 | Phase 1 MVP complete                    |
| v0.2.0  | Mar 15 | Lambda migration, 97% faster cold start |
| v0.2.1  | Mar 15 | Security hardening                      |
| v0.3.0  | Mar 15 | Smart routing, hybrid execution         |
| v0.3.1  | Mar 15 | Unified session storage                 |

## The Result

The `/release` skill transformed a multi-hour manual process into a single command:

**Before**: Manually check code, docs, tests, security, costs, and monitoring. Easy to miss things. Takes 2+ hours of focused attention.

**After**: One command, 6 parallel agents, comprehensive reports in ~10 minutes. Human reviews the summary and approves.

Example finding from the v0.2.1 security review:

> "Bridge auth token is passed via environment variable but never rotated. Recommend adding rotation guidance to deployment docs."

This was caught by the automated review and fixed before release.

## Lessons Learned

1. **Skills are the killer feature of vibe coding.** They turn one-off prompts into repeatable, documented workflows. Every team member gets the same quality of review.

2. **Parallel review catches more than serial.** Running 6 specialized reviewers simultaneously finds issues that a single pass would miss — security reviewer catches auth gaps, cost reviewer catches expensive resources, etc.

3. **Documents are the skill's memory.** Skills reference docs, which reference code. Keep docs accurate and skills stay useful automatically.

4. **Automate the boring stuff.** Link checking, doc consistency, test coverage analysis — these are tedious for humans but trivial for AI. Automate them.

5. **The SNS question pattern.** After each release, the developer was asked technical questions on social media. Having the AI generate concise explanations from the actual implementation was surprisingly effective:

```
콜드스타트 감소는 lambda 컨테이너가 fargate 보다 기본적으로 빨리 로드되서 그런건가요?
```

_(Is the cold start reduction because Lambda containers load faster than Fargate by default?)_

```
SNS상의 질문에 답변할 수 있게 500자 이내의 서술형으로 정리해줘.
```

_(Summarize in under 500 words so I can answer the SNS question.)_

## Try It Yourself

```bash
# List available skills
ls .claude/skills/

# Use the context skill to understand the project
# In Claude Code: /context

# Use the release skill
# In Claude Code: /release v0.3.1

# Create your own skill
# Create .claude/skills/my-skill/SKILL.md with instructions
```

### Running Cost

| Phase              | Action                 | Cost   | Cumulative |
| ------------------ | ---------------------- | ------ | ---------- |
| Design             | Documentation only     | $0.00  | $0.00      |
| MVP Build          | Local development only | $0.00  | $0.00      |
| First Deploy       | CDK deploy + debugging | ~$0.10 | ~$0.10     |
| Cold Start         | Multiple task launches | ~$0.15 | ~$0.25     |
| Lambda Migration   | Lambda Free Tier       | $0.00  | ~$0.25     |
| Smart Routing      | Within Free Tier       | $0.00  | ~$0.25     |
| Release Automation | No AWS cost            | $0.00  | ~$0.25     |
