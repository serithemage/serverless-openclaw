---
name: solo-maintainer
description: Operates this repository as a solo maintainer across PR triage, issue handling, release work, deploys, ops checks, cost checks, security review, and docs drift. Use when the user wants you to just handle maintenance work end-to-end.
argument-hint: "[scope, e.g. inbox|guard|release|sweep]"
---

# Solo Maintainer Control Surface

## First Step

Read the shared policy before acting:

- [solo-maintainer-policy.md](../_shared/references/solo-maintainer-policy.md)

## Scope Router

- `inbox`: read [../solo-maintainer-inbox/SKILL.md](../solo-maintainer-inbox/SKILL.md)
- `release`: read [../solo-maintainer-release/SKILL.md](../solo-maintainer-release/SKILL.md)
- `guard`: read [../solo-maintainer-guard/SKILL.md](../solo-maintainer-guard/SKILL.md)
- broad or unspecified request:
  1. clear the inbox
  2. run a guard sweep
  3. ship only when the request explicitly asks for a release, deploy, or merge batch

## Default Behavior

- Execute normal maintainer actions automatically.
- Stop only for suspicious changes defined in the shared policy.
- Prefer `gh`, `git`, repo scripts, and local verification commands over browser-only workflows.
- Keep notes short and evidence-based so the maintainer can resume quickly if a stop condition is hit.
