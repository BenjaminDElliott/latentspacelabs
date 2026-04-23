---
id: ADR-0006
title: Agent Control Layer and Perplexity boundary
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-16
  - LAT-6
supersedes:
superseded_by:
revisit_trigger: Revisit when Perplexity's connectors expose first-class create/read for Linear native relations and reliable dispatch semantics; when the first owned adapter ships; or when a Perplexity-direct action causes a production incident.
---

# ADR-0006: Agent Control Layer and Perplexity boundary

## Context

ADR-0001 chose Perplexity as the intake, reasoning, and control interface; Linear as the durable work graph; GitHub as the durable source of truth. ADR-0003 bounded what Linear stores. ADR-0005 defined the dispatch-readiness model and explicitly noted that the Linear connector currently exposed to Perplexity does not reliably expose first-class native-relation create/read for dispatch.

As the pilot has exercised Perplexity end-to-end, a pattern has emerged: **Perplexity's connectors are useful as convenience tools for read-heavy intake, triage, and drafting, but are not reliable as the long-term operational substrate when first-class APIs, native relations, deterministic dispatch semantics, or structured telemetry are required.** Perplexity is excellent at cognition — ruthless triage, draft generation, synthesis across threads. It is weaker at the parts of the workflow that must be deterministic, auditable, and repeatable: reading/writing Linear native relations, selecting the next dispatchable issue, starting coding or QA agents, opening PRs with the correct conventions, recording high-fidelity run reports, and enforcing cost/autonomy gates.

Without an explicit boundary, two failure modes are likely:

1. **Silent capability drift.** Perplexity gains or loses connector features unpredictably. Processes built on those features silently break (e.g. an agent that depended on reading `blocks` relations stops working when the connector changes shape).
2. **Astronautics creep.** We build a full agent orchestrator before the workflow needs it.

We need to name, now, what belongs on Perplexity's side of the line and what belongs on an **owned Agent Control Layer (ACL)** — even if the ACL is, for the pilot, *just a thin collection of deterministic skills and adapters rather than a standalone service*.

## Decision Drivers

- Perplexity is the cognitive front door; it must not also be the operational substrate for actions that require determinism, auditability, or relation-level Linear semantics.
- First-class Linear features (native relations, projects, dispatch queries) must be reachable through an owned adapter that we can evolve independently of Perplexity's connector roadmap.
- The pilot must not block on building a full orchestrator. The ACL can start as a set of deterministic skills / adapters in this repo, not a service.
- Every action with blast radius beyond the current workspace needs a defined autonomy level and a failure posture.
- Approval gates must be legible to both humans and agents without reading prose — they need a rule matrix.
- Runaway cost is always a stop-and-ask event, independent of product risk (ADR-0001, intake-triage.md).
- Anti-astronautics guardrail (see `docs/decisions/README.md`): no new architecture unless it unblocks the next pilot slice, prevents a known risk, or codifies a decision already relied on.

## Considered Options

1. **Perplexity-only: let Perplexity invoke everything directly via whatever connectors it has.** Rejected: unbounded blast radius, silent capability drift, no deterministic dispatch, no auditable run record.
2. **Build a full Agent Control Layer service now** (orchestrator, worker queue, telemetry store, UI). Rejected: premature; violates the anti-astronautics guardrail; nothing in the pilot justifies it yet.
3. **Define an explicit boundary, implement the ACL as deterministic skills/adapters in this repo, and route any action that needs first-class APIs or deterministic semantics through the ACL. Perplexity keeps cognition (triage, drafting, read-heavy analysis) and the cheapest reversible Linear writes.** Accepted.
4. **Forbid Perplexity from all write actions; require a human to mirror every decision.** Rejected: destroys the flywheel; the whole point of Perplexity is low-friction intake and triage.

## Decision

**Accepted: Option 3. Perplexity is the cognitive front door; an owned Agent Control Layer is the operational substrate for anything that requires first-class APIs, native-relation semantics, dispatch determinism, or high-fidelity telemetry.**

