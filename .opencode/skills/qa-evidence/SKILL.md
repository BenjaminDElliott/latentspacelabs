---
name: qa-evidence
description: Read-only QA pass over a ticket-pack run. Verify acceptance criteria, expected checks, and scope discipline; produce a QA report. Do not edit code.
---

# qa-evidence

QA is **read and check oriented**. It does not edit code by default. Its output is a structured report keyed off the ticket pack.

## Inputs

- The ticket pack (same shape as `docs/templates/opencode-ticket-pack.md`).
- The implementer's branch / PR (or local diff in dry-run).
- The implementer's run report.

## What to verify

1. **Scope discipline.** Every changed file is in `Constraints → Files in scope`. No edits under forbidden paths. No new top-level directories. No unrelated lockfile churn.
2. **Acceptance criteria.** Each bullet is objectively met by the diff plus check output. Mark unmet criteria explicitly; do not paper over.
3. **Expected checks.** Re-run `npm run check`. Re-run any ticket-specific test the pack names. Each item: pass / fail with output (redacted).
4. **Secret hygiene.** Diff and PR body contain no endpoint URL, token, internal hostname, or other secret-shaped value. If `secret-guard` is wired up, run `npm run secret-guard:staged` against the diff.
5. **PR shape.** Title prefix `LAT-NN:`, base `main`, single PR, no auto-merge enabled, no force-push to shared branches.
6. **Evidence completeness.** Implementer report includes status, PR link, files changed, checks results, criteria status, and a redacted run artifact (ADR-0014).

## Output shape

Use `docs/templates/qa-report.md` as the report contract. Summary line states one of:

- `pass` — every check green, every criterion met, scope clean.
- `fail` — one or more checks red, criteria unmet, or scope violated. List each failure with its evidence.
- `inconclusive` — environment prevented verification (e.g. cannot reproduce a check). Name the blocker.

QA does **not** fix the implementation. If the run failed, return the report; the planner decides whether to re-pack or escalate.

## Allowed write surface

Only the QA report itself (and only if the pack or the command authorises writing it to disk). Never edit source files, tests, lockfiles, or workflow files from a QA pass.
