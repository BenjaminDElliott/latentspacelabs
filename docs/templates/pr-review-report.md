# PR Review Report: {{LAT-XX short title}}

> PR review evidence for a code-producing agent run. Answers "is the change the right change, done well?" Authoritative policy: [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md). Operational guide: [`docs/process/qa-review-evidence.md`](../process/qa-review-evidence.md).

## Metadata

- **Linear issue:** LAT-XX
- **PR:** <PR URL>
- **Commit / branch:** `<sha>` on `<branch>`
- **Coding run ID:** run_...
- **Review run ID:** run_...
- **Agent mode:** review | combined-qa-and-review
- **Started / ended:**
- **Linked QA report:** <URL or "n/a — combined agent; QA section is in this report" or "n/a — doc/template change only, per process doc">

## Acceptance criteria alignment

> Cross-check the ticket's `## Acceptance Criteria` from a design perspective — not just "is it met" (QA answers that) but "does meeting it like this match the intent". Flag any criterion whose implementation satisfies the letter but not the spirit.

| # | Criterion | QA status | Design alignment | Notes |
|---|---|---|---|---|
| 1 | ... | met / unmet / n/a | aligned / concern | ... |

If this is a combined QA+review report, fill in QA status directly from this report's QA section and delete this explanation.

## Architecture and ADR alignment

> Does the change respect existing ADRs? Does it make an ADR-relevant decision implicitly? Link the ADRs you checked against.

- ADRs checked: ADR-NNNN, ...
- Concerns: ...
- Does this change implicitly make an architectural decision? If yes, does it need an ADR of its own?

## Code quality and convention adherence

- Repo conventions (CLAUDE.md, AGENTS.md, other convention files) — followed? deviations noted?
- Clarity / readability — concerns at specific file:line?
- Naming — concerns?
- Error handling boundaries — appropriate for the layer?
- Dead code, premature abstraction, commented-out code — flagged?

## Security concerns

> Explicit `none` is allowed; silence is not. Elevate findings on security-sensitive surfaces per the severity ladder.

- Auth / permissions: ...
- Secrets / credentials: ...
- Input validation (at system boundaries): ...
- Least privilege (connectors, tokens, scopes): ...
- Data retention / PII exposure: ...

## Risk surface

- **What could break:** ...
- **Blast radius:** ...
- **Who gets paged:** ...
- **Reversibility:** revert-PR / non-trivial rollback / irreversible
- **Cost band:** normal | elevated | runaway_risk

## Test coverage adequacy (review perspective)

> QA ran the tests. The review perspective is whether the tests cover the *right things* for the risk level — not just whether they pass.

- Coverage matches risk level? ...
- Missing test cases worth calling out?
- Flaky or brittle tests introduced?

## Documentation adequacy

- Process docs / ADRs updated if the change affects them?
- Inline comments — only where WHY is non-obvious (per CLAUDE.md)?
- PR description — acceptance, testing, risks covered?

## Files changed

> Paths only, with a one-line "why" per non-obvious file. No inline diffs.

- `path/to/file.ext` — why
- ...

## Findings

> Every finding tagged with a severity (`nit`, `low`, `medium`, `high`, `critical`). See the severity ladder in [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md#severity-ladder).

| Severity | Finding | Location | Suggested action |
|---|---|---|---|
| ... | ... | file:line | ... |

**Severity totals:** nit={{N}}, low={{N}}, medium={{N}}, high={{N}}, critical={{N}}

## Inline PR comments

> Inline comments cite findings from this report; they do not replace it. Findings raised only inline with no entry above are treated as `nit` and non-blocking.

- `<inline comment URL>` — cites finding #N above
- ...

## Final recommendation

One of: `approve` · `approve-with-nits` · `request-changes` · `block-merge` · `needs-human`.

**Recommendation:** {{value}}
**Reason (one line):** ...

Rules this recommendation must satisfy (see ADR-0007):

- Any `high` or `critical` finding ⇒ recommendation is `request-changes`, `block-merge`, or `needs-human`.
- Any `critical` finding ⇒ recommendation routes to `needs-human` regardless.
- Security-sensitive surface touched with a non-trivial finding ⇒ at least `medium` severity; `approve` is not available.
- Combined QA+review scope requires `Risk level: low`, reversibility, no security-sensitive surface, and no ADR-relevant decision. If any of those fail, this PR needed separate agents and that is itself a finding.

## Merge posture reminder

No agent in the pilot is authorized to merge. This recommendation authorizes *asking* Ben for merge, not merging. See `docs/process/operating-model.md` approval gates.

## Linear write-back (paste into issue comment)

Follows the ADR-0003 write-back contract plus ADR-0007 additions.

```md
**Outcome:** {{recommendation}} — {{one-line why}}
**Evidence:** <PR URL> · <this review report URL> · <QA report URL> · <run report URL>
**Risks:** {{list high/critical severity labels, or "none"; include cost band if elevated}}
**PR:** <PR URL>
**Next action:** {{single recommended next step}}
**Open questions:** {{blocking questions, or "none"}}
```
