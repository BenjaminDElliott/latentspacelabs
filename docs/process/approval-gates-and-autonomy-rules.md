# Approval gates and autonomy rules

Operational rule matrix for the Agentic Development Flywheel pilot. Companion to ADR-0006 (which captures the architecture decision); this document captures the day-to-day rules a human or agent can look up without re-deriving policy.

If this doc and ADR-0006 disagree, the ADR wins until superseded. If this doc and `operating-model.md` disagree, update the one that's wrong in the same PR that flagged the conflict.

## Why this document exists

ADR-0001 chose Perplexity / Linear / GitHub as the control plane. ADR-0003 bounded what Linear stores. ADR-0005 defined dispatch readiness and noted that Perplexity's Linear connector does not reliably expose first-class native relations. ADR-0006 names the follow-on: **Perplexity is the cognitive front door; an owned Agent Control Layer (ACL) is the operational substrate for anything requiring first-class APIs, deterministic dispatch, or auditable runs.**

This document is the rule matrix that operationalizes that boundary. It is intended to be concrete enough that a future agent can classify a new action in seconds.

## Core finding

**Perplexity connectors are useful convenience tools for bounded direct actions and drafting, but not the authoritative dispatch/dependency substrate.** Use Perplexity for cognition (triage, drafting, synthesis, read-heavy analysis) and for cheap, reversible Linear writes. Route anything that needs first-class API semantics, native Linear relations, deterministic dispatch, or high-fidelity telemetry through the ACL.

**The ACL side of the boundary is concrete, not speculative.** The Linear GraphQL API already exposes first-class CRUD for native issue relations — `issueRelationCreate`, inline `issue.relations`, `issueRelationDelete` — with `IssueRelationType` covering `blocks`, `related`, and `duplicate` (`blocked` is the inferred inverse of `blocks`). Combined with issue status fields, parent/child links, labels, and pagination, this is enough to build deterministic next-dispatchable issue selection in an owned adapter. The first ACL capability should therefore be a **direct Linear GraphQL adapter** for issue-relation CRUD and next-dispatchable selection (see ADR-0006, "First implementation implication").

## The four action categories

Every action falls into exactly one category.

| Category | Short code | Meaning |
|---|---|---|
| Perplexity-direct | **P-Direct** | Perplexity invokes the connector directly. Cheap, reversible, or cognitive. Connector drift is tolerable. |
| Perplexity-propose, human-approve | **P-Propose** | Perplexity drafts; human confirms in-thread before execution. Used for asymmetric or semi-durable actions. |
| Agent Control Layer routed | **ACL-Routed** | Action executes through an owned ACL skill/adapter. Used when first-class API semantics, native Linear relations, dispatch determinism, or recorded runs are required. Perplexity may trigger, but the adapter is authoritative. |
| Forbidden / stop-and-ask | **Stop** | Always halts. High-risk, destructive, security-sensitive, or runaway-cost. No autonomy level overrides. |

## Autonomy levels (pilot)

| Level | Name | What's enabled |
|---|---|---|
| **L0** | Observe / draft only | Read and draft. No external writes. |
| **L1** | Reversible workspace / docs draft | Workspace drafts, draft PR changes, draft tickets/ADRs. No Linear writes. |
| **L2** | Bounded Linear / GitHub write-backs | Create/update Linear issues, add comments, open PRs that follow the PR ↔ Linear linking convention. No project creation. No native-relation writes. |
| **L3** | Agent dispatch with human approval | ACL selects a dispatchable `LAT-*` issue per ADR-0005; a coding/QA/review agent starts only after explicit human go. |
| **L4** | Autonomous implementation with review gates | A dispatched agent executes end-to-end, opens a PR, requests review. Merge still requires human approval. |
| **L5** | Autonomous merge / deploy | **Out of scope for the pilot.** Explicitly not accepted. A separate ADR is required to enable. |

**Pilot defaults:** Perplexity runs at L2. ACL-dispatched agents run at L3-with-approval. Raising a level requires explicit approval; L4+ requires an ADR.

## Failure posture by severity

Severity classification follows `intake-triage.md`. The severity check overrides category defaults.

| Severity | Posture |
|---|---|
| Low / reversible | Proceed and flag. Leave a breadcrumb for review. |
| Medium | Take the safest reversible action. Ask if uncertain. Do not persist irreversible artifacts. |
| High / security / data-loss / destructive | **Stop and ask.** Do not act. |
| Runaway-cost | **Always stop and ask.** No autonomy level overrides this. |

A Low/reversible classification never promotes an action out of its category: a Stop-category item stays Stop even if the individual action looks cheap.

## Rule matrix

Each row lists the category, the minimum autonomy level at which the action is permitted, and notes. When a row says `ACL-Routed`, Perplexity may trigger the skill but the ACL adapter is the authoritative execution path.

### Linear

| Action | Category | Min level | Notes |
|---|---|---|---|
| Create Linear issue (intake / refinement) | P-Direct | L2 | Cheap and reversible. Must follow `intake-triage.md`; never auto-create for personal items. |
| Update Linear issue description | P-Direct | L2 | Keep `## Sequencing` block intact; see ADR-0005. |
| Add Linear comment / agent write-back | P-Direct | L2 | Must follow the Linear write-back contract (ADR-0003): outcome, evidence, risk flags, PR link, next action. |
| Create Linear **project** | P-Propose | L2 → human | Draft only; explicit Ben approval required before creation. See ADR-0003. |
| Read `## Sequencing` block for humans / triage | P-Direct | L1 | Reading for context. |
| Read `## Sequencing` block for dispatch decision | ACL-Routed | L3 | Dispatch determinism per ADR-0005. |
| Create native Linear issue relation (`blocks` / `blocked by` / `related` / `duplicate`) | ACL-Routed | L2 | ACL adapter writes via Linear GraphQL `issueRelationCreate`. Perplexity connector is not authoritative here. |
| Read native Linear issue relations for dispatch | ACL-Routed | L3 | ACL adapter reads via inline `issue.relations`; `blocked` is inferred inverse of `blocks`. |
| Delete native Linear issue relation | ACL-Routed | L2 | ACL adapter via `issueRelationDelete`. |
| Add / remove labels (state classification only) | P-Direct | L2 | Labels are filters, not dependencies. Must not encode blockers. |
| Select next dispatchable `LAT-*` issue | ACL-Routed | L3 | Must execute the ADR-0005 dispatch algorithm; records decision. |
| Reassign or change owner | P-Propose | L2 → human | Touches accountability; confirm first. |
| Delete a Linear issue | Stop | — | Always human. |

### GitHub / code / PRs

| Action | Category | Min level | Notes |
|---|---|---|---|
| Clone a repo, read code | P-Direct | L0 | Read-only. |
| Draft a PR body or diff (no push) | P-Direct | L1 | Workspace draft. |
| Open a PR | ACL-Routed | L2 | PR title must prefix the Linear issue key; body must reference the issue. See `operating-model.md`. |
| Add PR comments | P-Direct | L2 | |
| Request review | ACL-Routed | L2 | Through the ACL when the agent that opened the PR is dispatched. |
| Approve a PR | Stop | — | Agents are never authorized to approve PRs. |
| Merge a PR | Stop | — | Human only during the pilot. |
| Force-push / rewrite shared history | Stop | — | Always human and always explicitly asked for. |
| Delete a branch with unmerged work | Stop | — | Confirm first. |
| Deploy | Stop | — | Human only during the pilot. |

### Agent runs

| Action | Category | Min level | Notes |
|---|---|---|---|
| Start coding agent | ACL-Routed | L3 | Human-approved per dispatch during pilot. |
| Start QA / review agent | ACL-Routed | L3 | Same. |
| Run a self-contained evaluation or spike inside the agent's own workspace | P-Direct | L1 | No external writes. |
| Record an agent run report | ACL-Routed | L2 | Write-back contract enforcement (ADR-0003). |
| Write high-fidelity telemetry / traces | ACL-Routed | L2 | Into the future telemetry substrate; until it exists, a committed Markdown run report (see `docs/templates/agent-run-report.md`). |

### Docs, ADRs, templates, and rules

