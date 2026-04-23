# Agent-Ready Ticket: {{Short title}}

> An agent-ready ticket is one that has passed the quality gates below and can be dispatched to a coding, QA, review, or research agent without further clarification.

- **Linear ID:** LAT-XX
- **Parent / Epic:** LAT-YY
- **Agent type:** coding | qa | review | research | sre | pm | observability
- **Risk level:** low | medium | high
- **Budget cap:** {{tokens, time, or cost — required}}
- **Approval required before dispatch:** yes | no (pilot default: yes for coding agents)

## Objective

One-sentence description of what this ticket should accomplish.

## Context

What does the agent need to know before starting? Link to the PRD, ADR, prior ticket, or code path. Do not duplicate.

## Inputs

- Files / paths:
- Linear issues:
- External references:

## Sequencing

> Authoritative dependency declaration for agent dispatch (see ADR-0005). Lines are comma-separated `LAT-*` keys or `none`. Keep in sync with Linear's native `blocks` / `blocked by` relation when the UI shows it. Sub-issue (parent/child) relationships and labels are **not** read as dependencies — parent/child is decomposition, labels classify kind or coarse state. If a real dependency exists on a parent, sibling, or label-peer, list it explicitly below.

Hard blockers: none
Recommended predecessors: none
Related context: none
Dispatch status: ready
Dispatch note:

## Scope

### In scope

- ...

### Out of scope

- ...

## Acceptance Criteria

- [ ] Clear, testable statement 1.
- [ ] Clear, testable statement 2.
- [ ] ...

## Required Evidence on Completion

- [ ] PR link (or explicit reason no PR was opened). PR title must prefix this ticket's Linear key, e.g. `LAT-XX: short imperative title`; PR body must reference the Linear issue. See `docs/process/operating-model.md` → *PR ↔ Linear linking convention*.
- [ ] Files changed.
- [ ] Tests added/run and their results.
- [ ] Known risks and unresolved questions.
- [ ] QA and/or review notes.

## Quality Gate Checklist (must all pass before marking agent-ready)

- [ ] Scope is bounded and specific.
- [ ] Acceptance criteria are testable.
- [ ] Dependencies are identified and declared in the `## Sequencing` block per ADR-0005.
- [ ] Risk level is classified.
- [ ] Budget cap is set.
- [ ] Testability is confirmed.
- [ ] Security / architecture concerns are flagged or ruled out.

## Rollback / Reversal Plan

How do we undo this if it goes wrong? For low-risk reversible work, state "revert PR". Otherwise describe.

## Links

- PRD:
- ADR(s):
- Related Linear:
