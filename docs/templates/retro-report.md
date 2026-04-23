# Retro Report: {{cycle label}}

> Retrospective evidence for a completed pilot cycle (or a monthly minimum-cadence review). Answers the six retrospective questions and routes findings to one of four promotion paths. Authoritative policy: [ADR-0010](../decisions/0010-retrospective-learning-loop.md). Operational guide: [`docs/process/retrospective-learning-loop.md`](../process/retrospective-learning-loop.md).

## Metadata

- **Cycle label:** e.g. `2026-Q2 pilot slice 3` or `monthly review 2026-05`
- **Window:** `YYYY-MM-DD` → `YYYY-MM-DD`
- **Kind:** cycle-close | monthly-minimum | ad-hoc
- **Retro run ID:** run_...
- **Agent mode:** retro | human-led | mixed
- **In-scope `LAT-*` issues:** LAT-XX, LAT-YY, ...
- **Explicit exclusions:** issues in the window that are *not* covered here, with a one-line reason each; or "none"
- **Retro cost band:** normal | elevated | runaway_risk
- **Started / ended:**

If `Retro cost band` is `elevated` or `runaway_risk`, **stop and hand to Ben** per ADR-0010 stop conditions. Do not continue this retro autonomously.

## Evidence surfaces consulted

> Check each row; if a surface was skipped or unavailable, say why. An unconsulted surface is a risk to the retro's conclusions.

| Surface | Read? | Notes / gaps |
|---|---|---|
| Agent run reports (ADR-0006) | ✅ / ❌ | runs by `agent_type` / `linear_issue_id`; note any missing envelopes |
| QA reports (ADR-0007) | ✅ / ❌ | severity distribution, unmet criteria |
| PR review reports (ADR-0007) | ✅ / ❌ | recurring finding categories |
| Linear write-backs (ADR-0003) | ✅ / ❌ | open questions, risk flags |
| Intake triage outputs (`intake-triage.md`) | ✅ / ❌ | rejected items, low-confidence classifications |
| Dispatch decisions (ADR-0005) | ✅ / ❌ | any `## Sequencing` block failures/overrides |
| Docs-vs-skills drift (ADR-0004) | ✅ / ❌ | any adapter/doc mismatches flagged |
| ACL routing decisions (ADR-0008) | ✅ / ❌ | rule-matrix edge cases encountered |

## The six retrospective questions

> Answer each in order. "Not applicable" is allowed with a one-line reason; silence is not. See `retrospective-learning-loop.md` for each question's intent.

### 1. Did we build the right thing?

Did shipped changes match the captured intent (ticket, PRD, ADR)? Where did intent diverge — intake, refinement, dispatch, implementation?

- ...

### 2. Were tickets well-scoped?

Did agent-ready tickets pass pre-flight cleanly? Were acceptance criteria concrete, testable, complete? Where was scope fuzzy?

- ...

### 3. Where did agents struggle?

Which run steps stalled, looped, retried? Which tools or skills were missing, broken, over-invoked? Where did dispatch read the wrong signal?

- ...

### 4. Were acceptance criteria sufficient?

Did QA find gaps in the criteria themselves? Did a criterion pass mechanically while missing intent? Did reviewers flag concerns the criteria did not cover?

- ...

### 5. What did QA and review catch?

Which `medium`/`high`/`critical` findings surfaced? Which were recurring across tickets? Which imply template/prompt/routing fixes rather than per-ticket fixes?

- ...

### 6. Were costs reasonable?

Did runs stay within declared cost bands? Were any `elevated` or `runaway_risk`? Where did spend diverge from estimate?

- ...

## Agent-created Linear work review

> Required per ADR-0010. Every `LAT-*` issue created by an agent during the window appears here. Classification, labelling, AC quality, and dispatch state.

| Issue | Created by | Classification | Labels OK? | AC quality | Dispatched? | Action |
|---|---|---|---|---|---|---|
| LAT-XX | agent-name | project / area / ... | ✅ / ❌ | good / thin / fuzzy | yes / no / deferred | keep / refine / archive |