| Action | Category | Min level | Notes |
|---|---|---|---|
| Draft an ADR, PRD, process doc, or template change | P-Direct | L1 | Drafts only. |
| Open a PR updating docs / ADRs / templates | P-Propose → ACL-Routed | L2 | Propose the draft; open the PR through the usual convention. Merge is Stop. |
| Merge a docs / ADR / template PR | Stop | — | Human only. |
| Change approval gates or autonomy rules (edit this doc or ADR-0006) | Stop | — | Requires an ADR. Agents may draft; humans decide. |
| Raise an autonomy level beyond the pilot default | Stop | — | Requires explicit approval. L4+ requires an ADR. |

### Communication and external surfaces

| Action | Category | Min level | Notes |
|---|---|---|---|
| Respond inside the Perplexity thread | P-Direct | L0 | Cognition is the point of the thread. |
| Post to Slack, email, or any external channel | Stop | — | Opt-in per channel via an explicit rule change / ADR. |
| Open an issue on an external (non-LAT) GitHub repo | Stop | — | Confirm first; treat as external communication. |
| Publish to a public surface (blog, social, etc.) | Stop | — | Always human. |

### Cost and environment

| Action | Category | Min level | Notes |
|---|---|---|---|
| Read connector status / quotas | P-Direct | L0 | |
| Spend that stays inside the agreed cost band for the current run | P-Direct | L2 | Cost band defined in the run brief; elevated bands must be flagged per ADR-0003. |
| Any action that would exceed the cost band, or whose cost is unknown | Stop | — | Runaway-cost is always Stop. |
| Provision new infrastructure / services | Stop | — | Human only. |
| Change secrets, tokens, connector permissions | Stop | — | Human only. |

## Dispatch and the ACL

The ACL's canonical responsibilities during the pilot:

- Execute the ADR-0005 dispatch algorithm: read the candidate's `## Sequencing` block, re-verify hard blockers in Linear via the GraphQL adapter's native-relation read (`blocks` / inferred `blocked`), stop on unresolved hard blockers, flag unresolved soft predecessors, ignore parent/child and comment-based claims.
- Write the Linear write-back per ADR-0003's five-element contract.
- Enforce the PR ↔ Linear linking convention (`operating-model.md`) when opening a PR on behalf of an agent.
- Record the run report (`docs/templates/agent-run-report.md`) until the telemetry substrate ADR lands.
- Apply the cost-band check before starting any agent that has non-trivial spend risk.

**First ACL capability to build:** a direct Linear GraphQL adapter that implements native issue-relation CRUD (`issueRelationCreate`, inline `issue.relations`, `issueRelationDelete`) and next-dispatchable issue selection. This is the adapter that moves dispatch determinism from the `## Sequencing` block to first-class Linear semantics. See ADR-0006 ("First implementation implication").

The ACL is, for now, deterministic skills and adapters committed to this repo — not a standalone service. It graduates to a service only when a real need forces it.

## How to classify a new action

When Perplexity or a human agent encounters an action not listed above:

1. Is it destructive, security-sensitive, runaway-cost, merges, deploys, or external communication? → **Stop** by default. Require an explicit rule change to enable.
2. Does it need first-class Linear API semantics, native relations, dispatch determinism, or a recorded run? → **ACL-Routed.**
3. Is it asymmetric (project creation, owner changes, anything Ben would want to see before it happens)? → **P-Propose.**
4. Otherwise, cheap and reversible? → **P-Direct.**

If none of these fit cleanly, treat the action as **P-Propose** and ask. Over-acting is a worse failure mode than over-asking for actions outside the matrix; for actions inside the matrix, the opposite holds.

## Sequencing

Hard blockers: none (LAT-15 / ADR-0005 has merged to main)
Recommended predecessors: none
Related context: LAT-6, LAT-9, LAT-10, LAT-12, LAT-13
Dispatch status: ready
Dispatch note: LAT-15 (ADR-0005) merged; the dispatch algorithm this doc references is now on `main`. This doc is ready for review and merge as a standalone change.

## Related

- ADRs: `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-control-layer-and-perplexity-boundary.md`.
- Process: `docs/process/operating-model.md`, `docs/process/intake-triage.md`.
- Templates: `docs/templates/agent-ready-ticket.md`, `docs/templates/agent-run-report.md`.
- Linear: `LAT-16` (this boundary), `LAT-6` (autonomy dial / operating posture).
