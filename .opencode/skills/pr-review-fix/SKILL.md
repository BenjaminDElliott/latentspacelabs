---
name: pr-review-fix
description: Apply review-comment fixes to an existing ticket-pack PR without expanding scope. Use when reviewers leave comments that map cleanly onto the original allowlist.
---

# pr-review-fix

A reviewer left comments on the PR opened from a ticket pack. This skill addresses **only** comments that fit inside the original pack's allowlist and acceptance criteria.

## Preconditions

- The original ticket pack is in hand.
- The PR exists and is on the implementer's branch.
- `repo-guardrails` is loaded.

## Decision: in-scope or out-of-scope?

For each review comment, classify:

- **In-scope** — the change touches a file already in `Constraints → Files in scope` and does not add a new acceptance criterion. Fix it.
- **Out-of-scope** — the change requires editing a file outside the allowlist, adds a new criterion, introduces a dependency the pack forbids, or asks for a refactor the pack did not request. **Refuse** and reply on the PR with one line: "Out of scope for this ticket pack; please file a follow-up ticket."

Do not silently widen the allowlist to "just include one more file." That is exactly the scope creep the ticket-pack contract exists to prevent.

## Steps for in-scope fixes

1. Pull the latest commits on the ticket branch.
2. Apply the smallest change that addresses the comment, on the allowlisted files only.
3. Re-run `npm run check` and any ticket-specific tests named in the pack.
4. Push to the same ticket branch (force-push only if review has not begun on the new commits and no other reviewer has based work on them).
5. Reply on each addressed comment with a one-line note pointing to the commit SHA.
6. Do not change the PR title, base, or merge settings. Do not enable auto-merge.

## What to refuse

- Comments asking for refactors that exceed the pack's scope → reply out-of-scope, do not implement.
- Comments asking for additional tests not named in the pack, when the pack already justified the test surface → reply out-of-scope; the planner can re-pack if needed.
- Comments asking for endpoint URLs, model details, or other configuration to be added to the repo → refuse; secrets / endpoints are out-of-repo (ADR-0017).

## Final report

- Comments addressed (list, with commit SHAs).
- Comments refused as out-of-scope (list, with the one-line reply).
- Re-run check results.
- Status: `ready` if every in-scope comment was addressed and checks pass; otherwise `blocked` with reason.
