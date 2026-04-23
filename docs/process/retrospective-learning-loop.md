# Retrospective learning loop

> Operational guide for how the pilot improves itself — prompts, templates, routing rules, and backlog — from human and agent feedback. Authoritative policy lives in [ADR-0010](../decisions/0010-retrospective-learning-loop.md); this document is the working manual.

## Why this exists

The flywheel produces evidence on every cycle: run reports (ADR-0006), QA and PR-review reports (ADR-0007), Linear write-backs (ADR-0003), dispatch decisions (ADR-0005), intake classifications (`intake-triage.md`), and ICP routing calls (ADR-0008 / ADR-0012; originally named "ACL routing" in ADR-0008). Without a bounded review step, that evidence accumulates without changing how we work. Without **bounded** review, the system drifts into self-reflection loops that never terminate and into silent rewrites of its own governance rules.

The retrospective learning loop is the explicit, scoped mechanism by which raw observations become durable changes. It is deliberately a **small, slow loop**, not a continuous optimization process.

## Scope and stop conditions

The loop applies to:

- Completed pilot cycles (a `LAT-*` issue that reached `Done`, `Cancelled`, or was explicitly abandoned).
- Repeated agent failure patterns observable across multiple runs.
- Clusters of intake or review feedback that imply a process/template change rather than a per-ticket fix.

It does **not** apply to:

- Per-run debugging (that belongs in the run report and PR).
- One-off ticket scope disputes (that is intake/triage, not retro).
- Tuning inside a single agent run (that is mid-run judgement, not a durable learning).

Hard stop conditions — the loop must halt and escalate rather than iterate:

- A proposed change edits `docs/process/approval-gates-and-autonomy-rules.md`, ADR-0008, or raises an autonomy level → **Ben approval required**. Agents draft; agents do not merge governance changes. See `operating-model.md` approval gates and ADR-0008 rule matrix.
- A proposed change would modify this document's own loop definition, stop conditions, or approval gates → Ben approval required (no self-rewriting of the retro loop itself).
- The retro's own cost band is `elevated` or `runaway_risk` → stop and hand back to Ben per the runaway-cost rule (ADR-0001, ADR-0008).
- More than one retro proposal in-flight per surface (prompts, templates, routing rules, backlog) → batch or queue; do not fan out parallel rewrites of the same surface.

## The six retrospective questions

Every retro answers these six questions in order. They are deliberately narrow — the loop fails by breadth, not depth.

1. **Did we build the right thing?** Did the shipped change match the intent captured in the ticket, PRD, or ADR? If no, where did intent diverge — at intake, refinement, dispatch, or implementation?
2. **Were tickets well-scoped?** Did the agent-ready ticket pass pre-flight cleanly (`docs/templates/agent-ready-ticket.md`)? Were acceptance criteria concrete, testable, and complete? Where was scope fuzzy enough that the agent had to guess?
3. **Where did agents struggle?** Which run steps stalled, looped, or needed retries? Which tools or skills were missing, broken, or over-invoked? Where did dispatch read the wrong signal?
4. **Were acceptance criteria sufficient?** Did QA find gaps in the criteria themselves (ADR-0007)? Did a criterion pass mechanically while missing the intent? Did reviewers flag concerns the criteria did not cover?
5. **What did QA and review catch?** Which `medium`/`high`/`critical` findings surfaced (see severity ladder in `qa-review-evidence.md`)? Which were recurring across tickets? Which implied a template, prompt, or routing fix rather than a per-ticket fix?
6. **Were costs reasonable?** Did the run stay within its declared cost band (ADR-0003)? Were any runs `elevated` or `runaway_risk`? Where did spend diverge from estimate, and was the estimate itself wrong?

A retro that skips a question must say so and why. "Not applicable" is a valid answer; silence is not.

## What the loop produces: the four promotion paths

Each retro finding is routed into exactly one of four promotion paths. A finding that cannot be routed is itself an open question.

| Path | When | Who owns the change | Approval |
|---|---|---|---|
| **Prompt / template update** | A repeated phrasing, missing instruction, or schema gap in an agent prompt, skill, or template (`docs/templates/`, future `.claude/skills/`, future `.claude/commands/`). | Retro agent drafts PR; human reviews. | PR merge (Ben) per normal doc-merge rule. |
| **Backlog item** | A discrete unit of follow-up work that is neither a governance change nor a template fix — e.g. add a missing adapter, write a missing test, instrument a missing metric. | Retro creates `LAT-*` issue via intake-triage (needs-refinement or agent-ready as warranted). | Per intake-triage defaults; no new approval gate. |
| **Architecture decision candidate** | A finding that implies a cross-cutting or irreversible change — autonomy raise, new persistence surface, new approval boundary, new dispatch signal. | Retro creates an ADR draft in `docs/decisions/` (status `proposed`). | ADR merge (Ben) per `docs/decisions/README.md`. Major autonomy/governance ADRs follow the stop conditions above. |
| **Archived note** | An observation worth recording but not actionable now — weak signal, single data point, known limitation. | Retro records it in the retro report's **Archived observations** section. | No approval needed; visible in the report and searchable later. |

