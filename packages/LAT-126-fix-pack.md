# opencode Ticket Pack: Fix LAT-128 RunPod loop — TypeScript lint/typecheck errors

## Header

- **Linear ID:** LAT-126
- **Pack version:** 1
- **Planner run / source:** LAT-128 local RunPod loop (manual pack)
- **Cost band:** low
- **Risk level:** low
- **Readiness status:** ready

## Goal

Fix TypeScript lint and typecheck errors so `npm run check` passes, enabling the LAT-128 RunPod dispatch loop to produce verified PR-ready output.

## Acceptance criteria

- [ ] `npm run check` passes with zero errors (warnings allowed).
- [ ] `packages/icp/src/dispatcher/ticket-pack.ts` template literal backticks are unescaped correctly.
- [ ] `packages/ticket-contract/src/validate.ts` uses `const` instead of `let` for `missingFields`.
- [ ] All `import()` type annotations in evidence-mapper use `type import()`.
- [ ] No files outside the allowlist were created or modified.

## Constraints

- **Files in scope (allowlist):**
  - `packages/icp/src/dispatcher/ticket-pack.ts`
  - `packages/ticket-contract/src/validate.ts`
  - `packages/icp/src/evidence-mapper/contract.ts`
  - `packages/icp/src/evidence-mapper/mapper.ts`
  - `packages/icp/src/validation/validate.ts`
- **Files / paths forbidden:** `.github/workflows/**`, `docs/decisions/**`, `docs/prds/**`, `package.json`, `package-lock.json`, `tsconfig.json`, any path outside the allowlist.
- **Dependency policy:** no new deps.
- **API / surface preservation:** do not modify any public export signatures.
- **Cost / budget cap:** 50k tokens / 5 minutes wall-clock.
- **Other constraints:** TypeScript Node16 module resolution (supports `type import()`).

## Related ADRs / PRDs

- ADR(s): ADR-0014 (secrets), ADR-0017 (secret handling).
- PRD(s): none.
- Related Linear: LAT-128 (RunPod loop), LAT-123 (TS guardrail).

## Reference snippets

```ts
// path: packages/icp/src/dispatcher/ticket-pack.ts
// purpose: template literals with backtick escaping — broken double-escapes
lines.push(`- **Branch:** \\`${branch}\\``);
lines.push(`- **PR title prefix:** \\`${prTitlePrefix}\\``);
```

```ts
// path: packages/ticket-contract/src/validate.ts
// purpose: missingFields should be const, not let
const missingFields: string[] = [];
```

```ts
// path: packages/icp/src/evidence-mapper/contract.ts
// purpose: type import annotations
export interface MapArgs {
  artefact_class?: type import("../observability/run-artifact.js").ArtefactClass;
  training_eligibility?: type import("../observability/run-artifact.js").TrainingEligibility;
  quality_label?: type import("../observability/run-artifact.js").QualityLabel;
}
```

```ts
// path: packages/icp/src/evidence-mapper/mapper.ts
// purpose: type import annotation
function stateToOutcome(state: string): type import("../observability/run-artifact.js").RunArtefactOutcome {
```

## Expected checks

- [ ] `npm run check` passes (typecheck, build, ADR/PRD validators, policy scan, tests).
- [ ] No new files outside the allowlist exist after the run.
- [ ] No edits under forbidden paths.

## Branch / PR rules

- **Branch name:** `lat-126-ts-lint-fix`
- **PR title prefix:** `LAT-126:` followed by a short imperative title.
- **PR base:** `main`.
- **PR body:** terse changelog + checks run + Linear issue reference.
- **One PR per ticket pack.** No batching, no auto-merge.
- **No force-push to shared branches.**

## Forbidden actions

(Inherits the template's `## Forbidden actions` block in full.)

## Evidence expectations

- PR link, files changed, checks pass/fail, acceptance criteria status, redacted run artifact, final status `ready`.

## Final status

ready
