# Approval requirements for risky actions

## Approval requirements for risky actions by agent type

## Approval requirements for risky actions by agent type

This document defines approval requirements for each risky action that agents of each type may perform. Every risky action is mapped to one of three approval gates: **human** (Ben Elliott), **automated** (ICP-enforced without human input), or **none** (agent may proceed autonomously).

## Policy framework reference

The approval gates in this document are governed by **LAT-21** (agent invocation and integration boundaries, ADR-0013), which established the four action categories:

- **P-Direct**: Perplexity invokes the connector directly. Cheap, reversible, or cognitive. Connector drift is tolerable.
- **P-Propose**: Perplexity drafts; human confirms in-thread before execution. Used for asymmetric or semi-durable actions.
- **ICP-Routed**: Action executes through an owned ICP skill/adapter. Used when first-class API semantics, native Linear relations, dispatch determinism, or recorded runs are required.
- **Stop**: Always halts. High-risk, destructive, security-sensitive, or runaway-cost. No autonomy level overrides.

This document maps each risky action to an **approval gate type** (human, automated, none) and references the owning LAT/ADR. It is the companion to `approval-gates-and-autonomy-rules.md` (which defines the category-by-category rule matrix) and `agent-ready-ticket.md` (which carries the approval-required field per ticket).

If this document and LAT-21 / ADR-0013 disagree, LAT-21 wins until superseded.

## Agent types covered

The following seven agent types are defined by the run-report envelope (ADR-0006, `docs/templates/agent-run-report.md`):

1. **coding** — produces code changes, opens PRs
2. **qa** — verifies acceptance criteria, runs tests
3. **review** — reviews PRs, makes approve/request-changes decisions
4. **sre** — manages deployment, infrastructure, runbooks, alerts
5. **pm** — produces PRDs, refines tickets, manages backlog
6. **research** — conducts spikes, evaluations, comparative analysis
7. **observability** — manages dashboards, alerts, SLO checks

## Approval gate definitions

| Gate | Description | Example |
|---|---|---|
| **human** | Ben Elliott must explicitly approve before the action executes. The agent halts and waits for approval. | Deploy to production |
| **automated** | ICP enforces a rule automatically without human input. The action is gated on a condition (budget, test pass, config present). | Budget cap not exceeded |
| **none** | Agent may proceed without waiting for any gate. The action is low-risk and reversible. | Fix a typo |

## Approval requirements by agent type

### Coding agent

Risky actions a coding agent may perform, mapped to approval gates:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| C1 | Fix a typo (single character, no logic change) | none | LAT-181 | Reversible, no review required |
| C2 | Change a variable name or refactor locally scoped code | none | LAT-181 | Low-risk, reversible |
| C3 | Add or update unit tests for existing code | none | LAT-181 | Automated gate: tests must pass |
| C4 | Add new dependency to `package.json` | automated | LAT-174, LAT-21 | Must not violate ADR-0011 (TypeScript/Node/npm) |
| C5 | Modify a public API surface (exported types, functions, endpoints) | human | LAT-21, LAT-174 | Ben must confirm breaking-change implications |
| C6 | Modify a security-sensitive surface (auth, permissions, secrets, credentials) | human | LAT-180, LAT-64 | e.g., `.env` changes, token handling, RBAC |
| C7 | Create a new top-level package or directory under `packages/` | human | LAT-181 | Adds a new surface; Ben confirms scope |
| C8 | Open a PR on the repo | automated | LAT-21, operating-model.md | Gate: PR title prefixes the Linear issue key |
| C9 | Merge a PR | human | LAT-21, operating-model.md | Human only during the pilot |
| C10 | Force-push / rewrite shared history | human | LAT-21 | Always requires Ben's explicit ask |
| C11 | Create a new branch | none | LAT-181 | Low-risk; naming convention enforced by ICP |
| C12 | Delete a branch with unmerged work | human | LAT-21 | Confirm first; risk of data loss |
| C13 | Change ADR-0011 language/runtime policy | human | LAT-21, ADR-0011 | Requires a superseding ADR |
| C14 | Edit a shared conflict-surface hub file (e.g., `docs/README.md`, `docs/decisions/README.md`) without owning it | automated | LAT-181, coding-agent-preflight.md | Gate: ticket must explicitly own the hub |
| C15 | Write a new ADR | human | LAT-21 | Ben approves the architectural decision |
| C16 | Write a new PRD | human | LAT-21 | Ben approves the product scope |
| C17 | Exceed the ticket's `Budget cap` | human | LAT-21, ADR-0009 | Runaway-cost interrupt; must unblock in Linear |
| C18 | Deploy to a target environment | human | LAT-180 | SRE primary; coding agent delegates |
| C19 | Run a self-contained evaluation or spike inside the agent's workspace | none | LAT-181 | No external writes |

### QA agent

