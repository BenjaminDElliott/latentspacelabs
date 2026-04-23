---
prd_id: root-agentic-development-flywheel
title: Agentic Development Flywheel (root PRD)
status: approved
owner: Ben Elliott
date: 2026-04-23
related_linear:
  - LAT-23
  - LAT-10
  - LAT-11
  - LAT-12
  - LAT-13
  - LAT-14
  - LAT-16
  - LAT-18
  - LAT-19
  - LAT-20
  - LAT-21
  - LAT-22
  - LAT-25
  - LAT-26
  - LAT-28
  - LAT-29
  - LAT-31
related_adrs:
  - ADR-0001
  - ADR-0002
  - ADR-0003
  - ADR-0004
  - ADR-0005
  - ADR-0006
  - ADR-0007
  - ADR-0008
  - ADR-0009
  - ADR-0010
  - ADR-0011
  - ADR-0012
  - ADR-0013
  - ADR-0014
derived_from:
supersedes:
superseded_by:
---

# PRD: Agentic Development Flywheel (root)

> This is the **root PRD** for the product. Every feature PRD in `docs/prds/` should set `derived_from: [root-agentic-development-flywheel]` and stay within the scope this document defines. If a feature PRD needs to contradict this PRD, it must supersede a section here via an ADR, not simply drift.

## 0. Canonical note — why this document exists

The Agentic Development Flywheel / Integration Control Plane (ICP) was conceived and refined as a conversation thread with Perplexity and a set of shared artifacts, rather than as a durable repo document. Subsystem ADRs (ADR-0001 … ADR-0014) and process docs (`docs/process/`) refer to "the flywheel" and "the ICP" as if a parent PRD exists. Until LAT-31, no such document lived in the repo, and feature PRDs were attempting to descend from an implicit parent.

This PRD canonicalizes that parent. Content here is deliberately a compact statement of the product shape already being built by the ADRs and the `LAT-*` backlog — not a re-invention. Where a decision is already encoded in an ADR, this PRD points to it rather than restating it.

## 1. Problem Statement

A single operator (Ben Elliott, posture: unstructured, high idea throughput, wants external structure and ruthless chief-of-staff pushback) needs an end-to-end development flywheel in which AI coding agents, QA/review agents, and SRE/deploy agents can be dispatched, observed, and governed against a concrete work graph — without a team around them, without each subsystem being hand-wired, and without runaway cost or silent autonomy creep. Existing tools (Perplexity for cognition, Linear for work graph, GitHub for code/docs) each do their piece well but do not by themselves compose into a deterministic dispatch-and-observability layer. The gap is a **minimal, skill-framework-first control plane** that binds them together, plus the durable scope artifacts (PRDs, ADRs, process docs) that keep the loop coherent as agents do most of the typing.

## 2. Goals

1. **Durable work graph.** Every stakeholder-visible product decision is captured as a durable artifact in the repo (PRD / ADR / process doc) or Linear issue, not as a Perplexity-only thread.
2. **Curated pipeline, intake → PR.** Stakeholder input is captured with low friction, triaged into one of {PRD, epic, ticket, ADR, archive, personal}, promoted to agent-ready tickets with sequencing, dispatched to coding agents, and observed through QA, review, deploy, and retro — without requiring hand-assembly per ticket.
3. **Skill-framework-first Integration Control Plane.** The ICP is a small TypeScript/Node package (`packages/icp/`) organized as a skill registry + runner (ADR-0011, ADR-0012), not a monolith. First skill: `dispatch-ticket@0.1.0`.
4. **Deterministic evidence contract.** Every agent run emits a run report (ADR-0006), a five-element Linear write-back (ADR-0003), and, where applicable, QA/review evidence (ADR-0007) — usable by a human reviewer without re-deriving context.
5. **Approval and cost gates enforced at the right layer.** Human approval for project creation, merges, deploys, autonomy-rule changes, external comms, and runaway-cost risk (ADR-0009, `docs/process/approval-gates-and-autonomy-rules.md`). Low-risk Linear issue creation may proceed with refinement.
6. **Observability without premature telemetry.** Visibility into coding agents, PRs, QA, risks, cost flags, and run evidence lands against repo-committed run reports first (ADR-0014); a telemetry backend is a later ADR, not a day-one dependency.
7. **Retrospective learning loop.** Each run (and each cluster of runs) feeds into the retrospective learning loop (ADR-0010, `docs/process/retrospective-learning-loop.md`) so the flywheel improves, not just operates.

## 3. Non-Goals

