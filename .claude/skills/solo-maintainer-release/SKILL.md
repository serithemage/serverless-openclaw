---
name: solo-maintainer-release
description: Runs solo-maintainer release work end-to-end: release readiness review, notes, tags, GitHub release creation, deploy workflow dispatch, and post-release verification. Auto-executes unless the shared suspicious-change policy is triggered.
argument-hint: "[target version or release scope]"
---

# Solo Maintainer Release

## Required Context

Read these first:

- [solo-maintainer-policy.md](../_shared/references/solo-maintainer-policy.md)
- [../release/SKILL.md](../release/SKILL.md)
- [../deploy/SKILL.md](../deploy/SKILL.md)

## Release Flow

1. Verify the release candidate is not blocked by suspicious pending changes.
2. Run the local release gate:
   - `npm run check`
   - `npm run build`
   - `npm run web:build`
   - `npm run test`
   - `npm run test:e2e`
3. Run integration tests when the required live environment variables exist.
4. Update or confirm release notes and changelog entries before tagging.
5. Create the tag and GitHub release only after the evidence is collected.
6. If the request includes deployment, dispatch the relevant workflow with `gh workflow run`, monitor it, and handle environment approval when expected and safe.
7. After deployment, verify the run result and note any follow-up cleanup.

## Parallelism Rule

- If the platform supports subagents or workers, parallelize independent review lanes.
- If not, run the same lanes sequentially and keep a compact approval or reject note for each lane.

## Stop Conditions

- Any suspicious-change signal from the shared policy
- failed verification that changes release safety
- unexplained drift between release notes and shipped behavior