Risky actions a QA agent may perform:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| Q1 | Run existing test suite and report results | none | LAT-181 | Read-only output |
| Q2 | Run a new test file that was added by a coding agent's PR | automated | LAT-181 | Gate: test file must be in the same PR |
| Q3 | Mark a PR as passing or failing based on test results | automated | LAT-8 | Automated gate; human review still required for merge |
| Q4 | Flag a `high` or `critical` severity finding | human | LAT-8, LAT-21 | Critical findings always route to Ben |
| Q5 | Request changes on a PR | automated | LAT-8 | Gate: at least one `medium` finding present |
| Q6 | Block a merge on a `critical` finding | human | LAT-8, LAT-21 | Ben must confirm before merge resumes |
| Q7 | Re-run tests on a PR branch without a test file change | automated | LAT-181 | Gate: same test suite, no new scope |
| Q8 | Write a new QA template or modify the existing one | human | LAT-8, LAT-21 | Changes to the evidence contract |

### Review agent

Risky actions a review agent may perform:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| R1 | Comment on a PR with observations | none | LAT-181 | Low-risk, non-binding |
| R2 | Recommend `approve` on a PR | automated | LAT-8 | Gate: all acceptance criteria met, no high/critical findings |
| R3 | Recommend `approve-with-nits` on a PR | automated | LAT-8 | Gate: no `medium` or higher findings |
| R4 | Recommend `request-changes` on a PR | automated | LAT-8 | Gate: at least one `medium` finding |
| R5 | Recommend `block-merge` on a PR | human | LAT-8, LAT-21 | Gate: `high` or `critical` finding |
| R6 | Recommend `needs-human` on a PR | human | LAT-8 | Gate: finding requires Ben's judgment |
| R7 | Approve a PR (override recommendation) | human | LAT-21, operating-model.md | Agents never approve PRs directly |
| R8 | Comment on a PR from a different PR | automated | LAT-8 | Gate: the other PR is linked to the same Linear issue |
| R9 | Review a PR against an acceptance criterion not listed in the ticket | automated | LAT-8 | Gate: criterion is referenced in a linked ADR/PRD |

### SRE agent

Risky actions an SRE agent may perform:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| S1 | Check a health endpoint or status page | none | LAT-181 | Read-only, reversible |
| S2 | Restart a non-production service | automated | LAT-181 | Gate: service is not `production` |
| S3 | Restart a production service | human | LAT-180, LAT-21 | Production restart carries downtime risk |
| S4 | Deploy to production | human | LAT-180, LAT-21 | The canonical Stop action |
| S5 | Provision new infrastructure / services | human | LAT-21, operating-model.md | Always human; cost and architecture impact |
| S6 | Change secrets, tokens, or connector permissions | human | LAT-21, LAT-64 | Always human |
| S7 | Modify an alert threshold | automated | LAT-181 | Gate: threshold stays within pre-approved range |
| S8 | Create a new alert | human | LAT-180 | New alert surfaces = new operational risk |
| S9 | Run a runbook step | none | LAT-181 | Low-risk; documented procedure |
| S10 | Execute a database migration | human | LAT-180, LAT-21 | Data loss / schema change risk |
| S11 | Scale up or down a production resource | automated | LAT-181 | Gate: within pre-approved scaling range |
| S12 | Post to Slack, email, or any external channel | human | LAT-21 | External comms are always Stop |
| S13 | Publish to a public surface (blog, social, etc.) | human | LAT-21 | Always human |
| S14 | Resume a ticket halted for runaway-cost | human | LAT-21, cost-controls.md | Requires explicit Ben unblock comment |
| S15 | Open an issue on an external (non-LAT) GitHub repo | human | LAT-21 | Treat as external communication |

### PM agent

Risky actions a PM agent may perform:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| P1 | Draft a PRD or ADR | none | LAT-181 | Draft only; no writes to Linear |
| P2 | Create a new Linear issue | automated | LAT-21, LAT-9 | Gate: issue follows `intake-triage.md` conventions; defaults to `needs-refinement` |
| P3 | Update a Linear issue description | none | LAT-181 | Cheap and reversible; keep `## Sequencing` block intact |
| P4 | Create a Linear project | human | LAT-21, LAT-9 | Draft only; explicit Ben approval before creation |
| P5 | Reassign or change ticket owner | human | LAT-21, approval-gates.md | Touches accountability |
| P6 | Delete a Linear issue | human | LAT-21, approval-gates.md | Always human |
| P7 | Close a ticket | human | LAT-21 | Confirms work is complete |
| P8 | Run a backlog refinement pass | none | LAT-181 | Read-only or bulk label updates |
| P9 | Promote a ticket to `agent-ready` | human | LAT-21, agent-ready-ticket.md | Gate: all pre-flight checks pass |
| P10 | Change approval gates or autonomy rules | human | LAT-21, approval-gates.md | Requires an ADR |
| P11 | Raise an autonomy level beyond the pilot default | human | LAT-21, approval-gates.md | L4+ requires an ADR |
| P12 | Write a retro report | none | LAT-181 | Draft only |
| P13 | Archive a research spike | automated | LAT-181 | Gate: no open PRs tied to the spike |

