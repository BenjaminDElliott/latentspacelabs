---
name: lat-fix-review
description: Apply review-comment fixes to an existing ticket-pack PR, without expanding scope. Refuses out-of-scope comments instead of silently widening the allowlist.
agent: ticket-implementer
arguments:
  - name: pack
    description: Path to the original ticket-pack markdown that the PR implements.
    required: true
  - name: pr
    description: PR number to apply review fixes to (must be on the implementer's branch from the original pack).
    required: true
---

# /lat-fix-review

Address reviewer comments on a PR opened by an earlier `/lat-implement` run, **without** widening scope.

## Usage

```
/lat-fix-review <path-to-ticket-pack.md> <pr-number>
```

## What this command does

1. Hands the pack and the PR to the `ticket-implementer` agent in fix-review mode.
2. The agent loads `docs/templates/local-agent-prompt.md` (canonical system prompt), then runs `agent-ready-ticket` (re-validate the pack), `repo-guardrails`, `local-agent-commands`, and `pr-review-fix`.
3. For each unresolved review comment:
   - **In-scope** (touches an allowlisted file, no new criterion, no new dep): apply smallest fix, re-run `npm run check`, push to the same branch, reply with the commit SHA.
   - **Out-of-scope**: refuse with a one-line PR reply pointing the reviewer at a follow-up ticket. Do not silently widen the allowlist.
4. Final report lists addressed comments, refused comments, re-run check results, and a status of `ready` or `blocked`.

## What this command does not do

- Does not change the PR title, base, or merge settings.
- Does not enable auto-merge.
- Does not force-push to shared branches; force-push to the ticket branch only when no reviewer has based work on the previous SHA.
- Does not open a second PR. One ticket pack, one PR.
- Does not query Linear or broader GitHub for "more context" on the review.

If the reviewer's request genuinely requires expanded scope, the planner re-packs as a follow-up ticket — that is not this command's surface.
