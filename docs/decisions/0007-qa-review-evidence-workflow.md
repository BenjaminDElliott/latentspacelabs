---
id: ADR-0007
title: QA and PR-review evidence workflow
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-8
supersedes:
superseded_by:
revisit_trigger: Revisit when the telemetry substrate ADR lands, when a dedicated QA or review connector/agent becomes available, when PR review bot volume makes inline comments unreadable, or when merge automation is reintroduced past the pilot gate.
---

# ADR-0007: QA and PR-review evidence workflow

## Context

The operating model (see `docs/process/operating-model.md`) defines intake, dispatch, and write-back, and ADR-0003 defines the Linear persistence boundary. Neither specifies how a coding agent's output is *verified* before it reaches merge or deploy.

Today, a coding agent can open a PR with a compact run report (see `docs/templates/agent-run-report.md`), but there is no defined contract for:

- What a QA agent must check before it signs off on a run.
- What a PR review agent must check before it recommends merge.
- What evidence either agent must produce, in what shape, and where it lives.
- How severity of findings maps onto the existing approval gates (merge, deploy, Ben approval).
- Whether QA and PR review are the same agent, different agents, or allowed to collapse on low-risk work.

Without a contract, verification quality is non-deterministic: one agent writes a paragraph, another writes a single line, a third skips it entirely and the PR still lands with a green run report. The flywheel then depends on Ben catching regressions at merge time, which defeats the point of dispatching verification agents at all.

We also need this workflow to fit the pilot posture: no auto-merge, no auto-deploy, and a bounded Linear write-back per ADR-0003. Anything heavier (automated gating, CI-wired policies, signed attestations) belongs in a follow-up ADR once the telemetry substrate exists.

## Decision Drivers

- PR review and QA are different concerns and must be able to produce independent evidence, even when the same agent does both.
- Every code-producing agent run must have a verification step with a defined evidence shape — not "the next human will notice."
- Severity of findings must map cleanly onto existing approval gates (merge requires Ben; deploy requires Ben) rather than introducing new ones.
- Evidence must be scannable during backlog refinement (ADR-0003 comment size/shape guideline) and diff-able in the PR.
- The pilot must not automate merging. Verification agents recommend; Ben decides.
- Low-risk reversible work should not pay the full two-agent cost; a combined QA+review agent is allowed when the agent-ready ticket classifies the work as low-risk and reversible.
- Architecture and security findings outrank style findings. Severity must be explicit, not inferred from tone.
- The existing run report envelope already has `tests_run`, `qa_result`, `review_result` placeholders; the workflow should populate those, not fork a new schema.

## Considered Options

1. **No contract; trust the coding agent's own run report.** Rejected: that is today's state, and it is exactly the gap.
2. **Single combined QA+review agent for all work.** Rejected: conflates concerns (tests-pass ≠ design-is-sound), and a single agent's blind spots become the pilot's blind spots.
3. **Mandatory two separate agents (QA, then PR review) for every run.** Rejected: correct for medium/high-risk work, but wasteful for low-risk reversible changes the coding agent should already be closing out itself.
4. **Two distinct evidence contracts (QA report, PR review report) with a severity ladder mapping to existing approval gates; combined agent allowed for low-risk reversible work only.** Accepted.
5. **Wire verification directly into CI with automated gating.** Deferred: requires telemetry substrate + connector attestations we do not have yet; would also re-introduce auto-merge risk.

## Decision

**Accepted: Option 4 — two evidence contracts, one severity ladder, combined agent permitted only for low-risk reversible work. No automated merging in the pilot.**

### Scope boundary

This ADR covers **verification of code-producing agent runs** — i.e. runs that open a PR. Non-code runs (triage, refinement, research, PRD drafting) continue to use the standard run report and the ADR-0003 write-back contract without additional QA/review evidence. ADR-0005 dispatch still gates whether the work starts; this ADR governs how the work closes out.

### Two concerns, two evidence types

**QA** — does the change do what the ticket said it should do?

