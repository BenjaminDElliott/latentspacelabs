# opencode Ticket Pack: {{Short title}}

> A **ticket pack** is the single, bounded input that the opencode + local Qwen implementation runtime consumes for one ticket per ADR-0019. It is produced upstream by the Perplexity / ICP planner during decomposition and review; the implementer (small model) consumes it as-is. The pack is the *only* shape opencode reads — a run that lacks a valid pack does not start (ADR-0019 → "Inputs (boundary in)").
>
> The pack exists to keep the small model **bounded**: one ticket, named files, named checks, no architecture decisions, no broad Linear/GitHub history, no cross-ticket batching. If a section below is unclear, the ticket is not ready for opencode dispatch — return it to the planner with status `needs_clarification` (see *Readiness / refusal statuses* at the bottom).
>
> This template is the contract LAT-103 builds opencode skills/agents/commands against, and LAT-105's dry-run harness validates. It complements (does not replace) `docs/templates/agent-ready-ticket.md`: the agent-ready ticket is the dispatcher-side pre-flight; the ticket pack is the implementer-side input shape. A ticket can be `agent-ready` without yet being packed; a packed ticket must trace back to an `agent-ready` Linear issue.

## Header

- **Linear ID:** LAT-XX
- **Pack version:** 1
- **Planner run / source:** {{ICP planner run ID, Perplexity thread, or human author}}
- **Cost band:** low | medium | high (per ADR-0009 / `docs/process/cost-controls.md`)
- **Risk level:** low | medium | high
- **Readiness status:** ready | blocked | needs_clarification | too_large (see bottom)

## Goal

One sentence. What this ticket accomplishes, stated as a concrete observable outcome. Not a theme. If it needs two sentences, the planner is packing two tickets — split first.

## Acceptance criteria

Each bullet is an objectively checkable condition the implementer can verify locally. "Returns 200 with `{...}` for input `{...}`" passes; "code is clean" fails. The implementer treats unmet criteria as a failed run and reports them, not as a reason to expand scope.

- [ ] ...
- [ ] ...

## Constraints

Hard non-negotiables the implementer must respect throughout the run.

- **Files in scope (allowlist):** explicit list of paths the implementer may create or modify. Anything not listed is read-only.
- **Files / paths forbidden:** explicit list of paths the implementer **must not** touch (e.g. `.github/workflows/**`, `docs/decisions/**`, `docs/prds/**`, ADRs, PRDs, lockfiles unless explicitly allowed).
- **Dependency policy:** may add new deps? yes / no. If yes, named allowlist.
- **API / surface preservation:** what must not change (public exports, CLI flags, schema columns, etc.).
- **Cost / budget cap:** numeric, per-run trigger for the runaway-cost interrupt (ADR-0009). Crossing it halts the run.
- **Other constraints:** secrets, migrations, schema, billing, security-sensitive surfaces — declare any that apply.

## Related ADRs / PRDs

Links only. The implementer does not re-read history; the planner has already distilled what matters into this pack. Listing references here is for traceability and for the reviewer, not for the small model to chase.

- ADR(s):
- PRD(s):
- Related Linear (read-only context, not dependency declarations):

## Reference snippets (optional)

Inlined excerpts the planner deemed necessary for the implementer to do the work without exploration. Keep short and labelled. If a snippet is needed, paste it; do not point the small model at "go read `src/foo/`" — that is broad exploration and is forbidden by `## Forbidden actions`.

```{{lang}}
// path: {{path}}
// purpose: {{why this snippet is included}}
{{excerpt}}
```

## Expected checks

Mechanical checks the implementer must run before declaring success. The implementer reports each check's pass/fail; a failing check is a failed run, not a paper-over.

- [ ] `npm run check` passes (typecheck, build, ADR/PRD validators, policy scan, tests).
- [ ] Any ticket-specific test(s) listed in `## Acceptance criteria` pass.
- [ ] No new files outside the allowlist exist after the run.
- [ ] No edits under forbidden paths.

If the ticket adds tests, name them here (file path + describe block / test name). If it doesn't add tests, the planner has already justified that on the agent-ready ticket — the implementer does not need to re-justify.

## Branch / PR rules