### What the Agent Control Layer is (for the pilot)

- A set of **deterministic skills and adapters**, committed to this repo, that encode exactly how we talk to Linear, GitHub, agent runners, and (later) the telemetry substrate.
- Not a standalone service. Not a UI. No worker queue. No orchestrator binary.
- Owns the canonical Linear adapter path when native-relation or project-creation semantics matter.
- Owns agent dispatch decisions (per ADR-0005) and records the decision in the run report and the Linear write-back.
- Owns the PR convention enforcement (per operating-model.md PR ↔ Linear linking).
- Owns the cost-band check before any action that has non-trivial spend risk.
- May be invoked by Perplexity (as a skill call) or by a human directly, but the rule matrix is the same in either case.

The ACL can grow into a service later — when a real need forces it (e.g. a shared queue, cross-run coordination, or a telemetry ingest). Until then, it's skills and adapters only.

### The four action categories

Every action an agent (or Perplexity) might take falls into exactly one of four categories. The full rule matrix lives in `docs/process/approval-gates-and-autonomy-rules.md`; this ADR names the categories.

1. **Perplexity-direct (P-Direct).** Cheap, reversible, cognitive, or read-heavy actions where connector drift is tolerable. Perplexity invokes the connector directly.
2. **Perplexity-propose, human-approve (P-Propose).** Perplexity drafts the action or artifact but must not execute it without explicit human confirmation in-thread.
3. **Agent Control Layer (ACL-Routed).** Anything that needs first-class API semantics, Linear native relations, deterministic dispatch, or a recorded run. Perplexity may trigger, but the action executes through the owned ACL skill/adapter.
4. **Forbidden / stop-and-ask (Stop).** Always halts. Includes high-risk, destructive, security-sensitive, or runaway-cost actions. No autonomy level above L0 touches these without an explicit human instruction.

### Autonomy levels (pilot)

- **L0 — Observe / draft only.** Perplexity reads and drafts. No external writes.
- **L1 — Reversible workspace/docs draft.** Perplexity may write drafts in its own workspace, propose PR changes, or generate ticket/ADR drafts.
- **L2 — Bounded Linear/GitHub write-backs.** Perplexity may create/update Linear issues and add comments, and may open PRs that follow the PR ↔ Linear linking convention. Project creation and native-relation writes are NOT in L2.
- **L3 — Agent dispatch with human approval.** The ACL selects a dispatchable `LAT-*` issue (per ADR-0005) and starts a coding/QA/review agent only after a human says go.
- **L4 — Autonomous implementation with review gates.** An agent may execute a dispatched ticket end-to-end, open the PR, and request review. Merge still requires human approval.
- **L5 — Autonomous merge/deploy.** **Out of scope for the pilot.** Explicitly not accepted. Will require a separate ADR.

The pilot default is **L2 for Perplexity, L3-with-approval for ACL-dispatched agents**. Raising a level requires explicit approval and, for L4+, an ADR.

### Failure posture by severity

Independent of category:

- **Low / reversible.** Proceed and flag. Leave a breadcrumb for review.
- **Medium.** Take the safest reversible action; ask if uncertain. Do not persist irreversible artifacts.
- **High / security / data-loss / destructive.** **Stop and ask.** Do not act.
- **Runaway-cost.** **Always stop and ask.** No autonomy level overrides this.

Severity classification follows `docs/process/intake-triage.md`.

### Key placements (see the process doc for the full matrix)