**Default when in doubt: archived note.** Promoting a weak signal to a template/prompt change is cheap to propose but costly to reverse once it enters skill files or agent behaviour. Under-promoting is safer than over-promoting; a pattern that is real will reappear in the next retro and earn promotion then.

A single retro may produce up to a small number of promotions per path (see [cadence and sizing](#cadence-and-sizing)). If it produces more, the retro is too broad — split it or shorten the window.

## Inputs to the loop

The retro is a consumer of evidence produced by the rest of the flywheel. It does not re-derive that evidence; it reads it.

| Source | What the retro reads | Reference |
|---|---|---|
| Agent run reports | `summary`, `decisions`, `errors`, `next_actions`, `cost`, `status`, `autonomy_level` per run. Grouped by `agent_type`, `linear_issue_id`, `correlation.pr_branch`. | ADR-0006, `docs/templates/agent-run-report.md` |
| QA and PR-review reports | Acceptance-criterion verification, findings by severity, recommendations, recurring failure modes. | ADR-0007, `docs/process/qa-review-evidence.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md` |
| Linear write-backs | Bounded outcome, risks, open questions per `LAT-*` issue. | ADR-0003, `operating-model.md` |
| Intake triage results | Triage-output shape: confidence, classification, open questions, rejected items. | `docs/process/intake-triage.md` |
| Docs-vs-skills drift | Adapters that disagreed with canonical docs during the cycle, per ADR-0004's `Affected adapters:` flag on doc PRs. | ADR-0004, `docs/process/README.md` |
| Approval / control-plane decisions | Which actions were routed P-Direct, P-Propose, ICP-Routed, or Stop; any rule-matrix edge cases encountered. (ADR-0008 originally called this category `ACL-Routed`; renamed by ADR-0012.) | ADR-0008, ADR-0012, `docs/process/approval-gates-and-autonomy-rules.md` |
| Dispatch decisions | Hard-blocker / soft-predecessor calls; any `## Sequencing` block failures or overrides. | ADR-0005 |

If a retro cannot find the evidence it needs for one of the six questions, the gap itself is a finding — route it to the appropriate promotion path (typically backlog or ADR candidate).

## Cadence and sizing

- **Default cadence:** retro runs at the end of each pilot cycle. A **pilot cycle** is a bounded window agreed with Ben — e.g. a set of shipped `LAT-*` issues, a calendar window, or a declared milestone. The retro targets that window, not "all work ever".
- **Minimum cadence:** monthly review of agent-created Linear work, even if no cycle closed. This catches slow-accumulating intake or backlog drift.
- **Maximum cadence:** no more than one retro per surface (prompts, templates, routing rules, backlog) in-flight at once. Parallel retros on the same surface are a policy violation and themselves a retro finding.
- **Retro size budget:** at most a handful of promoted changes per retro across all four paths combined. If the retro identifies more, rank by blast-radius-prevented per effort and promote only the top items; record the rest as archived observations for the next retro.
- **Review of agent-created Linear work:** as part of each retro, explicitly review every `LAT-*` issue created by an agent during the window — classification, labelling, acceptance criteria quality, and whether it was dispatched. This is the counterweight to agents silently accumulating work for themselves.

## Shape of a retro run

A retro is itself an agent run (or a human-driven run using the same shape). It produces a **retro report** in `docs/templates/retro-report.md` and writes back to any Linear issues whose status or description it changed.

Minimum steps:

1. **Declare window.** State the cycle being reviewed: time window, list of `LAT-*` issues in scope, any explicit exclusions. Record the cost band for the retro itself.
2. **Read inputs.** Pull the evidence surfaces listed above for that window. Do not re-run agents; do not re-derive conclusions already captured in a QA or review report.
3. **Answer the six questions.** One section per question. "Not applicable" is allowed with a one-line reason.
4. **Detect repeated failure patterns.** A pattern is "the same failure mode appearing in ≥ 2 runs or ≥ 2 tickets in the window, or ≥ 3 across recent retros". A detected pattern **must** produce a promotion (backlog or ADR candidate); quietly dropping a detected pattern is itself a finding on the next retro.
5. **Route findings.** Place each finding on exactly one promotion path. Apply the stop conditions before drafting any change to governance or autonomy.
6. **Draft the changes.** Prompt/template updates → PR. Backlog → `LAT-*` issues via intake-triage. ADR candidates → `docs/decisions/` draft in `proposed` status. Archived → retro report only.
7. **Write back to Linear.** Standard ADR-0003 write-back on any touched issues; the retro report URL goes in `Evidence:`.

A retro may open many PRs (one per promotion where practical) but the retro run itself opens at most one retro-report PR to land the report.

## Repeated failure detection

The third question — "where did agents struggle?" — is load-bearing for the acceptance criterion that repeated agent failure patterns generate improvement work.

- Define a **failure pattern** as: the same `agent_type` hitting the same `errors[*]` shape, the same recurring `needs_human` reason, the same QA/review finding category, or the same cost-band escalation across ≥ 2 runs in the window (or ≥ 3 across recent retros for slower-moving patterns).
- When detected, the retro must create or update improvement work:
  - If the fix is a prompt/template tweak → open a PR on that path.
  - If the fix requires new code, instrumentation, or a missing adapter → create or update a `LAT-*` backlog item (update preferred if one already exists).
  - If the fix implies a rule-matrix or autonomy-level change → ADR candidate with Ben approval.
- A detected pattern with no promoted change and no archived-with-rationale entry is a retro failure, and is itself a finding on the next retro.

## Self-rewriting guardrails

The retro loop is not allowed to silently change its own governance.

- **This document.** Edits to `retrospective-learning-loop.md` follow the normal doc-PR path, merge-approved by Ben. The retro may *propose* edits; it must not *apply* them as part of its own run.
- **ADR-0010.** Edits follow the ADR supersession rule (`docs/decisions/README.md`): accepted ADRs are immutable; a material change requires a new ADR that supersedes 0010, which Ben approves.
- **Approval gates and autonomy rules.** Covered by the stop conditions above and the existing Stop rows in `approval-gates-and-autonomy-rules.md` ("Change approval gates or autonomy rules" and "Raise an autonomy level beyond the pilot default" are Stop-category).
- **Feedback loop on the feedback loop.** Observations about the retro process itself go into the *Archived observations* section of the retro report and are considered on the next retro by a human, not as an input the retro uses to rewrite itself mid-run.

## Interactions with other pilot mechanisms

- **Run visibility (LAT-5 / ADR-0006).** Retro is the primary downstream consumer of the run-report envelope. If a question cannot be answered from the envelope today, the gap is an ADR-0006-extension finding (open sub-object or follow-up ADR per that ADR's extensibility rule).
- **QA and review evidence (LAT-8 / ADR-0007).** Retro reads severity-tagged findings verbatim; it does not re-grade them. Recurring `medium`+ categories are the primary signal for template/prompt promotions.
- **Intake triage (LAT-10).** Retro creates backlog via the same triage pipeline; retro-originated issues are not exempt from pre-flight. A retro that creates `agent-ready` issues directly is a policy violation.
- **Docs vs skills (LAT-14 / ADR-0004).** Prompt/template promotions must respect the `derived_from:` header and the `Affected adapters:` PR convention. When adapters exist, a prompt change that does not update its derived adapter is a retro finding.
- **Approval gates / control boundary (LAT-16 / LAT-6 / ADR-0008).** The rule matrix is the reference when routing a promotion. Retro never raises an autonomy level and never edits the matrix without an ADR.

## Failure modes to watch for

- **Observation fatigue.** Long lists of "we should maybe..." items with no promotions. A retro that archives everything is a retro that learned nothing — push one or two items to a real promotion path or shorten the window.
- **Promotion inflation.** Promoting every weak signal to a prompt or template change. Defaults: when in doubt, archive. Patterns earn promotion by repeating, not by being written well once.
- **Governance creep.** Proposing autonomy raises, rule-matrix edits, or loop redefinitions inside the retro. All of these are Stop; the retro may draft but not decide.
- **Retro loop blur.** Using the retro to do intake triage, PRD drafting, or per-ticket debugging. Those have their own surfaces; the retro reads their outputs, it does not replace them.
- **Cycle overrun.** Retros that consume multiple days of compute or conversation. The retro itself must respect cost bands and stop-and-ask on runaway.
- **Silent dropping of detected patterns.** A failure pattern present in the evidence but not promoted or archived with rationale. This is the single highest-impact failure mode for the loop's usefulness.

## Related

- ADR-0010 (authoritative policy): `docs/decisions/0010-retrospective-learning-loop.md`
- ADR-0001 (control plane): `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`
- ADR-0003 (Linear write-back contract): `docs/decisions/0003-linear-persistence-boundary.md`
- ADR-0004 (docs vs skills): `docs/decisions/0004-process-docs-vs-agent-skills.md`
- ADR-0005 (dispatch / sequencing): `docs/decisions/0005-linear-dependency-and-sequencing-model.md`
- ADR-0006 (agent run visibility schema): `docs/decisions/0006-agent-run-visibility-schema.md`
- ADR-0007 (QA / review evidence): `docs/decisions/0007-qa-review-evidence-workflow.md`
- ADR-0008 (Integration Control Plane and Perplexity boundary; originally titled "Agent Control Layer"): `docs/decisions/0008-agent-control-layer-and-perplexity-boundary.md`
- ADR-0011 (Integration Control Plane language and runtime): `docs/decisions/0011-integration-control-plane-language-and-runtime.md`
- ADR-0012 (Integration Control Plane software architecture; renames ACL → ICP): `docs/decisions/0012-integration-control-plane-software-architecture.md`
- Process: `operating-model.md`, `intake-triage.md`, `qa-review-evidence.md`, `approval-gates-and-autonomy-rules.md`
- Templates: `docs/templates/retro-report.md`, `docs/templates/agent-run-report.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`, `docs/templates/agent-ready-ticket.md`
- Linear: `LAT-11` (this policy), `LAT-5`, `LAT-8`, `LAT-10`, `LAT-14`, `LAT-16`, `LAT-6`