- Acceptance criteria verification (each box on the ticket's `## Acceptance Criteria` list is either met and cited, or explicitly unmet with reason).
- Test results (what was run, what passed/failed, coverage of the changed surface).
- Behavioural regressions (what previously worked that might now be broken).
- Data/migration correctness, where applicable.

**PR review** — is the change the right change, done well?

- Architecture / design alignment with relevant ADRs and the operating model.
- Code quality, clarity, and adherence to repo conventions (see CLAUDE.md, AGENTS.md, other convention files).
- Security concerns (auth, permissions, secrets, input handling, least privilege).
- Risk surface — what could break, who gets paged, how reversible is this.
- Documentation and test coverage adequacy for the risk level.

These two concerns overlap (a failing test is both a QA finding and often a review finding), but the evidence is produced twice on purpose: QA evidence answers "did it work?", review evidence answers "should it have been built this way?". Collapsing them by default loses one of those answers.

### Agent shape

- **QA agent** and **PR review agent** are separate agent types. Each produces its own report (`qa-report.md` and `pr-review-report.md`, see `docs/templates/`).
- A **combined QA+review agent** is allowed only when **all** of the following are true:
  - The agent-ready ticket's `Risk level` is `low`.
  - The change is reversible (per `intake-triage.md` severity policy — typically "revert PR" suffices as rollback).
  - No security-sensitive surface is touched (auth, permissions, secrets, cost gating, dispatch policy, data retention).
  - No ADR-relevant architectural decision is being made or changed.
- A combined agent still produces **both report sections** — one agent, two evidence artifacts. It does not collapse into a single undifferentiated "LGTM".
- When in doubt, dispatch them separately. Under-verification is a harder failure than extra verification.

### Required evidence (both agents)

Every QA report and every PR review report must contain, at minimum:

1. **Acceptance criteria verification.** Each ticket acceptance criterion is marked met / unmet / not-applicable, with a one-line citation (test name, file/line, or behavioural observation). Unmet criteria are listed separately and mapped to the severity ladder below.
2. **Test results.** What was run, what the outcome was, how to re-run. For PR review, this may be a citation of the QA report rather than a re-run.
3. **Files changed.** Concise list (paths, not diffs) with a one-line "why" per file when not obvious. Large diffs belong in the PR, not the report.
4. **Risks.** What could break, blast radius if it does, and likelihood. Cost band if elevated.
5. **Regressions considered.** What existing behaviour was checked for breakage, and how. "None considered" is a finding.
6. **Security and architecture concerns.** Explicit `none` is allowed; silence is not. Link ADRs when relevant.
7. **Findings with severity.** Every finding tagged using the severity ladder below.
8. **Final recommendation.** One of: `approve`, `approve-with-nits`, `request-changes`, `block-merge`, `needs-human` (Ben approval required).

Each report is committed to the PR (as a file or posted as a PR comment) and linked from the Linear write-back. The run report (`docs/templates/agent-run-report.md`) populates its `qa_result` / `review_result` fields by linking to these reports — it does not inline them.

### Severity ladder

Findings map to severity, and severity maps to action. The ladder is deliberately short.

| Severity | Meaning | Merge posture |
|---|---|---|
| `nit` | Style, naming, minor clarity. No correctness or risk impact. | Does not block merge. Author may fix or defer. |
| `low` | Minor correctness, doc drift, small test gap. Reversible, low blast radius. | Does not block merge by itself. Multiple `low` findings in one PR escalate to `medium`. |
| `medium` | Real correctness, test coverage, or design concern. Reversible but non-trivial to undo. | Blocks `approve`; requires `approve-with-nits` or better only after the finding is fixed or explicitly accepted in the PR with rationale. |
| `high` | Security, data-loss, architectural, or cost-gating concern. Not cleanly reversible. | **Blocks merge.** Recommendation must be `request-changes` or `block-merge`. Cannot be accepted without resolution. |
| `critical` | Active or imminent breakage: exposed secret, broken migration in-flight, cost runaway, policy violation (e.g. merging without Ben approval). | **Blocks merge and requires Ben approval** even if later downgraded. Must also be flagged in the Linear write-back `Risks:` line. |

Rules that the ladder enforces:

- A `high` or `critical` finding **cannot** be recommended `approve` or `approve-with-nits`. The agent must pick `request-changes`, `block-merge`, or `needs-human`.
- A `critical` finding **always** routes to `needs-human` (Ben approval) in addition to whatever else the report says.
- Runaway cost risk is `critical` by default, consistent with `intake-triage.md` and `operating-model.md`.
- Security-sensitive surfaces (auth, permissions, secrets, dispatch policy, cost gating, data retention) elevate any non-trivial finding to at least `medium`; a defect in those surfaces is `high` unless the agent can cite why the blast radius is truly contained.
- Multiple `low` findings in one PR escalate to a single `medium` — this is a readability guard, not a counting game. Agents should not split one issue into five `low` findings to dodge escalation.

### Interaction with existing approval gates

This ADR does not introduce new gates; it clarifies how evidence feeds the existing ones (see `operating-model.md`):

- **Opening PRs** — no change. PRs still open without per-action approval when the Linear issue key is in the title.
- **Merging PRs** — still requires Ben. Verification agents recommend; Ben decides. A clean `approve` from both QA and PR review does **not** authorize merge; it authorizes *asking* for merge approval.
- **Deploying** — still requires Ben. No verification-report recommendation can override the deploy gate.
- **`needs-human`** — a first-class recommendation value that maps to "route to Ben before merge". Agents must use it when they see `critical` findings, policy violations, or anything they are not confident verifying.

No agent in the pilot is authorized to merge PRs, regardless of its verification recommendation.

### Linear write-back from verification agents

A verification-agent write-back follows the ADR-0003 contract — five bounded elements — with two additions specific to this ADR:

- **Outcome summary** must state the final recommendation (`approve`, `approve-with-nits`, `request-changes`, `block-merge`, `needs-human`).
- **Risk flags** must surface any `high` or `critical` findings by severity label, even if the summary otherwise recommends approval. A `critical` finding that is not surfaced in the write-back is itself a policy violation and a future `critical` finding for the dispatcher.

The full report (QA or PR review) lives in the PR or committed to the repo and is linked from the write-back. It is never pasted into the Linear comment in full. See ADR-0003 comment size/shape guideline.

### PR review agent output expectations (surface-level)

The PR review agent's primary output is the `pr-review-report.md` artifact. It may additionally leave inline PR comments for findings that benefit from line-level anchoring, but:

- Inline comments do not replace the report — they cite from it.
- The report is canonical; if an inline comment and the report disagree, the report wins until reconciled.
- Findings raised only inline, with no corresponding entry in the report, are treated as `nit` by default and not blocking.

Human or agent intake of PR review comments follows the existing `intake-triage.md` GitHub-sourced intake rules.

### What this ADR does not do

- Does not automate merge or deploy. Those remain Ben-approved.
- Does not prescribe which test runner, linter, or static analyzer a QA agent uses. That is an implementation choice per project.
- Does not define a telemetry substrate for verification runs. When that ADR lands, verification reports may move into it; until then they live in the PR or the repo and are linked from Linear.
- Does not replace CI. CI results are inputs to the QA agent, not substitutes for it.
- Does not govern non-code runs (triage, research, PRD drafting). Those remain on the standard run-report contract alone.

## Consequences

Good:

- Every code-producing agent run closes out with a defined, diff-able evidence artifact rather than a vibe.
- QA and PR review concerns stay distinguishable even when the same agent produces both.
- Severity ladder makes "this is fine" vs "Ben needs to see this" mechanical, not stylistic.
- Ben's approval surface shrinks to the gates he already owns (merge, deploy) plus an explicit `needs-human` escape hatch.
- Low-risk reversible work is not taxed with two separate agents it does not need.

Bad / open:

- Two reports per code-producing run is more artifact volume than the pilot has today. The ADR-0003 write-back size guideline still applies — the reports live in PRs/repo, not in Linear comments.
- Severity classification is a judgment call. Early pilot runs will calibrate what counts as `medium` vs `high`; follow-up refinement will likely tighten the definitions.
- No automated enforcement: an agent can technically skip fields. Review depends on the PR review surface catching omissions. A future CI check should validate report presence and minimum-field completeness once the telemetry substrate is in place.
- Combined-agent scope (low-risk reversible only) will be contested on close calls. The rule-of-thumb is: if you are arguing whether to combine, don't.
- This ADR sits downstream of ADR-0005 dispatch. Verification is only meaningful on work that was dispatched correctly in the first place; a mis-dispatched run will produce a valid-looking report on the wrong change.

## Open Questions

1. How to surface verification reports in Linear beyond links — should `qa_result` / `review_result` be promoted to first-class Linear fields (custom fields) once the connector supports it?
2. When (if ever) to allow auto-merge on `approve` from both agents for the lowest-risk changes. Out of scope for the pilot; would require the telemetry substrate ADR and a rollback story, plus explicit ADR supersession here.
3. Whether visibility classes from LAT-5 (when that ADR lands) should gate which reports are visible to which agents — e.g. security findings hidden from general dispatch.
4. Whether approval gates in LAT-6 / LAT-16 (Integration Control Plane boundary; originally named "Agent Control Layer") will consume this severity ladder directly or define their own; expected direction is direct consumption.
5. Cadence for reviewing false-negative rates (verification agent approved, humans later found defects) — likely a retro input rather than a continuous metric until the telemetry substrate lands.

## Confirmation

Working if, three months in:

- Every merged PR originating from a coding agent run has a linked QA report and PR review report (or a combined-agent report with both sections present).
- No `critical` finding has reached merge without Ben approval.
- No `high` finding has reached merge with an `approve` recommendation.
- Combined QA+review agent runs are only seen on tickets classified `low` risk and reversible at dispatch time.
- Linear write-backs from verification agents stay within the ADR-0003 comment size/shape guideline.
- When Ben reviews a merge request, he does not have to re-derive acceptance-criteria status — the QA report answers it.

## Links

- Linear: `LAT-8`.
- Related ADRs: `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0001-use-perplexity-linear-and-github-as-control-plane.md`.
- Process: `docs/process/qa-review-evidence.md`, `docs/process/operating-model.md`, `docs/process/intake-triage.md`.
- Templates: `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`, `docs/templates/agent-run-report.md`, `docs/templates/agent-ready-ticket.md`.