- **Creating Linear issues** → P-Direct at L2 (cheap, reversible).
- **Updating Linear issue descriptions / adding write-back comments** → P-Direct at L2.
- **Creating Linear projects** → **P-Propose.** Perplexity drafts, Ben approves (ADR-0003).
- **Reading Linear dependency/sequencing state (`## Sequencing` block)** → P-Direct for humans-in-the-loop reading; **ACL-Routed** for dispatch decisions.
- **Creating/reading native Linear issue relations** → **ACL-Routed.** Perplexity connector is unreliable here (ADR-0005).
- **Selecting next dispatchable issue** → **ACL-Routed.** Must execute the ADR-0005 dispatch algorithm.
- **Starting coding agents** → **ACL-Routed, L3-with-approval.**
- **Starting QA/review agents** → **ACL-Routed, L3-with-approval.**
- **Opening PRs** → ACL-Routed (to enforce PR ↔ Linear linking); L2 when a human is driving, L4 when an ACL-dispatched agent is implementing.
- **Merging PRs** → **Stop.** Human only during the pilot.
- **Deploying** → **Stop.** Human only during the pilot.
- **Updating docs/ADRs/templates** → P-Propose (draft) → L2 (open PR) → Stop at merge.
- **Changing approval/autonomy rules (i.e. editing this ADR or the process doc)** → **Stop.** Human decision; requires an ADR.
- **Recording agent runs** → **ACL-Routed.** Run report generation and Linear write-back contract enforcement belong to the ACL.
- **Writing high-fidelity telemetry/traces** → **ACL-Routed** (into the future telemetry substrate per ADR-0003; repo-committed run report until the substrate exists).
- **Sending external communications / posts** (Slack, email, public messages) → **Stop** by default. Opt-in per channel via an explicit ADR or rule change.
- **Spending money / runaway-cost situations** → **Stop.** Always. No exceptions.

## Consequences

Good:

- Perplexity stays focused on what it is genuinely best at: cognition, triage, drafting.
- Operational correctness (dispatch decisions, native-relation reads/writes, run recording, cost gates) lives in code we own and can evolve without waiting on Perplexity's connector roadmap.
- The rule matrix is explicit enough for a future agent to use without re-deriving policy from prose.
- No orchestrator is built before it's needed; ACL starts as skills/adapters and grows only when forced.
- Autonomy progression is a dial, not a cliff; raising a level is a visible, ADR-level event.

Bad / open:

- Two surfaces for "where does this action live" add a tiny decision cost per new capability. Mitigated by the rule matrix in the process doc.
- Until the ACL adapters actually exist as code, ACL-Routed items are policy, not enforcement. Early runs rely on discipline.
- The boundary will shift as Perplexity's connectors improve. Expect at least one follow-up ADR when native Linear relations become first-class through the connector.
- "ACL is just skills and adapters" is a deliberate under-investment. If cross-run coordination, a queue, or shared state becomes necessary, we will need to revisit; this ADR does not pre-decide that move.

## Open Questions

1. Where exactly the ACL skills/adapters live in the repo (likely `skills/` and a future `adapters/` directory; ties into the ADR-0004 docs-vs-skills split).
2. Which native Linear relations we implement first when we build the owned adapter (likely `blocks` / `blocked by`, to satisfy ADR-0005 dispatch and demote the `## Sequencing` block to a mirror).
3. Whether L3 approval can be batched (e.g. "approve the next three L3 dispatches") or must be per-action — leaning per-action during pilot.
4. Cost-band semantics: currently qualitative (`elevated`) per ADR-0003. A follow-up ADR under telemetry substrate work should make this quantitative.

## Confirmation

Working if, three months in:

- No Perplexity-direct action has touched a Stop-category item without a human in the loop.
- No agent dispatch decision has relied on a connector path that silently broke; dispatch goes through the ACL adapter.
- The rule matrix in the process doc is the reference both humans and agents cite when in doubt, not individual prior incidents.
- When a new capability is proposed, placing it in the matrix is a short conversation, not a re-derivation of the boundary.
- Raising an autonomy level has happened at most once, and was an explicit, approved event.

## Links

- Linear: `LAT-16` (this ADR), `LAT-6` (autonomy dial / operating posture).
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0004-process-docs-vs-agent-skills.md`, `0005-linear-dependency-and-sequencing-model.md`.
- Process: `docs/process/approval-gates-and-autonomy-rules.md` (full rule matrix), `docs/process/operating-model.md`, `docs/process/intake-triage.md`.
