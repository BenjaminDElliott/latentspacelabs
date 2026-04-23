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

- [ ] PR link (or explicit reason no PR was opened).
- [ ] Files changed.
- [ ] Tests added/run and their results.
- [ ] Known risks and unresolved questions.
- [ ] QA and/or review notes.

## Quality Gate Checklist (must all pass before marking agent-ready)

- [ ] Scope is bounded and specific.
- [ ] Acceptance criteria are testable.
- [ ] Dependencies are identified.
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
