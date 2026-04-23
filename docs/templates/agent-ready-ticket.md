# Agent-Ready Ticket: {{Short title}}

> An agent-ready ticket has passed the pre-flight checks below and can be dispatched to a coding, QA, review, or research agent without further clarification. A ticket that cannot pass pre-flight **must not** be labeled `agent-ready` — send it back to refinement. See the *Pre-flight refusal policy* at the bottom of this file.

- **Linear ID:** LAT-XX
- **Parent / Epic:** LAT-YY
- **Agent type:** coding | qa | review | research | sre | pm | observability
- **Risk level:** low | medium | high
- **Budget cap:** {{tokens, time, or cost — required, numeric}}
- **Approval required before dispatch:** yes | no (pilot default: yes for coding agents)

## Goal

One sentence: what this ticket should accomplish and for whom. If you need two sentences, the ticket is probably two tickets.

## Context

What the agent needs to know before starting. Link to the PRD, ADR, prior ticket, or code path. Do not duplicate durable content — link it.

## Inputs

- Files / paths:
- Linear issues:
- External references:

## Constraints

Non-negotiables the agent must respect while working. Examples: "must not modify `apps/foo/`", "must preserve current API surface", "must stay under $X in model spend", "must use existing logger, no new deps".

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

Each criterion must be objectively checkable. "Works correctly" is not a criterion; "returns 200 with payload `{...}` for request `...`" is.

- [ ] ...
- [ ] ...

## Tests

How the acceptance criteria will be verified. Distinguish the kinds:

- **Automated tests to add/change:** (unit, integration, e2e — list files or describe)
- **Existing tests that must still pass:** (if a specific suite is affected)
- **Manual verification steps, if any:** (only when automation is genuinely impractical — justify briefly)

If a criterion has no corresponding test, flag it here and justify.

## Required Evidence on Completion

- [ ] PR link (or explicit reason no PR was opened). PR title must prefix this ticket's Linear key, e.g. `LAT-XX: short imperative title`; PR body must reference the Linear issue. See `docs/process/operating-model.md` → *PR ↔ Linear linking convention*.
- [ ] Files changed.
- [ ] Tests added/run and their results.
- [ ] Known risks and unresolved questions.
- [ ] QA and/or review notes.
- [ ] Agent run report (`docs/templates/agent-run-report.md`) linked from the PR and Linear write-back.

## Rollback / Reversal Plan

How do we undo this if it goes wrong? For low-risk reversible work, state "revert PR". Otherwise describe the rollback steps concretely.

## Definition of Done

- [ ] All acceptance criteria checked.
- [ ] All listed tests pass.
- [ ] Required evidence delivered.
- [ ] Linear write-back comment posted per the operating model's *Linear write-back contract*.
- [ ] Any open questions surfaced during the run are either answered in the run report or filed as new `LAT-*` issues.

## Links

- PRD:
- ADR(s):
- Related Linear:

---

## Pre-flight: refuse to mark agent-ready if any of these fail

This block is the hard gate for promoting a ticket to `agent-ready`. A dispatcher (human or agent) must run this pre-flight and **refuse** to mark the ticket ready — or to dispatch it — if any check fails. A failed check is not a "best effort anyway" situation; it is sent back to refinement with the failing checks called out.

A ticket is **agent-ready only if all of the following are true**:

1. **Goal is specific.** One sentence, names a concrete outcome, not a theme (`"improve observability"` fails; `"add a /healthz endpoint returning 200 and the git SHA"` passes).
2. **Scope is bounded.** Both `In scope` and `Out of scope` are populated with at least one concrete item each. An empty `Out of scope` is a refusal trigger — it means the boundary wasn't thought about.
3. **Acceptance criteria are testable.** Each bullet is an observable condition, not a subjective judgment. "Clean code" / "good UX" / "robust" fail. "Returns X for input Y" / "file `foo.ts` exists and exports `bar`" pass.
4. **Tests are identified.** The `Tests` section names the verification path for each acceptance criterion, even if the answer is "manual, because …" with a stated reason.
5. **Dependencies are declared.** The `## Sequencing` block is present, `Hard blockers:` is populated (`none` is a valid value, but the line must exist), and any declared hard blocker has a `LAT-*` key that resolves to a real Linear issue. Tickets missing a `## Sequencing` block fail safely to `caution`, not `ready` (per ADR-0005).
6. **Risk level is classified.** `low`, `medium`, or `high` — not blank, not "TBD". If genuinely unknown, the ticket is not ready; triage first.
7. **Budget cap is set.** Numeric. Not "reasonable". Not empty. Runaway cost risk is always a stop-and-ask per `intake-triage.md`.
8. **Constraints are stated where they exist.** If the work touches security, secrets, migrations, schema changes, public APIs, or billing, the `Constraints` section must reflect that. Silence on those topics when they apply is a refusal trigger.
9. **Evidence expectations match risk.** High-risk work requires at minimum PR + tests + run report + reviewer; low-risk reversible work may collapse to PR + revert plan. A high-risk ticket with only "PR link" as required evidence is refused.
10. **No duplicate or stale context.** The ticket links out to the PRD/ADR/code path rather than duplicating long content inline. Pasted PRDs, pasted ADRs, or pasted prior comments are a refusal trigger — they rot.

**Refusal output shape.** When pre-flight fails, produce a short block naming each failed check and what it would take to pass:

```md
## Pre-flight: REFUSED

Failed checks:
- (2) Out of scope is empty — add at least one excluded item.
- (3) Acceptance criterion "works well" is not testable — restate as observable condition.
- (7) Budget cap missing — set a numeric cap.

Action: return to `needs-refinement`. Do not mark `agent-ready` until all failed checks pass.
```

A dispatcher that silently "rounds up" a failing ticket is itself a bug. Log the refusal on the Linear issue as a comment so the refinement loop has a durable record.
