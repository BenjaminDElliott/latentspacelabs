---
name: implement-ticket
description: Execute one bounded ticket pack end-to-end — branch, edit allowlisted files, run checks, open one PR. Use only after agent-ready-ticket has cleared the pack.
---

# implement-ticket

Mechanical implementation only. The planner has already done architecture and decomposition; this skill does the edits and opens the PR.

## Preconditions

- `agent-ready-ticket` returned `ready` on the pack.
- `repo-guardrails` is loaded.
- Working tree is clean and on `main` (or up to date with it).

## Steps

1. **Create the branch** named in the pack: `lat-<NN>-<slug>`. One branch only.
2. **Edit only the files in the allowlist.** Do not read or write outside it. If the pack pasted reference snippets, use those instead of grepping the repo.
3. **Make the smallest change** that satisfies every acceptance-criteria bullet. No refactors, no abstractions beyond what the criteria require.
4. **Add tests if the pack names them.** If the pack does not require tests, do not invent them.
5. **Run `npm run check`** locally. If it fails for a reason inside the ticket's scope, fix it and re-run. If it fails for a reason outside the ticket's scope, stop and report `blocked` with the failing output (redacted of any secret-shaped values).
6. **Commit** with a concise imperative message. No AI attribution, no co-author lines, no marketing.
7. **Open one PR** against `main`. Title prefix `LAT-NN:`. Body is terse: changelog, checks run with results, Linear issue reference. Do not paste the ticket pack into the PR body.

## What to refuse

Stop and report a non-`ready` status if any of:

- A required edit would touch a forbidden path.
- A new dependency is needed but `Dependency policy` forbids it.
- An acceptance criterion requires an architecture decision the pack does not specify → `needs_clarification`.
- The change span clearly exceeds the small-model surface mid-run → `too_large` (mark any opened PR draft and note the status).
- `npm run check` fails for an unrelated reason → `blocked`.

## Final report shape

Emit exactly one final block:

- **Status:** `ready` | `blocked` | `needs_clarification` | `too_large`
- **PR link** (or reason no PR was opened)
- **Files changed** (paths only)
- **Checks** — each item from `Expected checks` with pass/fail
- **Acceptance criteria** — each bullet met / unmet, one-line note if unmet
- **Notes** — short, redacted, no endpoint or token material

Do not approve / request-changes — that is the reviewer's surface (ADR-0007).
