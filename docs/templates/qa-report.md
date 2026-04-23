# QA Report: {{LAT-XX short title}}

> QA evidence for a code-producing agent run. Answers "did the change do what the ticket said it should do?" Authoritative policy: [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md). Operational guide: [`docs/process/qa-review-evidence.md`](../process/qa-review-evidence.md).

## Metadata

- **Linear issue:** LAT-XX
- **PR:** <PR URL>
- **Commit / branch:** `<sha>` on `<branch>`
- **Coding run ID:** run_...
- **QA run ID:** run_...
- **Agent mode:** qa | combined-qa-and-review
- **Started / ended:**

## Acceptance criteria verification

> Every criterion from the ticket's `## Acceptance Criteria` list must appear here, marked met / unmet / N/A with a one-line citation. No criterion may be silently dropped. Unmet criteria are findings — map each to the severity ladder below.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | ... | met / unmet / n/a | test name, file:line, or behavioural observation |
| 2 | ... | ... | ... |

**Unmet criteria summary:** {{list of unmet criteria or "none"}}

## Test results

- **Suites run:** ...
- **Pass / fail counts:** ...
- **Newly added tests:** ...
- **Changed tests:** ...
- **Coverage on the changed surface:** ...
- **How to re-run:** `...`

Attach or link full test output if large; do not paste log dumps into this report.

## Files changed

> Paths only, with a one-line "why" per non-obvious file. No inline diffs.

- `path/to/file.ext` — why
- ...

## Regressions considered

> What existing behaviour was checked for breakage, and how. "None considered" is a finding, not a pass.

- Area checked: how it was checked, result.
- ...

## Data / migration correctness

> Fill in if the change touches data schema, migrations, seeding, or similar. Otherwise write `n/a — no data or migration change`.

- Forward migration: tested? result?
- Rollback: tested? result?
- Backfill or data transform: correctness check?
- Idempotency: verified?

## Risks

- **Blast radius if this breaks:** ...
- **Likelihood:** ...
- **Cost band:** normal | elevated | runaway_risk
- **Revert story:** how to undo — typically "revert PR" for low-risk reversible work.

## Security and architecture concerns

> Explicit `none` is allowed; silence is not. Cite relevant ADRs.

- Security: ...
- Architecture / ADR alignment: ...

## Findings

> Every finding tagged with a severity (`nit`, `low`, `medium`, `high`, `critical`). See the severity ladder in [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md#severity-ladder).

| Severity | Finding | Location | Suggested action |
|---|---|---|---|
| ... | ... | file:line or test | ... |

**Severity totals:** nit={{N}}, low={{N}}, medium={{N}}, high={{N}}, critical={{N}}

## Final recommendation

One of: `approve` · `approve-with-nits` · `request-changes` · `block-merge` · `needs-human`.

**Recommendation:** {{value}}
**Reason (one line):** ...

Rules this recommendation must satisfy (see ADR-0007):

- Any `high` or `critical` finding ⇒ recommendation is `request-changes`, `block-merge`, or `needs-human`.
- Any `critical` finding ⇒ recommendation routes to `needs-human` regardless.
- Any unmet acceptance criterion ⇒ recommendation is at minimum `request-changes` unless the ticket explicitly marks the criterion as optional.

## Linear write-back (paste into issue comment)

Follows the ADR-0003 write-back contract plus ADR-0007 additions.

```md
**Outcome:** {{recommendation}} — {{one-line why}}
**Evidence:** <PR URL> · <this QA report URL> · <run report URL>
**Risks:** {{list high/critical severity labels, or "none"; include cost band if elevated}}
**PR:** <PR URL>
**Next action:** {{single recommended next step}}
**Open questions:** {{blocking questions, or "none"}}
```
