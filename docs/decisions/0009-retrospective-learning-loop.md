---
id: ADR-0009
title: Retrospective learning loop
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-11
supersedes:
superseded_by:
revisit_trigger: Revisit when a retro has run against at least two complete pilot cycles, when the telemetry substrate (ADR-0003 open question) lands and changes the evidence surface, or when the rate of promoted changes per retro consistently exceeds the sizing budget in either direction (too few to matter, or too many to review).
---

# ADR-0009: Retrospective learning loop

## Context

The Agentic Development Flywheel MVP is, by design, a feedback loop: raw intake → triage → refinement → dispatch → implementation → QA/review → merge → recorded run. Every step in that chain already produces durable artifacts — run reports (ADR-0006), QA and PR-review reports (ADR-0007), Linear write-backs (ADR-0003), intake classifications (`intake-triage.md`), and dispatch decisions (ADR-0005). The **control boundary** for who executes what lives in ADR-0008 and `approval-gates-and-autonomy-rules.md`.

What the pilot does not yet have is a defined step that turns that accumulated evidence into durable changes to how the system works: prompt and template updates, routing-rule refinements, backlog items, and architecture decisions. LAT-10 stubbed the idea (retro as a first-class classification in `intake-triage.md`), and several ADRs assume retros will happen (ADR-0001's revisit trigger, ADR-0007's open question on false-negative cadence). None of them define the loop.

Two failure modes are likely without an explicit definition:

1. **Evidence rot.** Run reports, QA findings, and Linear write-backs accumulate but never change how we work. The flywheel logs everything and improves nothing.
2. **Silent self-rewriting.** An agent with broad enough autonomy — or a human in a rush — edits prompts, templates, rule matrices, or autonomy levels based on a single data point, without a bounded review step. Governance drifts; nobody is sure why the rules changed.

The non-goal is equally important: we must not build a **continuous self-improvement loop that never terminates.** The retro must be small, slow, bounded, and stop-and-ask on anything that touches governance or autonomy.

## Decision Drivers

- The loop must produce concrete proposed changes, not just observations. An observation with no promotion path is a failure of the loop, not a success of analytics.
- Major autonomy or governance changes must require Ben approval. Agents may draft; agents must not merge governance.
- The loop must be bounded. It has a declared window, a sizing budget, hard stop conditions, and an explicit failure mode catalogue. No self-reflection loops that never terminate.
- Evidence must come from existing surfaces (run reports, QA/review reports, Linear write-backs, triage outputs). Retro does not re-derive or replace them.
- Repeated agent failure patterns must trigger improvement work automatically. Silently dropping a detected pattern is the single highest-impact failure mode.
- The loop's own operational rules (cadence, questions, promotion paths, stop conditions) are themselves governed by this ADR and the paired process doc — not by the retro itself.
- Anti-astronautics guardrail (`docs/decisions/README.md`): no new architecture unless it unblocks the next pilot slice, prevents a known risk, or codifies a decision already relied on. This ADR codifies the retro step several other ADRs already assume will exist.

## Considered Options

1. **Do nothing; rely on ad-hoc reflection.** Rejected: evidence accumulates but never compounds into durable change, and there is no mechanism to catch repeated failure patterns. Every prior ADR assumes some form of retro; leaving it undefined is the drift it was meant to prevent.
2. **Continuous feedback loop: any agent may propose prompt/template/routing edits from any run.** Rejected: directly collides with the ADR-0008 rule matrix (governance changes are Stop-category) and produces the "self-reflection loops that never terminate" non-goal from LAT-11. Also encourages promotion of weak single-run signals.
3. **Define a small, slow, bounded retro loop with six fixed questions, four promotion paths, explicit cadence, hard stop conditions for autonomy/governance changes, and Ben approval on any governance-level promotion.** Accepted.
4. **Wait for the telemetry substrate before defining the loop.** Rejected: the loop's inputs already exist in the evidence surfaces listed above. Waiting would let evidence rot accumulate during the exact window the pilot is meant to validate the flywheel.

## Decision

**Accepted: Option 3.** A retrospective learning loop exists as a bounded, cadenced step in the flywheel, defined by this ADR and operationalized in `docs/process/retrospective-learning-loop.md` and `docs/templates/retro-report.md`.

### The loop, at a glance

- **Inputs:** run reports (ADR-0006), QA/review reports (ADR-0007), Linear write-backs (ADR-0003), intake triage outputs (`intake-triage.md`), dispatch decisions (ADR-0005), docs-vs-skills drift flags (ADR-0004), approval-gate/ACL routing decisions (ADR-0008).
- **Activity:** a bounded review against the six retrospective questions below, across a declared pilot-cycle window.
- **Outputs:** concrete promotions along exactly one of four paths (prompt/template update, backlog item, ADR candidate, archived note).
- **Cadence:** one retro per closed pilot cycle; at minimum monthly; at most one retro in-flight per surface (prompts, templates, routing rules, backlog).
- **Stop conditions:** governance/autonomy changes → Ben approval; retro cost elevation → stop-and-ask; edits to the retro loop itself → Ben approval via normal doc/ADR PR path.

### The six retrospective questions

Every retro answers these, in order. "Not applicable" is a valid answer with a one-line reason; silence is not.

1. Did we build the right thing?
2. Were tickets well-scoped?
3. Where did agents struggle?
4. Were acceptance criteria sufficient?
5. What did QA and review catch?
6. Were costs reasonable?

Full definitions are in `retrospective-learning-loop.md`. These questions are fixed at the ADR level to prevent gradual expansion of scope by the retro itself.

### The four promotion paths

Each finding is routed to exactly one path:

| Path | Owner of the change | Approval |
|---|---|---|
| Prompt / template update | Retro drafts PR | Ben merges (normal doc-merge rule) |
| Backlog item (`LAT-*` issue) | Retro via intake-triage | Per intake-triage defaults |
| Architecture decision candidate (ADR draft) | Retro drafts in `docs/decisions/` as `proposed` | Ben merges per ADR lifecycle |
| Archived note | Retro records in retro report only | No approval needed |

**Default when in doubt: archive.** A weak signal earns promotion by repeating across retros, not by being written persuasively in one.

### Hard stop conditions

The retro **must** halt and escalate (not iterate) when any of the following apply:

- A proposed change edits `approval-gates-and-autonomy-rules.md`, ADR-0008, any other rule-matrix surface, or raises an autonomy level.
- A proposed change would modify this ADR, `retrospective-learning-loop.md`, the retro's cadence, the six questions, the four promotion paths, the stop conditions, or the retro template.
- The retro's own cost band is `elevated` or `runaway_risk`.
- More than one retro targets the same surface concurrently.

These stop conditions are consistent with the Stop-category rows already in `approval-gates-and-autonomy-rules.md` ("Change approval gates or autonomy rules" and "Raise an autonomy level beyond the pilot default"). This ADR adds retro-scoped reinforcement; it does not create a new approval gate.

### Repeated failure detection

A repeated failure pattern is defined in `retrospective-learning-loop.md` (same error shape / `needs_human` reason / QA or review finding category / cost escalation across ≥ 2 runs in window or ≥ 3 across recent retros). When detected, the retro **must** produce improvement work (prompt/template PR, backlog item, or ADR candidate) or an archived-with-rationale entry. A detected pattern that is silently dropped is a retro failure and itself a finding on the next retro.

This satisfies the acceptance criterion that repeated agent failure patterns generate improvement work.

### Cadence

- Default: one retro per closed pilot cycle.
- Minimum: monthly review of agent-created Linear work, even if no cycle closed.
- Maximum concurrency: one retro per surface (prompts, templates, routing rules, backlog).
- Size budget per retro: a small number of promotions across the four paths combined; the rest go to archive for the next retro.

"Pilot cycle" is defined operationally in the process doc as an agreed window (shipped issues, calendar window, or declared milestone). The ADR deliberately does not fix the window length; cadence is a revisit trigger for this ADR once retros have actually run.

### Review of agent-created Linear work

Every retro explicitly reviews the `LAT-*` issues created by agents during the window — classification, labels, acceptance criteria quality, and whether dispatch happened. This is the counterweight to agents quietly accumulating work for themselves and satisfies LAT-11's scope item on cadence for agent-created Linear work.

## Consequences

Good:

- Evidence produced by the rest of the flywheel now has a canonical downstream consumer. No more evidence rot.
- Repeated agent failure patterns produce durable improvement work; recurring problems earn prompt/template/adapter fixes, not per-ticket band-aids.
- Governance and autonomy rules remain human-approved. The retro cannot silently rewrite the rule matrix, raise an autonomy level, or redefine its own loop.
- The four promotion paths make learning explicit and reviewable. No "we should maybe" lists that never land.
- The ADR and its process doc together give any future agent (or human) a concrete procedure to run a retro without re-deriving the contract from scratch.

Bad / open:

- The loop adds a recurring work item to Ben's approval surface (retro report merges, ADR-candidate merges from retros, prompt/template PRs from retros). Mitigated by the sizing budget and archive-default rule, but the cost is real.
- The "repeated failure pattern" definition is thresholded (≥ 2 runs / ≥ 3 across retros). Threshold is deliberate for the pilot; it will probably need tuning once we have enough retro data to know whether it under- or over-detects.
- Retros depend on the existing evidence surfaces being well-populated. If run reports or QA/review reports are sparse, the retro inherits that sparseness. The fix is to improve the upstream surface (ADR-0006, ADR-0007), not to loosen the retro's standards.
- "Pilot cycle" is not fixed-length by this ADR. Until the cadence settles, "what counts as a cycle" is itself a per-retro declaration. Listed explicitly so it does not become an assumed invariant.

## Open Questions

1. **Pilot cycle length.** Leaving this to operational experience, but it should probably land inside three retros. Revisit trigger: cadence consistency is a condition of this ADR's revisit.
2. **Retro agent shape.** Whether a single retro agent owns the full loop, or whether subagents per question are preferable. Pilot default: single retro agent. Revisit if question-level parallelism turns out to matter.
3. **Archive search.** Archived observations are easy to write and hard to rediscover. A follow-up may add a lightweight index of archived observations; leaving unbuilt for now.
4. **Interaction with the future telemetry substrate (ADR-0003 open questions).** Once that substrate exists, some retro inputs will shift from repo-committed Markdown to the substrate. The retro process doc already references the evidence surfaces by ADR, so the migration path is through those ADRs.

## Confirmation

Working if, after two completed pilot cycles:

- Each closed cycle produced a retro report and at least one concrete promotion along one of the four paths.
- At least one repeated failure pattern was detected and routed to improvement work (backlog or ADR) rather than archived.
- No retro produced a governance or autonomy change without Ben approval.
- No retro produced more promotions than the sizing budget allows, or none at all.
- The six retrospective questions did not grow, shrink, or mutate without an ADR superseding this one.
- Agent-created `LAT-*` issues from the window were explicitly reviewed in each retro.

## Links

- Linear: `LAT-11` (this ADR); related `LAT-5` (run visibility), `LAT-8` (QA/review evidence), `LAT-10` (operating model / intake), `LAT-14` (docs vs skills), `LAT-16`/`LAT-6` (control boundary / autonomy dial).
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0004-process-docs-vs-agent-skills.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md`.
- Process: `docs/process/retrospective-learning-loop.md`, `docs/process/operating-model.md`, `docs/process/intake-triage.md`, `docs/process/qa-review-evidence.md`, `docs/process/approval-gates-and-autonomy-rules.md`.
- Templates: `docs/templates/retro-report.md`, `docs/templates/agent-run-report.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`, `docs/templates/agent-ready-ticket.md`.
