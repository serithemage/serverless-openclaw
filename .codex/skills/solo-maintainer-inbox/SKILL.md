---
name: solo-maintainer-inbox
description: Triage issues and pull requests for a solo maintainer. Detect suspicious changes, validate safe PRs, label and comment when needed, and merge or close normal work automatically.
argument-hint: "[optional focus, e.g. prs|issues|all]"
---

# Solo Maintainer Inbox

## Required Context

Read the shared policy first:

- [solo-maintainer-policy.md](../_shared/references/solo-maintainer-policy.md)

## PR Workflow

1. Snapshot the queue with `gh pr list --state open`.
2. For each PR, gather metadata with `gh pr view --json` and inspect changed files with `gh pr diff --name-only`.
3. Detect stacked PRs before merging. Merge ancestors first or mark superseded PRs clearly.
4. Apply the suspicious-change policy. If triggered, stop merge/release actions for that PR.
5. For safe PRs, run path-appropriate verification:
   - docs-only: formatting or docs checks relevant to the changed files
   - runtime, infra, or workflow changes: `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e`
6. Merge safe, green, mergeable PRs with a linear-history-friendly method such as `gh pr merge --squash --delete-branch`.

## Issue Workflow

1. Snapshot the issue queue with `gh issue list --state open`.
2. Label and classify issues quickly: bug, docs, security, cost, ops, release blocker, or duplicate.
3. Request missing reproduction data only when the repository cannot infer it from context.
4. Close duplicates, obsolete reports, or already-fixed issues when evidence is clear.

## Output Discipline

- Leave short evidence for each merge, close, or stop decision.
- When stopping for suspicious work, preserve changed files, failed checks, and the exact trigger from the shared policy.