### Research agent

Risky actions a research agent may perform:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| RE1 | Fetch external web content (docs, blogs, specs) | none | LAT-181 | Read-only, reversible |
| RE2 | Compare two libraries or frameworks | none | LAT-181 | Output is a report; no repo changes |
| RE3 | Write a spike report | none | LAT-181 | Draft only |
| RE4 | Promote spike findings to a PRD or ADR | human | LAT-21 | Creates durable artifacts |
| RE5 | Recommend a language or runtime for a new package | human | LAT-174, ADR-0011 | Architecture-relevant decision |
| RE6 | Recommend a third-party dependency | automated | LAT-174, ADR-0011 | Gate: not already in use in the repo |
| RE7 | Open an issue on an external GitHub repo | human | LAT-21 | External communication |
| RE8 | Run a self-contained evaluation inside the agent's workspace | none | LAT-181 | No external writes |
| RE9 | Delete spike findings from the repo | none | LAT-181 | Low-risk; findings are draft artifacts |

### Observability agent

Risky actions an observability agent may perform:

| # | Action | Gate | LAT/ADR | Notes |
|---|---|---|---|---|
| O1 | Query a dashboard or metrics endpoint | none | LAT-181 | Read-only |
| O2 | Update a dashboard layout or widget | automated | LAT-181 | Gate: dashboard exists and is owned |
| O3 | Create a new dashboard | human | LAT-180 | New operational surface |
| O4 | Modify an alert threshold within range | automated | LAT-181 | Same as SRE S7 |
| O5 | Create a new alert rule | human | LAT-180, LAT-21 | New alert = new operational risk |
| O6 | Change an SLO target | human | LAT-21 | Changes a product-level commitment |
| O7 | Flag a regression in a metric | automated | LAT-181 | Gate: threshold comparison |
| O8 | Create a new SLO | human | LAT-180 | New commitment surface |
| O9 | Export or aggregate trace data | none | LAT-181 | Read-only; output is a report |
| O10 | Delete a dashboard or alert | human | LAT-21 | Risk of losing operational history |

## Decision summary table

The following table summarizes all risky actions across agent types, grouped by gate type:

### Human-gated actions (must wait for Ben)

| Action | Agent type | LAT/ADR |
|---|---|---|
| Deploy to production | sre | LAT-180, LAT-21 |
| Merge a PR | coding | LAT-21, operating-model.md |
| Force-push / rewrite shared history | coding | LAT-21 |
| Modify public API surface | coding | LAT-21, LAT-174 |
| Modify security-sensitive surface | coding | LAT-180, LAT-64 |
| Create new top-level package | coding | LAT-181 |
| Write a new ADR / PRD | coding | LAT-21 |
| Delete a branch with unmerged work | coding | LAT-21 |
| Exceed Budget cap | coding | LAT-21, ADR-0009 |
| Block a merge on critical finding | qa | LAT-8, LAT-21 |
| Approve a PR (override) | review | LAT-21, operating-model.md |
| Recommend block-merge | review | LAT-8, LAT-21 |
| Recommend needs-human | review | LAT-8 |
| Restart production service | sre | LAT-180, LAT-21 |
| Provision new infrastructure | sre | LAT-21 |
| Change secrets or permissions | sre | LAT-21, LAT-64 |
| Create new alert | sre | LAT-180 |
| Run database migration | sre | LAT-180, LAT-21 |
| Post to external channel | sre | LAT-21 |
| Resume runaway-cost ticket | sre | LAT-21, cost-controls.md |
| Open issue on external repo | sre | LAT-21 |
| Promote to agent-ready | pm | LAT-21, agent-ready-ticket.md |
| Create Linear project | pm | LAT-21, LAT-9 |
| Reassign ticket owner | pm | LAT-21 |
| Delete a Linear issue | pm | LAT-21 |
| Close a ticket | pm | LAT-21 |
| Change approval gates | pm | LAT-21 |
| Raise autonomy level | pm | LAT-21 |
| Promote spike findings to PRD/ADR | research | LAT-21 |
| Recommend language/runtime | research | LAT-174, ADR-0011 |
| Open external GitHub issue | research | LAT-21 |
| Create new dashboard | observability | LAT-180 |
| Create new alert rule | observability | LAT-180 |
| Change SLO target | observability | LAT-21 |
| Create new SLO | observability | LAT-180 |
| Delete a dashboard or alert | observability | LAT-21 |

### Automated-gated actions (ICP-enforced, no human input)

