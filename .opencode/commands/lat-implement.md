---
name: lat-implement
description: Implement one ticket pack end-to-end. Input is a path to a ticket-pack file (per docs/templates/opencode-ticket-pack.md), not a Linear URL.
agent: ticket-implementer
arguments:
  - name: pack
    description: Path to a ticket-pack markdown file in this repo (e.g. /tmp/lat-200-pack.md). Required.
    required: true
---

# /lat-implement

Run the bounded implementation flow on one ticket pack.

## Usage

```
/lat-implement <path-to-ticket-pack.md>
```

The ticket pack must conform to `docs/templates/opencode-ticket-pack.md`. The command does **not** accept a Linear URL or issue ID — packing is upstream (planner / LAT-105 dispatcher), not this command's job.

## What this command does

1. Hands the pack at `${pack}` to the `ticket-implementer` agent.
2. The agent runs `agent-ready-ticket` → `repo-guardrails` → `implement-ticket`.
3. On success: one branch, one PR against `main`, one status report.
4. On refusal: a status of `blocked | needs_clarification | too_large` with a short reason. No PR is opened.

## What this command does not do

- Does not query Linear for ticket context. The pack is the only input.
- Does not query broad GitHub history. PR creation on this repo is the only GitHub reach.
- Does not enable auto-merge. Reviewers land the PR per ADR-0019.
- Does not write back to Linear. That happens out of band.
- Does not retry on failed checks beyond what `implement-ticket` allows.

If you need a pack and don't have one, that's an upstream planner request, not a `/lat-implement` invocation.
