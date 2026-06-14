---
name: implement-ticket
description: Execute one bounded ticket pack end-to-end — branch, edit allowlisted files, run checks, open one PR. Use only after agent-ready-ticket has cleared the pack.
---

# implement-ticket

Mechanical implementation only. The planner has already done architecture and decomposition; this skill does the edits and opens the PR.

For the full system prompt and workflow, see `docs/templates/local-agent-prompt.md`. This skill is the compact version used during agent runs.

## Preconditions

- `agent-ready-ticket` returned `ready` on the pack.
- `repo-guardrails` is loaded.
- Working tree is clean and on `main` (or up to date with it).
- `local-agent-prompt.md` has been loaded for the full expectations.

## Steps

### 1. Inspect relevant files

Before writing anything:

1. Read every file in `Constraints → Files in scope (allowlist)`.
2. Read every `Reference snippet` provided by the planner.
3. If a file is necessary but not in the allowlist, confirm it is not forbidden by `Forbidden actions`. If it is forbidden, treat it as read-only context.

**Do not** grep the repo to explore. The planner has already distilled what matters.

### 2. Form a concrete implementation plan

Before making any edits, produce a short plan in the format below. The plan is your contract with the reviewer.

```markdown
## Implementation Plan

1. Change `<file>`: <what to change, why, expected result>
2. Change `<file>`: <what to change, why, expected result>
3. ...
4. Run `npm run check`
5. Map each acceptance criterion to the corresponding change.
```

Rules:
- One item per changed file.
- State the exact change (function added, route registered, constant renamed).
- Note which acceptance criterion each item satisfies.
- If a step depends on a prior step, note the dependency.
- No item should span more than one file unless the pack names both.

### 3. Make the smallest meaningful change

For each item in the plan:

1. Edit the file. Use the reference snippets as context.
2. Prefer the smallest syntactic change: add a function, register a route, export a constant, add a single test.
3. Do not add new abstractions, interfaces, or modules unless the pack names them.
4. Do not rename anything outside what the pack requests.
5. Do not change indentation, formatting, or whitespace "while you're here."
6. Do not edit files outside the allowlist (except for read-only reference).

### 4. Avoid superficial README churn

Do **not** add links, bullets, or rows to shared READMEs (e.g. `docs/README.md`, `docs/process/README.md`, `docs/decisions/README.md`, `docs/prds/README.md`) unless:

- The ticket pack explicitly names the README in `Files in scope`, AND
- The planner notes ownership of that hub.

If a README change is needed but not explicit, note it as a "follow-up for hub owner" in the PR body instead of editing the README.

**Exception:** If the ticket specifically asks for README-only work (e.g., "add the new package to the docs index"), this rule does not apply — make the change but keep it minimal.

### 5. Map edits to acceptance criteria

After all edits are done (before running checks), produce a mapping:

```markdown
## Acceptance Criteria → Change Mapping

| # | Criterion | File changed | What satisfies it |
|---|-----------|-------------|-------------------|
| AC-1 | ... | `src/foo.ts` | Added `bar()` function |
| AC-2 | ... | `src/bar.ts` | Registered new route |
```

Every acceptance criterion must appear in this mapping. If a criterion has no corresponding change, mark it as `unmet — <reason>`.

### 6. Run checks

Run `npm run check` (the repo gate). If it fails:

- **Inside the ticket's scope:** Fix the failure and re-run. Repeat up to 3 times.
- **Outside the ticket's scope:** Stop. Report `blocked` with the failing output (redacted of secrets).

Also run any ticket-specific tests listed in `Expected checks`.

### 7. Produce review evidence

Your final output must include:

1. **Status:** `ready` | `blocked` | `needs_clarification` | `too_large`
2. **PR link** (or explicit reason no PR was opened)
3. **Files changed** (paths only)
4. **Acceptance criteria → change mapping** (from Step 5)
5. **Check results** — pass/fail for each item in `Expected checks`
6. **Run artifact** — redacted transcript (no endpoint URL, no tokens)

### 8. Commit and open PR

1. Commit with a concise imperative message. No AI attribution, no co-author lines, no marketing.
2. Push to the ticket branch.
3. Open one PR against `main`. Title prefix `LAT-NN:`. Body is terse: changelog, checks run with results, Linear issue reference. Do not paste the ticket pack into the PR body.

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