1. **Not a team-scale platform.** Single operator for the foreseeable future. Multi-tenant auth, RBAC, and shared ops dashboards are out of scope until a second human operator materially shows up.
2. **Not a Perplexity/Linear/GitHub replacement.** Perplexity owns reasoning + intake UX, Linear owns the operational work graph, GitHub owns durable docs/code/ADRs/PRs/runs, ICP owns the operational glue (ADR-0001, ADR-0008). The flywheel composes these; it does not reimplement them.
3. **Not a production observability stack.** No Grafana, no Datadog, no custom tracing backend in the MVP. Run reports live in the repo. A future telemetry ADR may change this.
4. **Not a documentation platform.** Markdown files in this repo are the documentation surface. No generator, no portal, no custom CMS.
5. **Not an autonomous-ops agent.** The flywheel does not self-approve merges, deploys, or autonomy changes. Human gates are load-bearing (see Goal 5).
6. **Not a vendor-evaluation project.** Perplexity + Linear + GitHub are the fixed substrates for the MVP. Replacing them requires a superseding ADR, not a feature PRD.

## 4. Primary Users

1. **Ben Elliott (operator, chief-of-staff-recipient).** Unstructured by self-description; wants the system to push back, enforce structure, and surface risk. Needs low-friction intake from chat/mobile and unambiguous escalation paths. Primary consumer of observability.
2. **Coding / QA / SRE agents.** Programmatic users. Read PRDs, agent-ready tickets, and process docs; write run reports, Linear comments, and PRs. Need every contract (intake, dispatch, evidence, write-back) to be specified in durable artifacts the agents can read.
3. **Future collaborators / stakeholders.** Currently read-only consumers of merged docs and Linear issues. Intake from them happens through the same triage surfaces. First-class, but not primary.

## 5. Operating Model / Workflow

The flywheel is the Perplexity → Linear → repo → ICP loop from ADR-0001 / `docs/process/operating-model.md`:

1. **Intake.** Stakeholder input (Ben, future collaborators, GitHub PR/issue comments, Linear comments, future voice/note) lands via low-friction surfaces (Perplexity as reasoning/intake, mobile-friendly patterns in `docs/process/mobile-intake-ux.md`, GitHub/Linear comments). Asks clarifying questions **only** when triage is ambiguous. See `LAT-29` PRD once landed.
2. **Triage.** Each item routes to exactly one primary destination: PRD / epic / ticket / ADR / archive / personal. `docs/process/intake-triage.md` defines the routing rules. Personal items never cross into Linear without explicit confirmation.
3. **Scoping.** PRDs (this directory) define **what**; ADRs (`docs/decisions/`) define **architectural how**; epics and agent-ready tickets (`docs/templates/agent-ready-ticket.md`) define **work**. Sequencing blocks and ADR-0005 govern ordering.
4. **Dispatch.** The ICP's `dispatch-ticket` skill (ADR-0012, ADR-0013) invokes a coding agent against an agent-ready ticket, producing a run report (ADR-0006) and Linear write-back (ADR-0003).
5. **QA and review.** QA/review agents (ADR-0007) consume run evidence and produce QA reports (`docs/templates/qa-report.md`) and PR-review reports (`docs/templates/pr-review-report.md`). Human approval gates apply at merge, deploy, and autonomy changes.
6. **Deploy.** SRE/deploy agents act within cost and approval gates (ADR-0009). Runaway-cost risk triggers human interrupt.
7. **Retro.** Per-run and cluster retros feed the retrospective learning loop (ADR-0010, `docs/process/retrospective-learning-loop.md`).

**Approval gates** required from the human operator:

- Project creation.
- Merges to protected branches.
- Deploys.
- Autonomy-rule changes.
- External comms.
- Runaway-cost interrupts.

Low-risk Linear issue creation is allowed with agent-side refinement, per `docs/process/approval-gates-and-autonomy-rules.md`.

## 6. Requirements

### 6.1 Intake (must)

- Chat/mobile-friendly, low friction. Short inputs acceptable; no forced structure at intake time.
- Preserves raw input verbatim on durable artifacts; never drops source metadata from GitHub or Linear.
- Captures at minimum: product ideas, architecture notes, bug reports, repo TODOs, meeting notes, personal notes, stakeholder feedback.
- Clarifying questions only when ambiguous for routing; bounded escalation when irreversible or high-risk.
- Separates `personal` from project work; personal → Linear crossing requires explicit confirmation.
- Full contract: `LAT-29` feature PRD (in review).

### 6.2 Triage & routing (must)

- Every intake item receives exactly one primary destination: `prd | epic | ticket | adr | archive | personal`.
- Triage writes to Linear (for project work) or personal store (for personal), and never both without confirmation.
- Routing rules durably documented in `docs/process/intake-triage.md`.

