---
id: ADR-0005
title: Linear dependency and sequencing model
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-15
supersedes:
superseded_by:
revisit_trigger: Revisit (and plan deprecation of the `## Sequencing` block as the authoritative dispatch source) when the Integration Control Plane (ICP; originally called "Agent Control Layer" in ADR-0008, renamed by ADR-0012) or a custom Linear API path can read/write native Linear issue relations, when another canonical dependency graph becomes available to agents, or when the block fails in practice during agent dispatch.
---

# ADR-0005: Linear dependency and sequencing model

## Context

ADR-0003 establishes Linear as the durable work graph and human review surface. Agent dispatch — picking the next `LAT-*` issue to hand to a coding, QA, review, or research agent — needs a deterministic, connector-readable dependency graph to decide whether an issue is actually ready to work on.

Linear has native issue relations (`blocks` / `blocked by`, `related`, `duplicate`) that are excellent for human navigation in the Linear UI. However, the Linear connector currently exposed to our agents does not provide first-class create/read operations for these relations that are suitable for dispatch decisions. Until the connector catches up — or we build a custom Linear API path — agents cannot reliably rely on native relations alone to answer "is this ticket dispatchable right now?"

Parent/child hierarchy is separately overloaded: in Linear it signals decomposition (epic → sub-issue) but is frequently read as "parent must finish before child can start," which is not what it means. Without an explicit policy, agents will conflate hierarchy with dependency.

Comments are likewise ambiguous. Agents routinely leave breadcrumbs ("note: this depends on LAT-X"), but comments are unstructured, order-dependent, and easy to miss. Treating them as authoritative for dispatch produces silent failures.

We need a model that:

- Names the distinct kinds of relationship that matter for dispatch.
- Is readable in the Linear UI by humans.
- Is readable by agents through the currently exposed connector, without a custom API path.
- Does not treat arbitrary comments or parent/child hierarchy as implicit dependencies.

## Decision Drivers

- Agents must be able to decide "is this issue dispatchable?" from connector-accessible fields, not from side channels.
- Humans must still see the dependency graph natively in Linear during backlog refinement.
- The model must not require custom tooling to launch — pilot ships with what the connector already exposes.
- Parent/child decomposition must not silently become a hard dependency.
- Sub-issues and labels are good for human navigation and filtering but cannot, alone, encode an ordered `LAT-*` dependency graph for agents.
- Comments are breadcrumbs, not contracts. They must not drive dispatch decisions.
- Over-strict blocking stalls the flywheel; under-strict blocking breaks correctness on architecture/ADR work.

## Considered Options

1. **Rely on Linear native relations only.** Use `blocks`/`blocked by`, `related`, and parent/child. Rejected: the current connector does not expose these reliably for dispatch, so agents cannot read them.
2. **Encode dependencies in free-form comments.** Rejected: unstructured, order-dependent, easy to miss; silently conflates breadcrumbs with authoritative dependencies.
3. **Treat parent/child as hard dependency by default.** Rejected: Linear hierarchy means decomposition, not sequencing. An epic is not necessarily a blocker for every child.
4. **Structured `## Sequencing` block in the issue description, paired with Linear native relations where available.** Native relations remain the canonical human/UI representation when the connector supports them; the `## Sequencing` block is the authoritative connector-readable representation for agents during the pilot.
5. **Wait for a custom Linear API path before defining any model.** Rejected: blocks the next pilot slice on tooling that does not exist; contradicts the anti-astronautics guardrail.

## Decision

**Accepted: Option 4 — three-tier relationship model, with a structured `## Sequencing` block as the connector-readable fallback.**

### The three relationship types

1. **Hard blocker.** The candidate issue cannot be dispatched until the blocker is in a terminal state: `Done`, `Cancelled`, or `Superseded` in Linear. Canonical human/UI representation is Linear's native `blocked by` / `blocks` relation when available. Authoritative agent-readable representation, during the pilot, is the `Hard blockers:` line of the `## Sequencing` block in the candidate issue's description.
2. **Soft sequencing / recommended predecessor.** Doing the predecessor first is preferred, but the agent may proceed without it if every hard blocker is clear and the remaining risk is acceptable (low-risk, reversible, cost bounded). Represented in the `Recommended predecessors:` line of the `## Sequencing` block. May also be mentioned in issue text for context; the block is authoritative.
3. **Related context.** Useful background — prior art, parallel work, linked ADRs, reference issues. Never blocks dispatch. Represented as `Related context:` in the `## Sequencing` block and/or as Linear `related` links. Agents must not treat these as predecessors.

### Parent/child hierarchy is not dependency

Parent/child in Linear means **decomposition only**. A parent epic is not a hard blocker for its children, and a child is not a hard blocker for its parent, unless that relationship is explicitly declared in the `## Sequencing` block of the relevant issue (for example, "Hard blockers: LAT-12" on a child that genuinely cannot start until another child completes).

