---
name: agent-ready-ticket
description: Validate that the input is a well-formed opencode ticket pack before any work begins. Use at the start of every implementation, QA, or planner run.
---

# agent-ready-ticket

The implementation runtime never starts work from a Linear URL or a free-form prompt. It starts from a **ticket pack** produced upstream by the planner. The contract is `docs/templates/opencode-ticket-pack.md`.

## When to use

- First step of `lat-implement`, `lat-qa`, and any planner refusal flow.
- Before reading the repo, before creating a branch, before any tool call beyond reading the pack.

## What to check

Read the ticket pack and confirm, in order:

1. **Header present.** `Linear ID` matches `^LAT-\d+$`. `Pack version`, `Cost band`, `Risk level`, `Readiness status` are populated (not blank, not `TBD`).
2. **`Readiness status`** is one of `ready | blocked | needs_clarification | too_large`. Only `ready` proceeds; the others halt with that status echoed back.
3. **`Goal`** is one sentence describing one observable outcome.
4. **`Acceptance criteria`** has at least one checkbox bullet.
5. **`Constraints → Files in scope (allowlist)`** is non-empty and disjoint from `Files / paths forbidden`.
6. **`Branch / PR rules`** declares a branch matching `lat-<digits>-<slug>` and a PR title prefixed with the Linear ID.
7. **`Expected checks`** lists `npm run check` (the repo gate).
8. **No secret-shaped values** are embedded in the pack itself (endpoint URLs, tokens, internal hostnames).

## How to refuse

If any check fails, do not proceed. Report exactly one of:

- `needs_clarification` — pack ambiguous, contradictory, or missing a required field. Name the missing item.
- `too_large` — file count, change span, or cognitive load exceeds the small-model surface.
- `blocked` — environment / repo precondition prevents starting (e.g. forbidden path collision).

Never invent missing fields, never widen the allowlist, never query Linear or GitHub for "more context."