**Agent-created issues total:** {{N}}. **Flagged for refinement or archive:** {{list or "none"}}.

## Repeated failure patterns

> A pattern is the same failure mode in ≥ 2 runs or ≥ 2 tickets in the window, or ≥ 3 across recent retros. Every detected pattern **must** produce a promotion (backlog or ADR candidate) or an archived-with-rationale entry. Silently dropping a detected pattern is itself a finding on the next retro.

| # | Pattern (agent_type + failure shape) | Evidence (runs / tickets) | Promotion |
|---|---|---|---|
| 1 | ... | runs / tickets | prompt/template PR · backlog item · ADR candidate · archived-with-rationale |
| 2 | ... | ... | ... |

If none detected in the window, say so explicitly and state how it was checked.

## Findings and promotions

> Each finding maps to exactly **one** promotion path. Default when in doubt: **archive**. Respect the retro's sizing budget — a handful of promotions total across all paths. Overflow goes to archived observations.

### Prompt / template updates (PR path)

| # | Finding | Target file(s) | Draft PR | Notes |
|---|---|---|---|---|
| 1 | ... | `docs/templates/...` or future `.claude/skills/...` | <PR URL or "pending"> | Respect `derived_from:` header per ADR-0004; include `Affected adapters:` line |

### Backlog items (intake-triage path)

| # | Finding | New or existing `LAT-*` | Actionability | Notes |
|---|---|---|---|---|
| 1 | ... | LAT-XX (new) / LAT-YY (update) | needs-refinement / agent-ready | Must pass intake pre-flight — no retro-originated `agent-ready` issues without the normal checks |

### Architecture decision candidates (ADR path)

| # | Finding | Proposed ADR file | Status | Approval |
|---|---|---|---|---|
| 1 | ... | `docs/decisions/NNNN-....md` | proposed | Ben merge per ADR lifecycle |

> Any ADR candidate that would edit `approval-gates-and-autonomy-rules.md`, ADR-0008, ADR-0010, or raise an autonomy level is a **stop-and-escalate** item — draft only, hand to Ben, do not proceed autonomously.

### Archived observations

> Weak signals, single data points, known limitations. No approval needed. Revisit these in the next retro; patterns earn promotion by repeating.

- ...

## Stop-condition check

> Confirm none of the ADR-0010 hard stop conditions were violated in producing this retro. If any were, the retro must halt and escalate rather than merge.

- [ ] No proposed change edits `approval-gates-and-autonomy-rules.md`, ADR-0008, ADR-0010, the retro loop definition, or raises an autonomy level **without** being routed to Ben approval.
- [ ] Retro cost band is `normal`.
- [ ] No other retro is concurrently targeting the same surface (prompts / templates / routing rules / backlog).
- [ ] Sizing budget respected — promotions across all paths are within the budget stated in `retrospective-learning-loop.md`.
- [ ] Every detected repeated failure pattern is either promoted or archived-with-rationale (no silent drops).

## Narrative

One or two paragraphs. What did this cycle look like as a whole? What should a future retro — or Ben, reading this cold in six months — pay attention to?

## Linear write-backs

> For every `LAT-*` issue whose description or status this retro changed, leave a single bounded write-back per the ADR-0003 contract. The retro report URL goes in `Evidence:`.

```md
**Outcome:** retro for {{cycle label}} — {{one-line summary of impact on this issue}}
**Evidence:** <retro report URL> · <related PRs> · <related ADR drafts>
**Risks:** {{risk flags, cost band if elevated; "none" is fine}}
**PR:** <retro report PR URL, or "n/a">
**Next action:** {{single recommended next step}}
**Open questions:** {{blocking questions, or "none"}}
```

## Related

- ADR-0010 (authoritative policy): `docs/decisions/0010-retrospective-learning-loop.md`
- Process: `docs/process/retrospective-learning-loop.md`
- Evidence templates: `docs/templates/agent-run-report.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`, `docs/templates/agent-ready-ticket.md`
- Upstream ADRs feeding the loop: `0001`, `0003`, `0004`, `0005`, `0006`, `0007`, `0008`