- **Branch name:** `lat-XX-{{short-slug}}` (one branch per ticket pack, no reuse).
- **PR title prefix:** `LAT-XX:` followed by a short imperative title (per `docs/process/operating-model.md` → *PR ↔ Linear linking convention*).
- **PR base:** `main`.
- **PR body:** terse changelog + checks run + Linear issue reference. Do not paste this ticket pack into the PR body.
- **One PR per ticket pack.** No batching, no follow-up tickets opened from inside the run.
- **No auto-merge.** PRs land in review per ADR-0019.
- **No force-push to shared branches.** Force-push to the implementer's own ticket branch is allowed before review begins.

## Forbidden actions

The implementer (small model) **must not**:

- Query broad Linear history, the project's full issue list, sibling tickets, or backlog beyond what this pack inlines. Linear MCP scope, if exposed at all, is read-only and ticket-scoped (ADR-0019 → "Non-goals").
- Query broad GitHub history, other repos, other branches, or unrelated PRs / issues. The implementer's GitHub reach is PR creation on this repo only.
- Read or write outside the `Files in scope` allowlist.
- Edit `.github/workflows/**`, ADRs (`docs/decisions/**`), PRDs (`docs/prds/**`), or any file under forbidden paths.
- Make architecture decisions, propose new ADRs, or rewrite existing ones. Architecture is the planner's surface (ADR-0008, ADR-0019).
- Add dependencies unless explicitly authorised under `Constraints → Dependency policy`.
- Write back to Linear from inside the run (ADR-0013, ADR-0019).
- Open additional PRs, batch tickets, or amend unrelated history.
- Re-run itself, retry indefinitely on a failed check, or paper over a failing `npm run check`.
- Embed or log the local Qwen endpoint URL, any auth token, internal hostnames, or any value that resembles a secret in artifacts, PR bodies, or commit messages (ADR-0014, ADR-0017).
- Self-expand scope — including "while I'm here" cleanups, drive-by refactors, or fixing unrelated lint.

When unsure whether an action is forbidden, the implementer **stops** and reports `blocked` rather than guessing.

## Small-model guidance (read first)

This pack is sized for a small model. The planner has already done the architecture and decomposition; the implementer's job is mechanical. Operate accordingly:

- **One ticket, one pack, one PR.** Do not infer related work from the codebase and pull it in.
- **No broad exploration.** Do not grep the repo to "understand the system." If a file matters, it is in `Files in scope` or pasted under `Reference snippets`. If neither, it is out of scope.
- **No architecture decisions.** Do not design new modules, abstractions, or interfaces. If the ticket's acceptance criteria require an architecture choice the pack does not specify, that is `needs_clarification`, not a freelance design call.
- **Stop when blocked.** If a constraint is ambiguous, a forbidden path is in the way, or a check fails for a reason the pack does not explain, stop and report status `blocked` (or `needs_clarification`) with a short reason. Do not invent a workaround.
- **Trust the pack.** Do not re-read ADRs/PRDs to "verify" the planner. The reviewer (downstream) is the verification path.
- **Run `npm run check` before declaring success.** A green check is required, not optional.
- **Report honestly.** A failed check, an unmet acceptance criterion, or an unreachable file is a failed run — surface it. The runtime values truthful failure over confident incorrectness.

## Evidence expectations

The implementer produces, and the runtime captures (per ADR-0014, ADR-0019):

- **PR link** (or explicit reason no PR was opened — e.g. dry-run via LAT-105 harness).
- **Files changed** (the diff is canonical; the implementer does not need to restate it).
- **Checks run and results** — explicit pass/fail for each item under `## Expected checks`.
- **Acceptance criteria status** — each criterion marked met / unmet, with a one-line note if unmet.
- **Run artifact** — opencode transcript and tool-call summary, redacted per ADR-0014 (no endpoint URL, no tokens, no internal hostnames).
- **Final status** — `ready` (success), `blocked`, `needs_clarification`, or `too_large` (see below). The implementer does not record `approve` / `request-changes` — that is the reviewer's surface (ADR-0007).

The Linear write-back happens in the planner / review path, not from inside the implementation run.

## Readiness / refusal statuses

The implementer reports exactly one of these on completion (or refusal). Anything else is a malformed run.