### Comments are not authoritative for dependencies

Comments may contain human or agent breadcrumbs about dependencies — that is fine and often useful. But agents must not infer hard blockers, soft predecessors, or related context from comments for dispatch decisions. If a comment uncovers a real dependency, the next agent or human to touch the issue must lift it into the `## Sequencing` block before dispatch.

### The `## Sequencing` block format

Every agent-ready ticket includes a `## Sequencing` section in the issue description (and in the repo's agent-ready-ticket template) with the following shape:

```md
## Sequencing

Hard blockers: LAT-15, LAT-12
Recommended predecessors: LAT-13, LAT-9
Related context: LAT-5, LAT-6
Dispatch status: blocked | ready | caution
Dispatch note: one short line of context for a human or agent reading this
```

Rules:

- Each field is a single line. Values are comma-separated `LAT-*` keys, or the literal word `none`.
- `Dispatch status` takes exactly one of `blocked`, `ready`, `caution`. It is the last-computed status, written by whoever last refined the ticket. It is a cache, not the authority — agents must re-verify at dispatch time.
- `Dispatch note` is a one-line human-readable comment, optional but recommended when status is `caution` or `blocked`.
- If the section is missing on an architecture or ADR ticket, the agent must treat dispatch status as `caution` — not `ready` — and flag the ticket for refinement before proceeding.
- For non-architecture tickets, a missing block defaults to `Hard blockers: none`, `Recommended predecessors: none`, `Related context: none`, `Dispatch status: ready` — but the next refinement pass should add the block explicitly so dispatch does not rely on defaults.

### Dispatch algorithm

Before dispatching any agent to a `LAT-*` issue:

1. **Fetch the candidate issue** via the Linear connector (description + current status).
2. **Read the `## Sequencing` block.** If absent on an architecture/ADR ticket, stop and flag for refinement (`caution`). Otherwise, use the defaults above.
3. **Verify every hard blocker** listed in `Hard blockers:` is in `Done`, `Cancelled`, or `Superseded` status in Linear at dispatch time. Re-verify even if the cached `Dispatch status` says `ready`.
4. **If any hard blocker is not terminal:** stop. Do not dispatch. Report the unresolved blocker(s) back to the caller and leave a write-back on the candidate issue per the ADR-0003 write-back contract.
5. **If all hard blockers are terminal but soft predecessors remain:** proceed only if the work is low-risk and reversible (per `intake-triage.md` severity policy) and the budget cap is intact. Flag the unresolved soft predecessors in the agent-run report and in the Linear write-back. Otherwise, stop and report.
6. **Ignore parent/child hierarchy as dependency** unless the hierarchy relation is also listed explicitly in `Hard blockers:` or `Recommended predecessors:`.
7. **Ignore comment-based dependency claims.** If a comment suggests an unlisted blocker, surface it as a refinement finding — do not treat it as a blocker for this dispatch unless a human or refinement pass lifts it into the `## Sequencing` block.
8. **Record the dispatch decision** (ready / caution / blocked, with the blocker list) in the run report and the Linear write-back.

### Relationship to Linear native relations

When the Linear connector begins to expose native `blocks` / `blocked by` create/read operations, the `## Sequencing` block remains the dispatch source and the native relation remains the canonical human/UI representation. At that point, a follow-up ADR may promote native relations to the authoritative dispatch source and demote the block to a mirror — but not before. Until then, native relations are a human navigation aid, not a dispatch input.

### Status: transitional pilot bridge

The `## Sequencing` block is a **pilot bridge**, not the long-term architecture. It exists because the current Linear connector cannot reliably read or write native issue relations, and agents need *some* connector-readable dependency graph today. Duplicating the dependency graph into issue descriptions is accepted as the lowest-cost way to unblock the pilot, not as the desired steady state.

### Deprecation and migration

This ADR must be revisited and the block deprecated as the authoritative dispatch source once **either** of the following is true:

- The Integration Control Plane (ICP; originally "Agent Control Layer" per ADR-0008, renamed by ADR-0012) or a custom Linear API path can read and write native Linear issue relations — `blocks` / `blocked by` — reliably enough for dispatch decisions, **or**
- Another canonical dependency graph (e.g. a dedicated control-plane store) becomes available to agents with equivalent or better guarantees than the `## Sequencing` block.

At that point:

- A follow-up ADR (or an amendment to this one) is **required** before the migration happens. That ADR must define: the new source of truth, the migration path for existing tickets, the sync behavior between the new source and any remaining description-level representation, and stale-data handling during and after cutover.
- The `## Sequencing` block may then be **demoted to a generated mirror / cache** for human readability in the Linear UI, or **removed from issue descriptions entirely**, depending on what the follow-up ADR decides.
- Agents must not silently start reading native relations or an alternative graph as the dispatch source before that follow-up ADR lands. Behavior change on the dispatch source is an ADR-gated event.

Until that follow-up ADR exists, agents **must** continue to treat the `## Sequencing` block as authoritative, because it remains the only connector-readable pilot mechanism for dispatch. Running ahead of the migration risks silent dispatch across unresolved blockers.

### Sub-issues and labels

Sub-issues (parent/child hierarchy) and labels are useful for human navigation, backlog decomposition, and filtering — they are **not** an authoritative dependency graph for agent dispatch in the pilot. Specifically:

- **Sub-issues** express *work breakdown*, not *execution order*. A parent issue such as "Decision backlog" with child ADR tickets is a legitimate organizational pattern; agents dispatching any child still read that child's `## Sequencing` block to determine dependencies. A sub-issue only becomes a hard dependency for its sibling or parent when the relationship is explicitly listed in a `## Sequencing` block or encoded as a Linear native `blocks` relation.
- **Labels** classify issue *kind* or *coarse state* — for example `decision`, `policy`, `template`, `executable-adapter`, `blocked`, `caution`, `ready`. They are scannable filters for humans and may mirror a `Dispatch status` value, but labels alone cannot encode an ordered dependency list because they cannot point to specific blocking `LAT-*` IDs. An agent must never resolve a blocker from a label.

The table below summarizes how each Linear mechanism is used under this ADR.

| Mechanism | Primary purpose | Authoritative for dispatch? | Who reads it |
|---|---|---|---|
| Linear native `blocks` / `blocked by` | Canonical human/UI dependency view | Not during pilot (connector cannot reliably read/write); may be promoted in a follow-up ADR | Humans in Linear UI; agents once connector supports it |
| `## Sequencing` block in description | Structured, connector-readable dependency declaration | **Yes** — authoritative for agents during the pilot | Agents (at dispatch) and humans (during refinement) |
| Sub-issues (parent/child) | Work decomposition / epic → child breakdown | No — decomposition only, never an implicit dependency | Humans for navigation; agents ignore unless lifted into `## Sequencing` |
| Labels | Classify kind (`decision`, `policy`, `template`, `executable-adapter`) or coarse state (`blocked`, `caution`, `ready`) | No — cannot encode ordered `LAT-*` dependencies | Humans for filtering; agents may use for triage, never for blocker resolution |
| Comments | Breadcrumbs, rationale, write-back | No — must not drive dispatch | Humans and agents for context; lifted into `## Sequencing` if a real dependency is discovered |

## Consequences

Good:

- Agents can answer "is this dispatchable?" from a single structured block they can already read through the existing connector.
- Humans retain the Linear-native view via `blocks` / `blocked by` relations, which stays readable during backlog refinement.
- Parent/child and comments stop silently becoming dependencies.
- Architecture/ADR tickets without an explicit sequencing block fail safely to `caution`, not `ready`.
- No custom Linear API path is required to start.

Bad / open:

- Until native relations are connector-readable, the dispatch graph lives in two places (native UI + description block). Drift is possible; refinement passes must keep them aligned, and a future automation check should flag divergence.
- The `Dispatch status` field is a cache and will go stale. Agents re-verify at dispatch, so this is a freshness concern for humans reading backlog, not a correctness concern for dispatch.
- Requires discipline during refinement to actually populate `## Sequencing`. Missing blocks on architecture tickets degrade to `caution` by design, which may cause extra refinement round-trips early in the pilot.
- Soft-predecessor escape hatches ("proceed if low-risk and reversible") depend on correct risk classification upstream. If intake misclassifies risk, dispatch inherits the error.

## Open Questions

1. When and how to automate the `## Sequencing` ↔ native-relation parity check (likely tied to the ADR-0004 docs-vs-skills automation follow-up).
2. Exact mechanism to expose native Linear `blocks` / `blocked by` through the connector — deferred until the connector roadmap is clear.
3. Whether to extend the block with cost-band awareness (e.g. `Max cost band:`) once the telemetry substrate ADR lands.

## Confirmation

Working if, three months in:

- Agent-ready tickets consistently contain a `## Sequencing` block, and dispatch decisions cite that block by default.
- No agent dispatch has silently proceeded across an unresolved hard blocker.
- Parent/child relationships have not been misread as dependencies in any dispatched run.
- No dispatch decision has relied on a comment-based dependency claim.
- When the Linear connector gains native-relation read access, migrating is a small follow-up ADR, not a rewrite.

## Links

- Linear: `LAT-15`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0004-process-docs-vs-agent-skills.md`.
- Template: `docs/templates/agent-ready-ticket.md`.
- Process: `docs/process/operating-model.md`, `docs/process/intake-triage.md`.
