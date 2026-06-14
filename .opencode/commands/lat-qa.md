---
name: lat-qa
description: Run a read-only QA pass over a ticket-pack run. Inputs are a ticket-pack path and a PR number or branch. Produces a QA report.
agent: ticket-qa
arguments:
  - name: pack
    description: Path to the same ticket-pack markdown that drove the implementation run.
    required: true
  - name: target
    description: PR number (e.g. 51) or local branch (e.g. lat-200-healthz-endpoint) to verify against.
    required: true
---

# /lat-qa

Verify a completed (or in-progress) ticket-pack run against its pack.

## Usage

```
/lat-qa <path-to-ticket-pack.md> <pr-number-or-branch>
```

## What this command does

1. Hands the pack and the target to the `ticket-qa` agent.
2. The agent loads `docs/templates/local-agent-prompt.md` (canonical system prompt for context on implementation expectations), then runs `agent-ready-ticket` (sanity), `repo-guardrails` (rules to audit against), `local-agent-commands`, and `qa-evidence` (verification + report shape).
3. Re-runs `npm run check` and any ticket-specific tests named in the pack.
4. Audits diff scope, secret hygiene, and PR shape.
5. Emits a QA report shaped per `docs/templates/qa-report.md` with summary `pass | fail | inconclusive`.

## What this command does not do

- Does not edit code. QA is read-only.
- Does not approve or request-changes on the PR. That is the human / reviewer surface (ADR-0007).
- Does not write back to Linear.
- Does not query broad Linear history. The pack is the contract being verified.

If the run failed, the report is the deliverable. The planner decides whether to re-pack.