| Action | Agent type | Gate condition | LAT/ADR |
|---|---|---|---|
| Open a PR | coding | PR title prefixes Linear issue key | LAT-21, operating-model.md |
| Add new dependency | coding | Not already in use; TypeScript/Node/npm compliant | LAT-174, ADR-0011 |
| Edit shared hub file without owning | coding | Ticket explicitly owns the hub | LAT-181, coding-agent-preflight.md |
| Run new test from same PR | qa | Test file in the PR | LAT-181 |
| Flag high/critical finding | qa | Severity classification | LAT-8 |
| Request changes on PR | qa | At least one medium finding | LAT-8 |
| Re-run tests same suite | qa | No new scope | LAT-181 |
| Approve PR | review | No high/critical findings | LAT-8 |
| Approve-with-nits PR | review | No medium or higher findings | LAT-8 |
| Request changes on PR | review | At least one medium finding | LAT-8 |
| Comment from linked PR | review | Other PR linked to same Linear issue | LAT-8 |
| Restart non-prod service | sre | Service is not production | LAT-181 |
| Scale within range | sre | Within pre-approved scaling range | LAT-181 |
| Create Linear issue | pm | Follows intake-triage conventions | LAT-21, LAT-9 |
| Archive spike with no open PRs | pm | Gate: no open PRs tied to spike | LAT-181 |
| Recommend third-party dependency | research | Not already in use | LAT-174, ADR-0011 |
| Update dashboard widget | observability | Dashboard exists and is owned | LAT-181 |
| Modify alert threshold | observability | Within pre-approved range | LAT-181 |
| Flag metric regression | observability | Threshold comparison | LAT-181 |

### No-gate actions (agent may proceed autonomously)

| Action | Agent type | LAT/ADR |
|---|---|---|
| Fix a typo | coding | LAT-181 |
| Rename local variable / refactor | coding | LAT-181 |
| Add/update unit tests | coding | LAT-181 |
| Create a new branch | coding | LAT-181 |
| Self-contained evaluation in workspace | coding | LAT-181 |
| Run existing test suite | qa | LAT-181 |
| Comment on a PR | review | LAT-181 |
| Run a runbook step | sre | LAT-181 |
| Check health endpoint | sre | LAT-181 |
| Draft a PRD or ADR | pm | LAT-181 |
| Update issue description | pm | LAT-181 |
| Run a backlog refinement pass | pm | LAT-181 |
| Write a retro report | pm | LAT-181 |
| Fetch external web content | research | LAT-181 |
| Compare libraries/frameworks | research | LAT-181 |
| Write a spike report | research | LAT-181 |
| Self-contained evaluation in workspace | research | LAT-181 |
| Delete spike findings | research | LAT-181 |
| Query dashboard or metrics | observability | LAT-181 |
| Export or aggregate trace data | observability | LAT-181 |

## How to classify a new risky action

When an agent type performs an action not listed above:

1. **Is it destructive, security-sensitive, production-facing, or external communication?** → **human** gate by default.
2. **Does it need an ICP-enforced condition (budget, test pass, config present)?** → **automated** gate.
3. **Is it cheap, reversible, and read-only or low-impact write?** → **none** gate.
4. **Does it create a new durable surface (new dashboard, new alert, new package, new ADR)?** → **human** gate.
5. **Is it a low-risk workspace-only action with no external side effects?** → **none** gate.

If none of these fit cleanly, default to **human**. Over-acting is a worse failure mode than over-asking for actions outside this matrix.

## Sequencing

Hard blockers: none
Recommended predecessors: LAT-180 (forbidden actions), LAT-174 (coding agent contract)
Related context: LAT-21 (invocation/integration boundaries), LAT-6 (approval and cost-control gates), ADR-0008 (four action categories), ADR-0009 (cost bands)
Dispatch status: ready

## Related

- **LAT-21** — Agent invocation and integration boundaries (ADR-0013): the four action categories (P-Direct, P-Propose, ICP-Routed, Stop) that underpin all approval gates.
- **LAT-180** — Forbidden actions: actions that are always Stop regardless of agent type.
- **LAT-174** — Coding agent input/output contract: defines the coding agent's contract shape.
- **LAT-179** — Isolation matrix: defines agent sandboxing boundaries.
- **ADR-0008** — Perplexity / ICP boundary and the four action categories.
- **ADR-0009** — Cost bands and runaway-cost interrupt.
- **ADR-0013** — Agent invocation and integration boundaries.
- **`approval-gates-and-autonomy-rules.md`** — Category-by-category rule matrix with autonomy levels L0–L5.
- **`coding-agent-preflight.md`** — Pre-flight checks that coding agents run before their first file edit.
- **`agent-ready-ticket.md`** — Ticket template carrying the `Approval required before dispatch` field.
- **`agent-run-report.md`** — Run envelope with `approval_required` field.