- **`ready`** — every acceptance criterion met, every expected check green, PR opened, evidence captured. The default success status.
- **`blocked`** — work cannot proceed because of a constraint or environment issue the pack does not authorise the implementer to resolve. Examples: a forbidden path is in the way, a required file is missing, `npm run check` fails for a reason outside this ticket's scope, the local endpoint became unavailable mid-run. The implementer reports the blocker and stops; it does not retry indefinitely or attempt to fix unrelated problems.
- **`needs_clarification`** — the pack itself is ambiguous, contradictory, or missing information the implementer cannot infer without making an architecture decision. The implementer names the missing or contradictory item and stops. The pack returns to the planner for a v2.
- **`too_large`** — the ticket exceeds the small model's effective surface (context window, file count, change span, or cognitive load). Examples: a multi-file refactor that doesn't fit in context, a repo-wide migration, a change that requires reasoning about more files than the allowlist can credibly contain. The implementer reports `too_large` early — before significant work — so the planner can either decompose further or fall back to ADR-0018's runtime per ADR-0019.

A run that ends in any status other than `ready` does not open a PR (or, if a PR was opened before the failure was discovered, the implementer marks it draft and notes the status in the PR body). Status determination is the implementer's last act before exit.

---

## Example skeleton

A minimal, filled-in ticket pack for illustration. Real packs follow the section order above; this example is intentionally tiny.

```md
# opencode Ticket Pack: Add /healthz endpoint

## Header
- Linear ID: LAT-200
- Pack version: 1
- Planner run / source: ICP-planner-run-2026-05-02-001
- Cost band: low
- Risk level: low
- Readiness status: ready

## Goal
Add an HTTP `GET /healthz` endpoint to `packages/api-server` that returns `200 {"status":"ok","sha":<git-sha>}`.

## Acceptance criteria
- [ ] `GET /healthz` responds `200` with body `{"status":"ok","sha":"<7-char-git-sha>"}`.
- [ ] Endpoint is registered in `packages/api-server/src/routes/index.ts`.
- [ ] Unit test in `packages/api-server/test/healthz.test.ts` covers the 200 response shape.

## Constraints
- Files in scope (allowlist):
  - `packages/api-server/src/routes/healthz.ts` (new)
  - `packages/api-server/src/routes/index.ts`
  - `packages/api-server/test/healthz.test.ts` (new)
- Files / paths forbidden: `.github/workflows/**`, `docs/decisions/**`, `docs/prds/**`, any path outside the allowlist.
- Dependency policy: no new deps.
- API / surface preservation: do not modify any other route handler.
- Cost / budget cap: 100k tokens / 10 minutes wall-clock.
- Other constraints: none.

## Related ADRs / PRDs
- ADR(s): ADR-0019 (runtime), ADR-0013 (invocation boundary).
- PRD(s): none.
- Related Linear: LAT-104 (this pack's contract — read-only).

## Reference snippets
\`\`\`ts
// path: packages/api-server/src/routes/index.ts
// purpose: where to register the new route
import { fooRoute } from "./foo";
export const routes = [fooRoute];
\`\`\`

## Expected checks
- [ ] `npm run check` passes.
- [ ] `npm test --workspace packages/api-server` passes, including the new `healthz.test.ts`.
- [ ] No files outside the allowlist were created or modified.

## Branch / PR rules
- Branch: `lat-200-healthz-endpoint`
- PR title: `LAT-200: add /healthz endpoint`
- PR base: `main`
- One PR. No batching. No auto-merge.

## Forbidden actions
(Inherits the template's `## Forbidden actions` block in full.)

## Evidence expectations
- PR link, files changed, checks pass/fail, acceptance criteria status, redacted run artifact, final status `ready`.

## Final status
ready
```

---

## Validation notes (for LAT-103 / LAT-105)

This template is the contract surface; a future validator (LAT-105's dry-run harness, or a stand-alone linter) is expected to enforce, at minimum:

- Header section is present and `Linear ID` matches `^LAT-\d+$`.
- `Readiness status` is one of the four enumerated values.
- `Files in scope` is non-empty and disjoint from `Files / paths forbidden`.
- `Cost band` and `Risk level` are populated (not blank, not "TBD").
- `Acceptance criteria` contains at least one bullet, and each bullet is checkbox-shaped.
- `Branch / PR rules` declares a branch name matching the ticket and a PR title prefixed with the Linear ID.
- The pack does not embed any value matching the project's secret-guard patterns (ADR-0017).

A pack that fails validation is rejected before opencode is invoked. The implementer never sees an invalid pack.
