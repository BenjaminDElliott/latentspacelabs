# opencode Ticket Pack: No-op probe for LAT-105 dry-run harness

## Header

- **Linear ID:** LAT-999
- **Pack version:** 1
- **Planner run / source:** LAT-105 dry-run harness fixture (no real Linear ticket)
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** ready

## Goal

Add a single comment to a fixture file so the LAT-105 dry-run harness can exercise a minimal, low-risk pack end-to-end.

## Acceptance criteria

- [ ] `packages/opencode-harness/src/__fixtures__/probe-target.txt` contains a single line beginning with `# probed`.
- [ ] No other files are modified.

## Constraints

- **Files in scope (allowlist):**
  - `packages/opencode-harness/src/__fixtures__/probe-target.txt`
- **Files / paths forbidden:** `.github/workflows/**`, `docs/decisions/**`, `docs/prds/**`, anything outside the allowlist.
- **Dependency policy:** no new deps.
- **API / surface preservation:** no public surface changes.
- **Cost / budget cap:** 10k tokens / 5 minutes wall-clock.
- **Other constraints:** none.

## Related ADRs / PRDs

- ADR(s): ADR-0019 (runtime), ADR-0013 (invocation boundary).
- PRD(s): none.
- Related Linear: LAT-104 (pack contract — read-only), LAT-105 (this harness).

## Reference snippets

```
# path: packages/opencode-harness/src/__fixtures__/probe-target.txt
# purpose: starting state — empty file the implementer would touch
```

## Expected checks

- [ ] `npm run check` passes.

## Branch / PR rules

- **Branch:** `lat-999-noop-probe`
- **PR title prefix:** `LAT-999:`
- **PR base:** `main`
- One PR. No batching. No auto-merge.

## Forbidden actions

(Inherits the template's `## Forbidden actions` block in full.)

## Evidence expectations

- PR link, files changed, checks pass/fail, acceptance criteria status, redacted run artifact, final status `ready`.

## Final status

ready
