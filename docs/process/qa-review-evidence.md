# QA and PR-review evidence workflow

> Operational guide for verifying code-producing agent runs before merge. Authoritative policy lives in [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md); this document is the working manual.

## When this applies

This workflow runs on **every code-producing agent run** — any run that opens a PR. It does not run on triage, research, refinement, PRD drafting, or other non-code runs; those continue to use only the standard run report and the ADR-0003 write-back contract.

If a PR is opened without going through an agent (a human hand-writes it), the same evidence shape is still recommended but not required by this doc. A human-authored PR is reviewed under existing repo review conventions.

## Two concerns, two reports

Every code-producing run closes out with two pieces of evidence:

- **QA report** — did the change do what the ticket said it should do? Acceptance criteria, test results, regressions considered, data/migration correctness.
- **PR review report** — is the change the right change, done well? Architecture, code quality, security, risk surface, documentation/test adequacy.

They overlap on purpose — a failing test is both a QA issue and often a review issue — but the evidence is produced twice because the two questions have different answers. See ADR-0007 for why.

Use the templates:

- [`docs/templates/qa-report.md`](../templates/qa-report.md)
- [`docs/templates/pr-review-report.md`](../templates/pr-review-report.md)

## Agent shapes

Three valid agent configurations for verification:

1. **Separate QA agent + separate PR review agent.** Default for `medium` and `high` risk tickets, anything security-sensitive, and anything that touches an ADR. Each produces its own report.
2. **Combined QA+review agent.** Allowed only when **all** conditions hold:
   - Agent-ready ticket has `Risk level: low`.
   - Work is reversible (rollback is "revert PR" or equivalent).
   - No security-sensitive surface is touched (auth, permissions, secrets, dispatch policy, cost gating, data retention).
   - No ADR-relevant decision is being made.
   - A combined agent still produces **both report sections** — one agent, two artifacts. It does not collapse into "LGTM".
3. **PR review only (no QA).** Allowed only for PRs that do not change runtime behaviour — doc-only changes, template edits, ADR additions. The PR review report must state "QA not applicable — doc/template change only" in its Test Results section.

When in doubt between (1) and (2), dispatch separately. Under-verification is a harder failure than extra verification.

## Evidence every report must contain

Both templates enforce this, but for reference:

1. Acceptance criteria verification — each ticket criterion met / unmet / N/A with a one-line citation.
2. Test results — what was run, outcomes, how to re-run.
3. Files changed — paths with a one-line why per non-obvious file. No inline diffs.
4. Risks — what could break, blast radius, likelihood, cost band if elevated.
5. Regressions considered — existing behaviour that was checked. "None considered" is a finding.
6. Security and architecture concerns — explicit `none` is allowed; silence is not.
7. Findings, each tagged with a severity from the ladder below.
8. Final recommendation — `approve`, `approve-with-nits`, `request-changes`, `block-merge`, or `needs-human`.

## Severity ladder

| Severity | Meaning | Merge posture |
|---|---|---|
| `nit` | Style, naming, minor clarity. No correctness or risk impact. | Does not block merge. |
| `low` | Minor correctness, doc drift, small test gap. Reversible, low blast radius. | Does not block alone. Multiple `low` findings escalate to `medium`. |
| `medium` | Real correctness, test coverage, or design concern. Reversible but non-trivial. | Blocks `approve`; requires fix or explicit in-PR acceptance with rationale. |
| `high` | Security, data-loss, architectural, or cost-gating concern. Not cleanly reversible. | **Blocks merge.** Recommendation must be `request-changes` or `block-merge`. |
| `critical` | Active or imminent breakage: exposed secret, broken in-flight migration, cost runaway, policy violation. | **Blocks merge and requires Ben approval.** Must be flagged in Linear write-back `Risks:`. |

Enforced rules:

- `high` or `critical` ⇒ cannot recommend `approve` or `approve-with-nits`.
- `critical` ⇒ always routes to `needs-human`, on top of any other recommendation.
- Runaway cost risk is `critical` by default.
- Security-sensitive surface (auth, permissions, secrets, dispatch policy, cost gating, data retention): any non-trivial finding is at least `medium`; a defect there is `high` unless blast radius is demonstrably contained.
- Splitting one issue into N `low` findings to dodge escalation is itself a finding.

## Recommendation values

