# Cost controls and runaway-cost interrupts

Operational companion to ADR-0009 (cost controls and runaway-cost interrupts). This doc is the day-to-day rulebook a human or agent can look up without re-deriving policy.

If this doc and ADR-0009 disagree, the ADR wins until superseded. If this doc and `approval-gates-and-autonomy-rules.md` disagree, update the one that's wrong in the same PR that flagged the conflict.

## What this doc covers

- The three cost bands and when to transition between them.
- The runaway-cost interrupt protocol: what halts, what gets written, what unblocks.
- Per-run reporting obligations on every spend-incurring agent run.
- How the ticket `Budget cap` feeds the interrupt.
- How elevated and runaway bands are reviewed.

It does **not** cover absolute dollar/token budgets — those are a non-goal of the current pilot (see ADR-0009) and will land under the telemetry substrate work.

## The three cost bands

Every run's `cost.band` takes exactly one of three values. ADR-0009 has the full definitions; the one-line summary is:

| Band | Means | Run continues? | Reported where? |
|---|---|---|---|
| `normal` | Projected spend on track; no unusual retries. Default. | Yes | Run report only. Linear write-back need not mention cost. |
| `elevated` | Approaching the cap; repeated retries; unexpectedly large context; ~75%+ of cap with work remaining. | **Yes** | Run report **and** Linear write-back `Risks:` line. |
| `runaway_risk` | Cap crossed; loop ≥3 without progress; unknown/unbounded marginal cost; new paid external service. | **No — halt immediately.** | Run report, Linear write-back, `needs-human` routing. |

The progression is one-way within a single run: once `elevated`, the run does not downgrade itself back to `normal`; once `runaway_risk`, it halts.

## When to evaluate the band

At minimum:

- **Before** any spend-incurring action whose marginal cost the agent can estimate (a new tool call chain, a long-context read, an LLM turn over a big corpus).
- **After** any retry, self-correction loop, or tool error.
- **Once** near the end of the run, to set the final `cost.band` before writing the run report.

If the agent cannot estimate the marginal cost of an action it is about to take, that is itself a `runaway_risk` trigger — see the runaway triggers below.

## Runaway-cost triggers (exhaustive for now)

Any one of these puts the run into `runaway_risk`:

1. **Cap crossed.** `cost.spent_usd` (or equivalent token/time accounting tied to the ticket's `Budget cap`) exceeds the ticket's `Budget cap`.
2. **Non-productive loop.** The agent has retried the same failing step three or more times without visible progress against the acceptance criteria.
3. **Unknown marginal cost.** The agent is about to take a spend-incurring action whose cost it cannot bound (deep recursive scrape, unbounded LLM chain, "just run until it converges").
4. **New paid external service.** The ticket did not list the service; the run is about to invoke it for the first time.

If a new class of unbounded action surfaces during a run, surface it in the run report and propose adding it to this list via an ADR-0009 update — don't silently widen the allow-list.

## The runaway-cost interrupt protocol

When any trigger fires, the agent MUST execute, in order:

1. **Halt immediately.** No "one more try." No next spend-incurring action. If a PR is not yet opened, do not open one during the halt.
2. **Write the run report** (`docs/templates/agent-run-report.md`).
   - `cost.band = "runaway_risk"`.
   - `status` reflects the halt.
   - `risk_level = "critical"` (severity ladder in `operating-model.md`).
   - `Narrative` names **which trigger fired** and **what the agent was about to do next**.
3. **Leave a Linear write-back** per ADR-0003's five-element contract.
   - Outcome line: `Halted: runaway-cost interrupt — {trigger}`.
   - Evidence: run report URL, PR URL if one was opened.
   - `Risks:` includes `cost_band: runaway_risk` plus any other flagged risks.
   - `Next action:` is always `Human decision required to resume or cancel.`
   - Routes to `needs-human` (Ben). No verification recommendation can approve merge on a halted run.
4. **Leave the PR alone if it already exists.** Do not close, force-push, squash-amend, or edit the PR to hide the halt. Link the run report from the PR description or a follow-up comment.
5. **Do not auto-resume.** Exit the run cleanly. A future run may pick this ticket up only after a human has explicitly unblocked it.

## Unblocking a halted ticket

A ticket whose most recent agent run halted with `cost_band: runaway_risk` is **blocked for re-dispatch** until one of the following has happened, in writing, on the Linear issue:

- **Raise the cap.** A comment from Ben raising the ticket's `Budget cap`, with a short rationale for why the new cap is reasonable. The new cap replaces the old one for subsequent runs; the halt is considered unblocked.
- **Re-scope.** A comment from Ben narrowing the acceptance criteria so the remaining work fits under the existing cap (typically by splitting the ticket into smaller `LAT-*` issues).
- **Cancel.** A comment moving the ticket to `Cancelled` / archived. No further runs.

A dispatcher — human today, the ACL tomorrow per ADR-0008 — that encounters a ticket whose most recent write-back ended in a runaway-cost halt and finds **no subsequent unblock comment from Ben** MUST refuse to dispatch it and leave a refusal comment naming the missing unblock. Silently re-running a halted ticket is a policy violation, not a courtesy.

## Reporting obligations on every run

These are ADR-0006 / ADR-0007 obligations; LAT-6 / ADR-0009 sharpens them. Every code-producing or spend-incurring run populates:

- **Run report** (`docs/templates/agent-run-report.md`):
  - `cost.budget_cap_usd` — from the ticket's `Budget cap` (convert to USD if the cap was tokens/time; note the conversion basis in the narrative).
  - `cost.spent_usd` — best-effort. `null` only when the harness genuinely cannot produce a number; document why in the narrative.
  - `cost.input_tokens`, `cost.output_tokens`, `cost.cached_tokens` — from the harness if available.
  - `cost.band` — `normal` | `elevated` | `runaway_risk`. Never omit this field.
  - Human-readable `Cost band:` and `Budget state:` lines must match the JSON envelope.
- **Linear write-back** (ADR-0003 five-element contract):
  - `Risks:` line MUST include the cost band when it is `elevated` or `runaway_risk`.
  - `Risks:` MAY omit cost when the band is `normal`; the run report still carries it.
- **QA report and PR-review report**, when produced (ADR-0007): populate `Cost band:` consistently with the run report.

A run report missing `cost.band` is grounds for rejection in review, independent of the run's outcome. Document cannot-measure cases explicitly; do not omit.

## Review expectations

- **`normal`** runs need no special cost review. Reviewers look at correctness and the usual ADR-0007 gates.
- **`elevated`** runs get a cost glance from the reviewer: is the trace doing reasonable work, or is it spinning? If spinning, the reviewer flags it in the PR review report and in a Linear comment, and the ticket's `Budget cap` is reconsidered for future similar work.
- **`runaway_risk`** halts always route to Ben (`needs-human`). The review question is not "did the agent do the work" — the run halted. The review question is "was the `Budget cap` right, was the ticket right-sized, and is there a new class of unbounded action to add to the stop list?"

A runaway-cost halt is **not a failure of the agent**. It is the interrupt doing its job. Treat it accordingly — no blame, focused retrospective.

## The ticket `Budget cap`

`docs/templates/agent-ready-ticket.md` already requires `Budget cap: {{tokens, time, or cost — required, numeric}}` and refuses the `agent-ready` label without one. LAT-6 / ADR-0009 makes that cap operationally load-bearing:

- It is the per-run trigger for `elevated` (approaching) and `runaway_risk` (exceeded).
- A ticket without a `Budget cap` MUST NOT be dispatched; the dispatcher moves it back to `needs-refinement` per `intake-triage.md`. This is not a new rule — it is the ticket-template pre-flight enforced.
- "Reasonable", "small", or blank is not a cap. Numeric only.
- If the cap's unit is tokens or time rather than USD, the run report narrative states the conversion basis used for `cost.budget_cap_usd`.

## Interaction with autonomy levels

Cost controls do not bend to autonomy level:

- L0 / L1 / L2 / L3 / L4 all follow this doc. L5 is out of scope for the pilot regardless.
- An agent at L4 that hits `runaway_risk` halts. "Autonomous implementation" does not mean "autonomous spend."
- A prior human instruction — "just keep going until it's done" in a Perplexity thread, for example — does not override the interrupt. A new, explicit human unblock comment on the Linear issue is required.

## Where this policy lives

- ADR-0009 — the decision (`docs/decisions/0009-cost-controls-and-runaway-cost-interrupts.md`).
- This doc — the operational rulebook (`docs/process/cost-controls.md`).
- `approval-gates-and-autonomy-rules.md` — where cost-incurring actions appear in the rule matrix.
- `operating-model.md` — where the approval gate table summarizes "runaway cost is always stop-and-ask."
- `intake-triage.md` — where severity + reversibility classification names runaway-cost as an unconditional stop during triage.
- `docs/templates/agent-ready-ticket.md` — where the `Budget cap` is captured per ticket.
- `docs/templates/agent-run-report.md` / `qa-report.md` / `pr-review-report.md` — where each run records its band.

Changes to this doc or ADR-0009 are a `Stop`-category action per `approval-gates-and-autonomy-rules.md` (the *Change approval gates or autonomy rules* row). Agents may draft; humans decide; material changes require an ADR update.

## Sequencing

Hard blockers: none (LAT-15 / ADR-0005 merged; LAT-16 / ADR-0008 merged).
Recommended predecessors: LAT-14, LAT-5, LAT-8 (all complete).
Related context: LAT-16 (ADR-0008 boundary), LAT-9, LAT-10, LAT-12.
Dispatch status: ready.

## Related

- ADRs: `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md`, `0009-cost-controls-and-runaway-cost-interrupts.md`.
- Process: `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`, `docs/process/intake-triage.md`.
- Templates: `docs/templates/agent-ready-ticket.md`, `docs/templates/agent-run-report.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`.
- Linear: `LAT-6` (this policy), `LAT-16` (boundary and rule matrix).