### 6.3 Durable scope artifacts (must)

- PRDs live in `docs/prds/` under the naming policy in that directory's README. Root PRDs use `root-<slug>.md`; feature PRDs use `LAT-NN-<slug>.md`.
- ADRs live in `docs/decisions/` under MADR-style `NNNN-` numbering.
- Process docs live in `docs/process/`.
- Templates (`docs/templates/`) are consumed by both humans and agents. Changes to templates are PRs.

### 6.4 Agent-ready tickets (must)

- Each ticket carries a sequencing block (ADR-0005) naming hard blockers.
- Each ticket carries acceptance criteria observable from the PRD it implements.
- Tickets are dispatchable by the ICP's `dispatch-ticket` skill without re-derivation.

### 6.5 Integration Control Plane (ICP) (must)

- Language and runtime: TypeScript/Node in `packages/icp/` (ADR-0011).
- Architecture: skill framework (contract, registry, runner) over shared components (ADR-0012).
- First skill: `dispatch-ticket@0.1.0`, producing an ADR-0006 run report and ADR-0003 five-element Linear write-back.
- Agent invocation and integration boundaries: per ADR-0013.
- State, persistence, and telemetry: per ADR-0014 (repo-committed run reports for MVP; telemetry backend deferred).

### 6.6 Evidence contract (must)

- Every agent run produces an ADR-0006 run report committed to the repo.
- Every dispatch produces an ADR-0003 five-element Linear write-back.
- QA/review work produces ADR-0007 evidence via the QA and PR-review templates.

### 6.7 Approval & cost gates (must)

- Gates listed in §5 enforced at the ICP / process layer, not on the human's goodwill.
- Runaway-cost interrupts per ADR-0009.

### 6.8 Observability (should)

- Visibility into: currently-running agent runs, open PRs, QA state, flagged risks, cost flags, and evidence links.
- MVP: repo-committed run reports + Linear as the query surface. No custom dashboards.
- Cockpit scope: `LAT-28` feature PRD (in review).

### 6.9 QA harness (should)

- A QA/evaluation substrate that keeps coding-agent output reviewable at single-operator scale.
- Scope: `LAT-26` feature PRD (in review).

### 6.10 Retrospective learning loop (should)

- Per-run and cluster retros using `docs/templates/retro-report.md`.
- Feedback feeds back into process docs and skill updates.

### 6.11 Non-functional (must)

- **Single-operator bias.** Every subsystem must be usable by one person without additional tooling.
- **No premature backend.** Prefer flat files in the repo over services until a service is justified by a specific unanswerable question.
- **Anti-astronautics.** No architecture or PRD is accepted unless it unblocks a real pilot slice, prevents a known risk, or records a decision already being relied on.

## 7. Acceptance Criteria

- [ ] A new agent reading this directory can determine where PRDs, ADRs, and process docs live and how they interrelate without a Perplexity thread.
- [ ] The end-to-end loop (intake → triage → PRD/epic/ticket → dispatch → QA/review → deploy → retro) is traceable through linked durable artifacts in the repo + Linear.
- [ ] The ICP is scoped to `packages/icp/` and uses the skill framework described in ADR-0012 / ADR-0013.
- [ ] Approval gates in §5 are documented in `docs/process/approval-gates-and-autonomy-rules.md` and referenced by the relevant skills.
- [ ] Every feature PRD in `docs/prds/` sets `derived_from: [root-agentic-development-flywheel]` and stays in scope against §3.
- [ ] Observability uses repo-committed run reports as the MVP surface (ADR-0014) with telemetry-backend decisions explicitly deferred.

## 8. Success Metrics

**Product metrics:**

- Time from raw intake to a merged PR implementing it, for representative slices.
- Proportion of intake items that route correctly on first pass (low re-triage rate).
- Presence of ADR-0006 run reports and ADR-0003 Linear write-backs for every agent run.

**Workflow metrics:**

- Cost per agent run (tokens + tool time) inside ADR-0009 budgets.
- Number of human interventions per run (goal: only at defined gates, not for re-derivation).
- Rework rate on agent PRs (goal: decreasing as skills and templates mature).
- Retro-to-improvement cycle time (retro → landed change in a skill or process doc).

## 9. Open Questions

1. **Personal-store destination.** Where `personal` items land is deferred (candidate ADR). Tracked in `LAT-29` PRD.
2. **Voice-stack selection.** Voice/note intake is anticipated but unchosen. Deferred.
3. **Telemetry backend.** ADR-0014 defers the telemetry substrate; a future ADR will name it when repo-committed run reports stop being enough.
4. **PR-review / QA harness shape.** Detailed scope lives in `LAT-26` PRD; some harness questions are still open there.
5. **Multi-repo posture.** The flywheel is single-repo today. If a second repo becomes in-scope (e.g., a separate infra repo), naming and cross-repo dispatch need a new ADR.

## 10. Risks

- **Astronautics risk.** Over-designing the ICP or any subsystem before a concrete pilot slice justifies it. Mitigation: ADR-level anti-astronautics guardrails in `docs/decisions/README.md`.
- **Drift risk.** Durable artifacts falling out of sync with Linear / Perplexity threads. Mitigation: canonical locations (this PRD, ADRs, process docs) are source of truth; Perplexity is ephemeral.
- **Numbering / naming collision under parallel agents.** Observed already with ADR-0006 and PRD `0001-*` drift. Mitigation: ID schemes keyed to Linear issues or stable slugs, not monotonic counters (this PRD's governance, PRD directory README, and ADR directory README).
- **Autonomy creep.** Agent changes quietly expand without explicit approval-gate updates. Mitigation: gates listed in §5 and enforced in `docs/process/approval-gates-and-autonomy-rules.md`; autonomy changes themselves are a gated action.
- **Runaway cost.** An agent loops or self-escalates cost. Mitigation: ADR-0009 interrupts and ICP-side cost metering.
- **Evidence loss.** A run happens without a run report. Mitigation: ADR-0006 envelope is mandatory on every skill invocation; dispatch skill fails the run rather than silently skipping.

## 11. Dependencies

**Hard blockers:**

- `LAT-25` — `packages/icp/` workspace scaffold. Without this, no skill can run.
- ADR-0011, ADR-0012, ADR-0013, ADR-0014 — control plane architectural floor.

**Recommended predecessors:**

- `LAT-29` feature PRD — intake contract landed before intake-shaped skills dispatch.
- `LAT-26` feature PRD — QA harness scope landed before QA skills dispatch against merge gates.
- `LAT-28` feature PRD — observability scope landed before a cockpit-shaped skill is built.
- ADR-0005 — sequencing model for tickets that implement this PRD.

**External:**

- Perplexity (reasoning/intake surface).
- Linear (work graph; team `LAT`).
- GitHub (code, PRs, docs, CI).
- Anthropic Claude (current agent substrate).
- No other third-party services are load-bearing in the MVP.

## 12. Approval & Autonomy

Per ADR-0009 and `docs/process/approval-gates-and-autonomy-rules.md`:

**Requires human approval:**

- Creation of a new top-level project or a second root PRD.
- Merges to protected branches.
- Deploys.
- Changes to autonomy rules or approval-gate lists.
- External communications.
- Runaway-cost interrupts.

**Agent-autonomous (with refinement):**

- Creation of low-risk Linear issues from triaged intake.
- Drafting PRDs, ADRs, and process-doc PRs against this PRD's scope.
- Running the `dispatch-ticket` skill on tickets that already carry approval for their sequencing block.

**Not agent-autonomous (even with refinement):**

- Anything in the approval list above.
- Anything that materially contradicts a section of this PRD without a superseding ADR.

## 13. Definition of Done

This root PRD is "done" when:

- [x] A canonical durable version lives in `docs/prds/root-agentic-development-flywheel.md` on `main`.
- [x] Every currently-drafted feature PRD can set `derived_from: [root-agentic-development-flywheel]` and inherit scope from this document.
- [x] ADRs and process docs that reference "the flywheel" / "the ICP" can link here as the parent document instead of a Perplexity thread.
- [ ] `LAT-23` (canonical root PRD) references this file rather than an unlanded artifact.
- [ ] PR #22 / #23 / #24 feature PRDs are reworked to the new naming and `derived_from` convention before merge.

## 14. Links

- Linear issues: `LAT-23` (this canonicalization), `LAT-31` (governance), `LAT-10` through `LAT-29` (scope backlog).
- Related ADRs: `ADR-0001` … `ADR-0014` in `docs/decisions/`.
- Process docs: `docs/process/operating-model.md`, `docs/process/intake-triage.md`, `docs/process/mobile-intake-ux.md`, `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/cost-controls.md`, `docs/process/qa-review-evidence.md`, `docs/process/retrospective-learning-loop.md`.
- Templates: `docs/templates/prd.md`, `docs/templates/adr.md`, `docs/templates/agent-ready-ticket.md`, `docs/templates/agent-run-report.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`, `docs/templates/retro-report.md`.
- PRD governance: `docs/prds/README.md`.