| Value | When | Does it authorize merge? |
|---|---|---|
| `approve` | All acceptance criteria met, no `medium`+ findings. | No. Merge still requires Ben. |
| `approve-with-nits` | Acceptance met, only `nit` or single `low` findings. | No. Merge still requires Ben. |
| `request-changes` | One or more `medium` findings, or unmet acceptance criteria that are fixable in-PR. | No — needs author rework. |
| `block-merge` | One or more `high` findings, or acceptance criteria materially unmet. | No — and must not be softened to `request-changes` without resolution. |
| `needs-human` | `critical` finding, policy ambiguity, or the agent is not confident. Also the fallback when unsure. | No — routes to Ben. |

No verification recommendation authorizes merge. Merge and deploy remain Ben-approved per `operating-model.md`.

## Linear write-back from a verification agent

Follow the ADR-0003 write-back contract (five bounded elements) with two additions for verification runs:

- **Outcome** must include the final recommendation verbatim (`approve`, `approve-with-nits`, `request-changes`, `block-merge`, or `needs-human`).
- **Risks** must surface every `high` and `critical` finding by severity label, even when the overall recommendation is an approval variant. A `critical` finding omitted from the write-back is itself a `critical` finding on the next dispatch.

Link to the QA report and PR review report in `Evidence:`. Never paste the full report into the Linear comment. Scannable-on-a-phone-once-over still applies.

Example write-back from a PR review agent:

```md
**Outcome:** request-changes — 2 medium findings on test coverage for migration rollback; acceptance criteria 3/5 met.
**Evidence:** <PR URL> · <pr-review-report URL> · <qa-report URL> · <run report URL>
**Risks:** medium x2 (migration rollback untested, error path swallows exceptions); cost band normal.
**PR:** <PR URL>
**Next action:** author addresses findings, re-request review.
**Open questions:** none.
```

## Where reports live

- Commit the report as a file in the PR branch (e.g. `.agent-runs/<run-id>/qa-report.md`) **or** post it as a PR comment with a stable anchor.
- Link both reports from the PR description.
- Link both reports from the Linear write-back `Evidence:` line.
- The `agent-run-report.md` envelope's `qa_result` and `review_result` fields should link to these reports, not inline them.

Until the telemetry substrate ADR lands, reports in the repo or as PR comments are the canonical verification evidence. When the substrate exists, a follow-up may move them — do not pre-migrate.

## Interaction with dispatch (ADR-0005)

Verification runs are themselves agent runs and are dispatched the same way:

- A QA or PR review run on PR for `LAT-X` reads `LAT-X`'s `## Sequencing` block just like any other dispatch.
- Verification runs do not usually have their own `LAT-*` issue; they attach to the coding run's issue and write back there.
- If verification uncovers a real dependency the coding agent missed, the finding is lifted into `## Sequencing` during the next refinement pass, not silently dropped.

## Interaction with intake (`intake-triage.md`)

- Inline PR review comments are already first-class intake per `intake-triage.md`. A finding in a PR review report that is actioned in-PR does not need a separate intake item; a finding that is deferred or that implies an ADR/ticket update does.
- If the PR review agent surfaces a `high`/`critical` finding that is not actionable in the current PR (e.g. it reveals an architectural mismatch), triage the finding into a new `LAT-*` issue or ADR candidate per the usual intake flow, and link the new item from the PR review report.

## Failure modes to watch for

- **Rubber-stamping.** An `approve` with empty Findings and generic Risks is a failure mode, not a success. A report with no findings on a non-trivial PR is itself a `low` finding on the agent.
- **Severity inflation to dodge merge.** Flagging everything `high` to avoid having to judge is as bad as under-classifying. Severity must match blast radius and reversibility, not the agent's comfort level.
- **Severity splitting.** Five `low` findings that are really one `medium` should be written as one `medium`. See the severity ladder rules.
- **Unmet criteria laundered as nits.** An unmet acceptance criterion is at minimum `medium`, never `nit`, regardless of how small the gap looks.
- **Silent combined-agent scope creep.** A combined QA+review agent on a medium-risk or security-sensitive ticket is a policy violation and itself a `critical` finding on the next dispatch.

## Related

- ADR-0007 (authoritative policy): `docs/decisions/0007-qa-review-evidence-workflow.md`
- ADR-0003 (Linear write-back contract): `docs/decisions/0003-linear-persistence-boundary.md`
- ADR-0005 (dispatch / sequencing): `docs/decisions/0005-linear-dependency-and-sequencing-model.md`
- Operating model: `docs/process/operating-model.md`
- Intake: `docs/process/intake-triage.md`
- Templates: `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`, `docs/templates/agent-run-report.md`, `docs/templates/agent-ready-ticket.md`
- Linear: `LAT-8`
