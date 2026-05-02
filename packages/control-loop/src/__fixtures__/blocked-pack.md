# opencode Ticket Pack: Blocked fixture for LAT-117 control loop

## Header

- **Linear ID:** LAT-998
- **Pack version:** 1
- **Planner run / source:** LAT-117 control-loop fixture (no real Linear ticket)
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** blocked

## Goal

Intentionally-blocked pack used to verify the control loop refuses before any adapter is contacted.

## Acceptance criteria

- [ ] N/A — pack is marked blocked.

## Constraints

- **Files in scope (allowlist):**
  - `packages/control-loop/src/__fixtures__/ready-pack.md`
- **Files / paths forbidden:** anything outside the allowlist.
- **Dependency policy:** no new deps.
- **API / surface preservation:** no public surface changes.
- **Cost / budget cap:** 0 — pack is blocked.
- **Other constraints:** none.

## Related ADRs / PRDs

- ADR(s): ADR-0019.
- PRD(s): none.
- Related Linear: LAT-117.

## Reference snippets

```
# none
```

## Expected checks

- [ ] `npm run check` passes.

## Branch / PR rules

- **Branch:** `lat-998-blocked-fixture`
- **PR title prefix:** `LAT-998:`
- **PR base:** `main`
- One PR. No batching. No auto-merge.

## Forbidden actions

(Inherits the template's `## Forbidden actions` block in full.)

## Evidence expectations

- This pack is blocked; no PR should ever be opened.

## Final status

blocked
