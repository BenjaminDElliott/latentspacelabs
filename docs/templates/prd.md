# PRD: {{Short product or feature name}}

> Copy this file into a working location (e.g., `docs/prds/NNNN-name.md` when that directory exists, or a Perplexity/workspace draft first). Keep the PRD concise — link out to ADRs, research, and Linear issues rather than inlining. A PRD that is longer than what a reviewer will actually read is a failed PRD.

- **Owner:** Ben Elliott
- **Status:** draft | in-review | approved | archived
- **Related Linear:** LAT-XX, LAT-YY
- **Related ADRs:** ADR-XXXX

## 1. Problem Statement

What problem are we solving, for whom, and why now? One paragraph. If you cannot state it in one paragraph, the problem is not yet understood well enough to PRD.

## 2. Goals

What the work must achieve. Each goal should be concrete enough that a reader can tell whether it was met.

1. ...
2. ...

## 3. Non-Goals

What we are explicitly choosing *not* to do in this scope. Non-goals are as load-bearing as goals — they prevent scope drift.

1. ...
2. ...

## 4. Primary Users

Role, needs, and constraints of the people (or agents) this is for. If there are multiple user types, order them by primacy.

## 5. Operating Model / Workflow

How this fits into the Perplexity → Linear → repo flow. What approval gates apply (see `docs/process/operating-model.md`).

## 6. Requirements

Functional and non-functional. Prefer lists over prose. Mark each as **must** / **should** / **nice-to-have** if the prioritization is not obvious from context.

## 7. Acceptance Criteria

Observable, testable conditions for "done" at the PRD level. These become the backbone of the agent-ready tickets that implement the PRD.

- [ ] ...
- [ ] ...

## 8. Success Metrics

How we will know this worked *after* it ships. Include both:

- **Product metrics** — what the user-visible outcome should look like.
- **Workflow metrics** — cost per run, rework rate, number of human interventions, time from intake to merged PR.

## 9. Open Questions

Unresolved decisions that do not yet block drafting but must be closed before full approval. Link each to a candidate ADR if one is likely.

## 10. Risks

Known failure modes, cost-runaway paths, reversibility concerns, and mitigations. Distinguish product risk from process/cost risk.

## 11. Dependencies

What this work depends on to succeed. Three categories:

- **Hard blockers** — must land first. List `LAT-*` keys.
- **Recommended predecessors** — preferred order but not gates.
- **External** — third-party services, data sources, other teams, vendor decisions.

This section is the PRD-level counterpart to the `## Sequencing` block on agent-ready tickets (see ADR-0005). Tickets that implement this PRD should mirror the hard blockers into their own sequencing blocks.

## 12. Approval & Autonomy

What requires human approval? What can agents do unattended? Default to pilot posture in the operating model unless this PRD justifies a change.

## 13. Definition of Done

PRD-level DoD. The ticket-level DoD lives on each agent-ready ticket.

- [ ] Goals met and acceptance criteria checked.
- [ ] Success metrics instrumented (or explicitly deferred with a Linear follow-up).
- [ ] Open questions either resolved or escalated to ADRs.
- [ ] Linear and repo cross-linked.

## 14. Links

- Linear issues:
- Related ADRs:
- Prototypes / spikes:
- Prior art / research:
