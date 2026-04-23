---
prd_id: LAT-26-agent-evaluation-and-qa-harness
title: Agent evaluation and QA harness
status: draft
owner: Ben Elliott
date: 2026-04-23
related_linear:
  - LAT-26
related_adrs:
  - ADR-0005
  - ADR-0006
  - ADR-0007
  - ADR-0008
  - ADR-0009
  - ADR-0010
  - ADR-0013
derived_from:
  - root-agentic-development-flywheel
supersedes:
superseded_by:
---

# PRD: Agent evaluation and QA harness

> Product requirements for how the pilot evaluates agent outputs, collects QA evidence, scores ticket readiness before dispatch, and turns repeated failure patterns into durable improvement work. Implementation, schema, and tooling choices belong in follow-up ADRs and tickets — not here.

- **Owner:** Ben Elliott
- **Status:** draft
- **Related Linear:** LAT-26
- **Related ADRs:** [ADR-0005](../decisions/0005-linear-dependency-and-sequencing-model.md), [ADR-0006](../decisions/0006-agent-run-visibility-schema.md), [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md), [ADR-0008](../decisions/0008-agent-control-layer-and-perplexity-boundary.md), [ADR-0009](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md), [ADR-0010](../decisions/0010-retrospective-learning-loop.md), [ADR-0013](../decisions/0013-agent-invocation-and-integration-boundaries.md)

## 1. Problem Statement

The Agentic Development Flywheel pilot can already dispatch coding, QA, PR-review, and SRE agents and capture compact evidence per run ([ADR-0006](../decisions/0006-agent-run-visibility-schema.md), [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md)), but it has no shared definition of *what "good" looks like* for each agent type, what minimum evidence every run must produce, or how a ticket's readiness is scored before it is dispatched. Without those, the retro loop ([ADR-0010](../decisions/0010-retrospective-learning-loop.md)) reads inconsistent evidence, rubber-stamped approvals and severity inflation go uncaught, and low-quality tickets are dispatched and then bounced — burning budget on work that should have been refused up front. This PRD defines those evaluation dimensions, the QA-evidence floor, and the readiness check so downstream improvement work compounds instead of accumulating as evidence rot.

## 2. Goals

1. **Evaluation dimensions per agent type.** Define the observable dimensions along which coding, QA, PR-review, and SRE agent runs are judged, such that two reviewers (human or agent) reading the same run report reach the same recommendation under the [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) severity ladder.
2. **Minimum QA evidence floor per run.** State the smallest evidence set a code-producing agent run must produce for its recommendation to be considered; runs below the floor are `needs-human` by default.
3. **Readiness score for tickets before dispatch.** Define a readiness check that consumes the existing agent-ready pre-flight ([template](../templates/agent-ready-ticket.md)) and refuses or routes to refinement tickets that fall below threshold, rather than dispatching and failing.
4. **Failure-pattern → improvement-work link.** Specify which repeated failure patterns create improvement work automatically via the retro loop ([ADR-0010](../decisions/0010-retrospective-learning-loop.md)) and which are archived, so the system gets better at the classes of mistake it actually makes.
5. **Feed the retro loop, not replace it.** Evaluation outputs flow into the retro's six questions and four promotion paths — no parallel learning loop, no new governance surface.
6. **Keep QA agents advisory.** Agents recommend; Ben approves merge and deploy. This PRD does not introduce merge authority for any agent.

## 3. Non-Goals

1. **No full benchmark suite.** This PRD does not propose a held-out eval set, golden tasks, or regression leaderboards for agents. That is a later project once the pilot has produced enough runs to sample from.
2. **No automated eval gate before first-dispatch skill.** The readiness check is advisory/refusal-capable, not an automated quality scoring pipeline that blocks dispatch without human review. Gate hardening is explicitly deferred.
3. **No merge authority for QA or review agents.** Recommendation values remain advisory per [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md); Ben remains the approver for merge and deploy.
4. **No new telemetry substrate.** Evaluation and evidence continue to live in the run report ([template](../templates/agent-run-report.md)), QA report ([template](../templates/qa-report.md)), and PR-review report ([template](../templates/pr-review-report.md)) until the substrate ADR lands (see [ADR-0006](../decisions/0006-agent-run-visibility-schema.md) open questions).
5. **No rewrite of the retro loop or severity ladder.** This PRD consumes [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) and [ADR-0010](../decisions/0010-retrospective-learning-loop.md); it does not redefine them.
6. **No cross-agent scoring or A/B harness.** Comparing agent configurations against each other is out of scope; this PRD is about per-run evaluation and per-ticket readiness.
7. **No new autonomy level.** Readiness checks and failure-pattern improvements do not raise any agent's autonomy beyond current pilot defaults ([ADR-0008](../decisions/0008-agent-control-layer-and-perplexity-boundary.md), [approval-gates-and-autonomy-rules](../process/approval-gates-and-autonomy-rules.md)).

## 4. Primary Users

1. **Ben (approver / product judgment).** Reads evaluation and readiness outputs to decide merge, deploy, and whether a ticket should be dispatched at all. Needs scannable, consistent signal.
2. **Dispatcher (agent or human).** Runs the readiness check before starting a coding agent; refuses or returns to refinement when the ticket fails.
3. **Coding, QA, PR-review, and SRE agents.** Consume their type's evaluation dimensions as part of their run prompt/skill so their evidence matches what reviewers will grade against.
4. **Retro agent.** Consumes per-run evaluation outputs and repeated failure patterns to produce promotions along the four paths in [ADR-0010](../decisions/0010-retrospective-learning-loop.md).
5. **Future intake/refinement agent.** Reads the readiness score to decide whether a ticket needs more refinement before it can be marked `agent-ready`.

## 5. Operating Model / Workflow

The harness sits on top of existing surfaces rather than replacing them:

- **Before dispatch.** The dispatcher runs the readiness check ([ADR-0005](../decisions/0005-linear-dependency-and-sequencing-model.md) sequencing + agent-ready pre-flight). A low-readiness ticket is refused with a structured reason and routed back to `needs-refinement`. Governance-touching dispatch still follows the [approval-gates-and-autonomy-rules](../process/approval-gates-and-autonomy-rules.md) matrix and [ADR-0013](../decisions/0013-agent-invocation-and-integration-boundaries.md) boundaries.
- **During a run.** The agent's prompt/skill references its evaluation dimensions so the run produces the evidence that will later be graded. Invocation and integration boundaries remain as defined by [ADR-0013](../decisions/0013-agent-invocation-and-integration-boundaries.md).
- **At run close.** Code-producing runs emit QA and PR-review reports per [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) with evaluation and recommendation values populated. The Linear write-back remains the bounded five-element shape from [ADR-0003](../decisions/0003-linear-persistence-boundary.md).
- **Cost interaction.** Evaluation runs respect cost bands ([ADR-0009](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md), [cost-controls](../process/cost-controls.md)); readiness-check runs are themselves subject to the runaway-cost interrupt.
- **Feeding retro.** Recurring low evaluation scores, recurring `needs-human` recommendations, and recurring readiness refusals are the raw signal the retro's question 3 ("where did agents struggle?") and question 5 ("what did QA and review catch?") read. The retro decides promotion; this PRD does not.

No new approval gate is created. Merge and deploy stay with Ben. Merge and deploy remain Ben-approved per the [operating model](../process/operating-model.md).

## 6. Requirements

### 6.1 Evaluation dimensions (must)

Define evaluation dimensions per agent type. Each dimension must be observable from the existing evidence (run report, QA report, PR-review report, PR diff, Linear issue), not from subjective narration.

- **Coding agent.** Dimensions must cover at minimum: acceptance-criterion coverage, scope discipline (did the diff stay inside the ticket's In/Out of scope), test adequacy relative to the ticket's `Tests` section, constraint respect (security, secrets, migrations, public APIs), run-report completeness ([ADR-0006](../decisions/0006-agent-run-visibility-schema.md)), and cost-band honesty ([ADR-0009](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md)).
- **QA agent.** Dimensions must cover at minimum: acceptance-criterion verification (one-line citation per criterion per [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md)), test-result faithfulness, regressions-considered quality, severity-label discipline (matches [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) ladder), and recommendation-consistency (does the recommendation follow the ladder rules given the findings).
- **PR-review agent.** Dimensions must cover at minimum: architecture and security coverage, finding specificity (file:line citations, not vibes), severity-ladder discipline, severity-splitting / inflation detection, and unmet-criteria-as-nits detection (see [qa-review-evidence](../process/qa-review-evidence.md) failure modes).
- **SRE agent.** Dimensions must cover at minimum: change blast-radius assessment, rollback/reversal plan quality, cost-band and runaway-risk assessment per [ADR-0009](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md), and on-call/paging impact statement.

Each agent type's dimensions must be small in number — enough to discriminate good from bad runs, not an exhaustive rubric that pushes report length past "scannable on a phone" ([ADR-0003](../decisions/0003-linear-persistence-boundary.md) shape guideline).

### 6.2 Minimum QA evidence floor (must)

Every code-producing agent run must produce at minimum the evidence already required by [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) ([qa-review-evidence](../process/qa-review-evidence.md) — acceptance verification, test results, files changed, risks, regressions considered, security/architecture concerns, findings with severity, final recommendation). This PRD adds that:

- **Evaluation fields populated.** The run's QA and PR-review reports must populate an explicit evaluation section per 6.1's dimensions. An empty evaluation section with a non-`needs-human` recommendation is itself a finding.
- **Recommendation must match the ladder rules.** [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) rules (`high`/`critical` ⇒ no `approve` variant, etc.) remain authoritative; this PRD requires the recommendation and findings to be internally consistent within the report, checkable by a reviewer in one pass.
- **No rubber-stamp.** A non-trivial PR with zero findings and `approve` is a `low` finding on the agent per [qa-review-evidence](../process/qa-review-evidence.md). This PRD reinforces that rule; it does not relax it.
- **Below-floor fallback.** A run missing any of the above evidence defaults its recommendation to `needs-human`. Merging a below-floor run without Ben approval is a `critical` finding on the next dispatch.

### 6.3 Readiness check before dispatch (must)

Before a coding agent is dispatched, a readiness check runs against the ticket and produces one of: `ready`, `caution`, or `refuse`.

- `ready`: all [agent-ready pre-flight checks](../templates/agent-ready-ticket.md) pass and the `## Sequencing` block resolves per [ADR-0005](../decisions/0005-linear-dependency-and-sequencing-model.md).
- `caution`: pre-flight passes but one or more quality signals are weak (e.g. acceptance criteria testable-but-thin, budget cap present but clearly under-estimated, Out of scope present but trivial). `caution` dispatches are allowed but surface the weakness to Ben in the dispatch evidence.
- `refuse`: one or more pre-flight checks fail, or sequencing declares an unresolved hard blocker. A `refuse` ticket is returned to `needs-refinement` with the refusal shape from [agent-ready-ticket](../templates/agent-ready-ticket.md) ("Pre-flight: REFUSED"). The dispatcher must not silently round up.

The readiness check is advisory to the dispatcher during the pilot; it is not an automated quality gate. It is allowed to refuse dispatch based on pre-flight failure (which is already policy) but must not raise autonomy or override a Ben-level approval gate.

### 6.4 Failure-pattern → improvement-work link (must)

Repeated failure patterns observed via evaluation feed the retro ([ADR-0010](../decisions/0010-retrospective-learning-loop.md)) and must surface as promotions per its four paths. This PRD adds:

- **Evaluation-sourced patterns count.** Recurring low scores on a specific evaluation dimension (≥ 2 runs in window or ≥ 3 across recent retros, matching [retrospective-learning-loop](../process/retrospective-learning-loop.md)) qualify as a repeated failure pattern.
- **Repeated readiness refusals on the same refinement gap** qualify as a repeated failure pattern at the intake/refinement surface and must route to prompt/template update or ADR candidate per [ADR-0010](../decisions/0010-retrospective-learning-loop.md).
- **Silent drop = retro failure.** A detected pattern with no promotion and no archived-with-rationale entry is itself a finding on the next retro. This is reinforced, not introduced, by this PRD.

### 6.5 Feeding the retro loop (must)

- Evaluation outputs are **inputs** to the retro's six questions, not a parallel loop.
- The retro remains the only place that promotes to prompt/template updates, backlog items, ADR candidates, or archived notes.
- No new cadence is introduced; retros run per [ADR-0010](../decisions/0010-retrospective-learning-loop.md).
- Hard stop conditions from [ADR-0010](../decisions/0010-retrospective-learning-loop.md) (governance/autonomy edits, self-rewriting of the retro loop, cost-band elevation) apply unchanged.

### 6.6 Non-functional (should)

- **Scannable.** Evaluation sections must fit the [ADR-0003](../decisions/0003-linear-persistence-boundary.md) "scannable on a phone once" shape when surfaced in Linear write-back. Full detail lives in the repo-committed reports.
- **Diff-able.** Evaluation dimensions live in the report templates so changes are PR-reviewable, not hidden in skill files alone (see [ADR-0004](../decisions/0004-process-docs-vs-agent-skills.md) docs-vs-skills boundary).
- **Stable vocabulary.** Reuse existing recommendation values, severity ladder, and cost bands. Do not invent new ones.

## 7. Acceptance Criteria

- [ ] Evaluation dimensions are defined per agent type (coding, QA, PR-review, SRE) in repo-committed docs or templates, each dimension observable from existing evidence.
- [ ] Minimum QA evidence floor is specified and enforced by the QA and PR-review report templates such that a below-floor run defaults to `needs-human`.
- [ ] Readiness check produces one of `ready | caution | refuse` for every dispatchable ticket, using the existing [agent-ready pre-flight](../templates/agent-ready-ticket.md) and [ADR-0005](../decisions/0005-linear-dependency-and-sequencing-model.md) sequencing as inputs.
- [ ] Low-quality ticket inputs are either refused outright or returned to refinement with a structured reason; the dispatcher does not silently round up.
- [ ] Every code-producing agent run writes a recommendation value (`approve` / `approve-with-nits` / `request-changes` / `block-merge` / `needs-human`) consistent with the [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) ladder rules.
- [ ] Repeated failure patterns (≥ 2 in window / ≥ 3 across retros) sourced from evaluation dimensions generate improvement work via the retro's four promotion paths, or are archived-with-rationale; silent drops are themselves findings on the next retro.
- [ ] No agent gains merge authority as a result of this PRD; merge and deploy remain Ben-approved.
- [ ] All evaluation and readiness outputs flow into the retro loop ([ADR-0010](../decisions/0010-retrospective-learning-loop.md)) without creating a parallel learning loop.

## 8. Success Metrics

**Product metrics.**

- Share of code-producing runs whose recommendation is internally consistent with the ladder rules (target: trending up; silent inconsistencies trending down).
- Share of dispatched tickets that pass pre-flight cleanly vs. return-to-refinement rate (both should be measurable; refusal is a success, not a failure).
- Repeated-failure-pattern detection rate: at least one detected-and-promoted pattern per closed pilot cycle, matching [ADR-0010](../decisions/0010-retrospective-learning-loop.md) confirmation criteria.

**Workflow metrics.**

- Rework rate (PRs requiring a second coding-agent pass after QA/review) — expected to drop as evaluation tightens ticket scoping.
- Cost per code-producing run including its QA/review tail (tracked via [ADR-0009](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md) cost bands; should not elevate as a side effect of this PRD).
- Number of Ben interventions required to catch rubber-stamp `approve` (should trend to zero; any non-zero is itself a retro finding).
- Time from dispatch to merged PR should not regress; if readiness refusals shift time earlier in the funnel, that is a success, not a regression.

Absolute numeric targets are deliberately not set in this PRD; they are a revisit item once the first two retros under [ADR-0010](../decisions/0010-retrospective-learning-loop.md) have run.

## 9. Open Questions

1. **Who owns the readiness check — Perplexity, the ICP, or a dedicated skill?** Likely resolved by an implementation ADR once the dispatch skill lands (see [ADR-0013](../decisions/0013-agent-invocation-and-integration-boundaries.md)). Candidate ADR: readiness-check placement and invocation boundary.
2. **How are evaluation dimensions versioned?** Dimensions live in docs/templates, so they travel through PRs. Do they also need a `derived_from:` header in any adapter, per [ADR-0004](../decisions/0004-process-docs-vs-agent-skills.md)? Candidate ADR if adapters proliferate.
3. **Sampling strategy for the retro.** Does the retro read all runs in the window or sample when volume grows? Out of scope for this PRD; flagged for [ADR-0010](../decisions/0010-retrospective-learning-loop.md) revisit.
4. **Calibration of the `caution` label.** The threshold between `ready` and `caution` is judgment-based in the pilot. Candidate ADR once two retros have surfaced enough `caution`-that-should-have-been-`refuse` or vice versa.
5. **Whether QA dimensions diverge by ticket risk level.** Low-risk combined-agent runs ([ADR-0007](../decisions/0007-qa-review-evidence-workflow.md)) may need a reduced dimension set. Left unresolved; first pass applies the same dimensions to all risk levels.
6. **Whether evaluation belongs in the run-report envelope or alongside it.** Touches the [ADR-0006](../decisions/0006-agent-run-visibility-schema.md) schema and that ADR's extensibility rule. Candidate: run-report envelope extension ADR.

## 10. Risks

**Product risk.**

- **Rubber-stamp drift.** Agents produce evaluation sections that look complete but repeat boilerplate. Mitigation: [qa-review-evidence](../process/qa-review-evidence.md) already flags "rubber-stamping" as a failure mode; this PRD reinforces by making empty evaluation sections a finding.
- **Severity inflation or splitting.** Agents flag everything `high` to dodge judgment, or split one `medium` into five `low`. Mitigation: ladder rules from [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md); evaluation dimensions explicitly check for this.
- **Readiness refusal theatre.** Dispatcher produces `refuse` decisions that are immediately overridden by humans. Mitigation: refusals are logged on the Linear issue per [agent-ready-ticket](../templates/agent-ready-ticket.md); overrides are visible at retro time.

**Process / cost risk.**

- **Cost tail on evaluation runs.** QA and PR-review agents add spend per cycle. Mitigation: [cost-controls](../process/cost-controls.md) bands; runaway-cost interrupt unchanged; evaluation dimensions kept small by design.
- **Evaluation drift.** Dimensions grow over time as retros promote edits. Mitigation: sizing budget from [ADR-0010](../decisions/0010-retrospective-learning-loop.md); archive-by-default for weak signals.
- **Learning-loop redundancy.** Someone builds a second learning loop parallel to the retro. Mitigation: explicit goal 5 / non-goal 5; retro remains the only promotion surface.
- **Scope creep into automation.** Pressure to auto-gate dispatch on readiness or auto-merge on `approve`. Mitigation: explicit non-goals 2 and 3; no merge authority for agents.

**Reversibility.**

- This PRD's artifacts are docs/templates — all reversible via PR. No runtime system, no data schema beyond what already exists. Low reversibility risk.

## 11. Dependencies

**Hard blockers:** none. All prerequisite surfaces exist: [ADR-0005](../decisions/0005-linear-dependency-and-sequencing-model.md) (dispatch/sequencing), [ADR-0006](../decisions/0006-agent-run-visibility-schema.md) (run-report schema), [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md) (QA/review evidence), [ADR-0010](../decisions/0010-retrospective-learning-loop.md) (retro loop).

**Recommended predecessors:**

- [ADR-0013](../decisions/0013-agent-invocation-and-integration-boundaries.md) — invocation and integration boundaries clarify where the readiness check lives before implementation tickets are written.
- A first closed pilot cycle under [ADR-0010](../decisions/0010-retrospective-learning-loop.md) — lets the first implementation of this PRD be calibrated against real evaluation data rather than hypothetical.

**External:**

- Linear (for readiness refusal comments and dispatch state).
- GitHub (for PR-linked QA and PR-review reports).
- No third-party eval service is required or assumed.

Tickets that implement this PRD must mirror any hard blockers they create into their own `## Sequencing` blocks per [ADR-0005](../decisions/0005-linear-dependency-and-sequencing-model.md).

## 12. Approval & Autonomy

- **Draft, dispatch, and complete implementation tickets.** Agents may operate under current pilot defaults ([approval-gates-and-autonomy-rules](../process/approval-gates-and-autonomy-rules.md)): per-dispatch approval for coding/QA/review agents.
- **Readiness check refusals.** An agent-run dispatcher may refuse dispatch on pre-flight failure without asking Ben; that is already policy per [agent-ready-ticket](../templates/agent-ready-ticket.md).
- **Evaluation dimension changes.** Edits to the dimensions defined by this PRD flow through the retro loop's prompt/template promotion path ([ADR-0010](../decisions/0010-retrospective-learning-loop.md)); Ben approves merges.
- **No autonomy raise.** This PRD does not raise any agent's autonomy level. Autonomy raises remain Stop-category per [ADR-0008](../decisions/0008-agent-control-layer-and-perplexity-boundary.md) and [approval-gates-and-autonomy-rules](../process/approval-gates-and-autonomy-rules.md).
- **No merge authority for QA/review agents.** Merge and deploy remain Ben-approved per [operating model](../process/operating-model.md).

## 13. Definition of Done

- [ ] Evaluation dimensions defined per agent type and committed to docs/templates.
- [ ] Minimum QA evidence floor integrated into QA and PR-review report templates.
- [ ] Readiness check defined (inputs, outputs, refusal shape) and referenced from the agent-ready pre-flight.
- [ ] Failure-pattern → improvement-work link documented with explicit reference into [ADR-0010](../decisions/0010-retrospective-learning-loop.md).
- [ ] Goals met and acceptance criteria checked.
- [ ] Success metrics instrumented via existing surfaces (run report, retro report) or explicitly deferred with a Linear follow-up.
- [ ] Open questions either resolved or escalated to ADR candidates.
- [ ] Linear (LAT-26) and repo cross-linked.

## 14. Links

- Linear issues: [LAT-26](https://linear.app/latentspacelabs/issue/LAT-26/prd-agent-evaluation-and-qa-harness)
- Related ADRs:
  - [ADR-0003 — Linear persistence boundary](../decisions/0003-linear-persistence-boundary.md)
  - [ADR-0004 — Process docs vs agent skills](../decisions/0004-process-docs-vs-agent-skills.md)
  - [ADR-0005 — Linear dependency and sequencing model](../decisions/0005-linear-dependency-and-sequencing-model.md)
  - [ADR-0006 — Agent run visibility schema](../decisions/0006-agent-run-visibility-schema.md)
  - [ADR-0007 — QA and PR-review evidence workflow](../decisions/0007-qa-review-evidence-workflow.md)
  - [ADR-0008 — Integration Control Plane and Perplexity boundary](../decisions/0008-agent-control-layer-and-perplexity-boundary.md)
  - [ADR-0009 — Cost controls and runaway-cost interrupts](../decisions/0009-cost-controls-and-runaway-cost-interrupts.md)
  - [ADR-0010 — Retrospective learning loop](../decisions/0010-retrospective-learning-loop.md)
  - [ADR-0013 — Agent invocation and integration boundaries](../decisions/0013-agent-invocation-and-integration-boundaries.md)
- Process docs:
  - [operating-model](../process/operating-model.md)
  - [approval-gates-and-autonomy-rules](../process/approval-gates-and-autonomy-rules.md)
  - [qa-review-evidence](../process/qa-review-evidence.md)
  - [retrospective-learning-loop](../process/retrospective-learning-loop.md)
  - [cost-controls](../process/cost-controls.md)
  - [intake-triage](../process/intake-triage.md)
- Templates:
  - [agent-ready-ticket](../templates/agent-ready-ticket.md)
  - [agent-run-report](../templates/agent-run-report.md)
  - [qa-report](../templates/qa-report.md)
  - [pr-review-report](../templates/pr-review-report.md)
  - [retro-report](../templates/retro-report.md)
- Prototypes / spikes: none — this PRD is docs-only.
- Prior art / research: none beyond the ADRs above.
