---
id: ADR-0009
title: Cost controls and runaway-cost interrupts
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-6
supersedes:
superseded_by:
revisit_trigger: Revisit when quantitative budgets (per-run, per-day) are set; when the telemetry substrate exists and can emit spend events; or when a runaway-cost incident occurs in the pilot.
---

# ADR-0009: Cost controls and runaway-cost interrupts

## Context

ADR-0001 named cost as one of the default stop-and-ask events. ADR-0003 defined the Linear write-back contract and reserved a `cost band if elevated` field on every agent comment. ADR-0006 defined the run-report envelope with a `cost` object (`budget_cap_usd`, `spent_usd`, `input_tokens`, `output_tokens`, `cached_tokens`, `band`). ADR-0008 placed every cost-adjacent action in the rule matrix and made runaway-cost an unconditional Stop, but **deferred quantitative semantics** (Open Question #3: "Cost-band semantics: currently qualitative (`elevated`) per ADR-0003. A follow-up ADR under telemetry substrate work should make this quantitative.").

LAT-6 asks for the missing piece: *what does a runaway-cost interrupt actually do, and what does a run have to report about its spend?* Without that, "runaway-cost is Stop" is a slogan — an agent has no way to know when it has entered the runaway-cost regime, and a human reviewer has no consistent place to look for the answer.

This ADR closes the operational gap **without** pre-deciding quantitative budgets. A quantitative dollar/token cap per run or per day is explicitly a non-goal of LAT-6 and remains an open question until the telemetry substrate can enforce it.

## Decision Drivers

- Runaway-cost is already a Stop per ADR-0001, ADR-0008, and `intake-triage.md`. We need a crisp definition of *runaway-cost* that an agent or human can apply in seconds.
- The run-report and Linear write-back already carry a `cost_band` field. Agents need to know exactly **when** to emit each band and **what the Linear surface obligation is** for each band.
- The interrupt must be concrete: "stop and ask" means *halt the run, write the run report, leave a Linear write-back, and do not resume until a human explicitly unblocks.*
- Agent-ready tickets already require a `Budget cap` per `docs/templates/agent-ready-ticket.md`. That cap is the per-run trigger for the runaway-cost interrupt; this ADR makes that link explicit.
- Anti-astronautics guardrail: do not build enforcement infrastructure the pilot doesn't have. Until the telemetry substrate exists, cost reporting is self-reported by the agent into the run report + Linear write-back; the interrupt relies on the agent respecting its own cap.

## Considered Options

1. **Leave it as prose in ADR-0008 + the run-report template.** Rejected: the template tells you *where* to write the band but not *when* to transition bands or *what* the interrupt does. LAT-6 explicitly asks for cost interrupts.
2. **Set a global quantitative cap now** (e.g. $X per run, $Y per day). Rejected: LAT-6 non-goal; we do not yet have the telemetry to measure against a cap reliably, and a premature number would either be ignored or block legitimate work.
3. **Define the three cost bands as observable thresholds, tie the runaway-cost band to a concrete interrupt protocol, and require per-run reporting into the existing run report + Linear write-back surfaces. Leave the quantitative budget open.** Accepted.

## Decision

**Accepted: Option 3.** Three cost bands with behavioral definitions; a concrete runaway-cost interrupt protocol; a reporting obligation on every run regardless of band.

### Cost bands (behavioral definitions)

The `cost_band` field on the run report and write-back takes exactly one of three values. The band is evaluated at least once before the run ends and re-evaluated whenever the agent is about to take a spend-incurring action whose marginal cost it can estimate.

- **`normal`** — Projected spend for the run is on track to finish within the ticket's `Budget cap`. No unusual retries, loops, or long-context traces. This is the default.
- **`elevated`** — Any of: projected spend is trending toward the cap but not over; a retry / self-correction loop has fired more than once; a tool call unexpectedly consumed a large context window; the run has crossed ~75% of the cap with meaningful work still remaining. **Elevated is not a stop.** The run continues, but the band MUST be surfaced in the run report and in the Linear write-back's `Risks:` line. Reviewers treat `elevated` as a signal to look at the trace, not as a failure.
- **`runaway_risk`** — Any of: the run has exceeded the ticket's `Budget cap`; a loop has fired ≥3 times without visible progress on the acceptance criteria; a single action has an unknown or unbounded cost (for example, a deep recursive scrape, an unbounded LLM chain, or an action whose marginal spend the agent cannot estimate); the agent is about to invoke a new external paid service not listed in the ticket. **Runaway_risk is always a Stop** (see ADR-0008 rule matrix and severity posture). Autonomy level does not override this; L4 does not override it; an explicit human "just keep going" in a prior thread does not override it. A new human confirmation is required to resume.

`normal` → `elevated` → `runaway_risk` is a one-way ratchet within a single run: once a run has entered `elevated`, it does not downgrade itself back to `normal` in the same run; once it has entered `runaway_risk`, it halts.

### Runaway-cost interrupt protocol

When an agent detects that it is about to cross into `runaway_risk`, or is already in `runaway_risk`, it MUST:

1. **Halt immediately.** Do not take the next spend-incurring action. Do not attempt "one more retry." Do not open a PR if the PR has not already been opened.
2. **Write the run report** (`docs/templates/agent-run-report.md`) with `cost.band = "runaway_risk"`, `status` reflecting the halt, and a `Narrative` that explains **which trigger fired** (cap crossed, loop count, unknown-cost action, new external service) and **what the agent was about to do next**.
3. **Leave a Linear write-back** per ADR-0003's five-element contract. The outcome line names the interrupt verbatim (`Halted: runaway-cost interrupt — {trigger}`). `Risks:` surfaces the band. `Next action:` is always `Human decision required to resume or cancel.` A runaway-cost interrupt is `critical` severity per `operating-model.md` (severity ladder) and therefore routes to `needs-human` (Ben).
4. **Do not auto-resume.** A subsequent run may pick the ticket back up only after a human has explicitly unblocked it — either by raising the `Budget cap` on the ticket with a comment explaining why, or by re-scoping the ticket so the remaining work fits. Dispatchers (human or the future ACL) must check the write-back history and refuse to re-dispatch a ticket whose most recent run halted for runaway-cost if no human unblock comment has landed since.
5. **PRs already in flight stay open.** If the PR was opened before the interrupt, leave it open and link the run report. Do not force-push, do not close, do not squash-amend to hide the halt.

A runaway-cost halt is **not a failure of the agent**. It is the system working as designed. Review should focus on whether the `Budget cap` was right, whether the ticket was right-sized, and whether a new class of unbounded action needs to be added to the stop list.

### Reporting obligations (every run)

Every code-producing or spend-incurring agent run MUST populate:

- Run report (`docs/templates/agent-run-report.md`): `cost.budget_cap_usd`, `cost.spent_usd` (best-effort; `null` is only acceptable when the harness genuinely cannot produce a number), `cost.input_tokens`, `cost.output_tokens`, `cost.cached_tokens`, `cost.band`. The human-readable summary's `Cost band:` and `Budget state:` lines MUST match the JSON envelope.
- Linear write-back (ADR-0003): `Risks:` line MUST include the cost band when it is `elevated` or `runaway_risk`. When the band is `normal`, the write-back need not mention cost, but the run report still reports it.
- QA and PR-review reports, when produced (ADR-0007): already carry `Cost band:` fields; same rule.

Runs whose cost cannot be measured at all (e.g. an early prototype running outside a metered harness) still populate `cost.band` qualitatively and state `cost.spent_usd: null` with a note in the `Narrative` explaining why. Missing the field entirely is a reason to reject the run report in review.

### Ticket-level budget cap as the per-run trigger

`docs/templates/agent-ready-ticket.md` already requires a numeric `Budget cap: {{tokens, time, or cost}}` and refuses the `agent-ready` label without one. This ADR makes that cap operationally load-bearing:

- The ticket's `Budget cap` is the per-run trigger for `elevated` (approaching) and `runaway_risk` (exceeded).
- A ticket without a `Budget cap` MUST NOT be dispatched. This is already policy in the template's pre-flight list; the runaway-cost interrupt relies on it.
- A dispatcher that encounters an `agent-ready` ticket without a `Budget cap` must move it back to `needs-refinement` per `intake-triage.md`, not silently proceed.

### What is still open (explicit non-goals of this ADR)

- Absolute dollar or token budgets per run, per day, per project. These require the telemetry substrate to enforce; premature numbers are worse than none.
- A global daily-spend cap across all agent runs.
- Automatic enforcement of the interrupt (the pilot relies on agents to self-report; the ACL will enforce when it exists per ADR-0008).
- Billing reconciliation against the harness vendor's dashboard.

These remain open questions and should move under the telemetry substrate work when it is scoped.

## Consequences

Good:

- Every run has a defined cost band and a defined obligation to report it; reviewers know exactly where to look.
- "Runaway-cost is Stop" becomes operational: an agent knows *when* it has entered that regime and *what* to do, and a dispatcher knows *when* it may re-pick a halted ticket.
- The ticket's `Budget cap` stops being decorative — it is the per-run trigger for the interrupt, and the refusal to dispatch without one is load-bearing.
- The pilot gets meaningful cost control without spending time on enforcement infrastructure.

Bad / open:

- Enforcement is self-reported until the ACL and telemetry substrate land. A misbehaving agent can under-report its band. Mitigated by review of the run report and the Linear write-back, and by the existing L3-with-approval gate on coding agents.
- The `elevated` / `runaway_risk` triggers are qualitative (loop counts, "approaching the cap"). This is deliberate — quantitative caps are a non-goal of LAT-6 — but it means two reviewers may classify the same run differently.
- A ticket with a loose `Budget cap` will let a run drift before the interrupt fires. Addressed through ticket refinement, not this ADR.
- Until the ACL enforces, the dispatcher-refuses-re-dispatch rule is also self-policing.

## Confirmation

Working if, three months in:

- No agent run has produced a run report missing the `cost.band` field in review.
- At least one `elevated` band has been surfaced and reviewed; `elevated` is not ignored.
- If a runaway-cost interrupt has fired, the halted run has the required report + write-back + `needs-human` routing, and the ticket was not re-dispatched without a human unblock.
- The `Budget cap` on agent-ready tickets is treated as a real constraint, not a box-ticking field.
- When a new class of unbounded action surfaces, it is added to the `runaway_risk` trigger list via an ADR update rather than handled ad-hoc.

## Links

- Related Linear issue(s): `LAT-6` (this ADR), `LAT-16` / ADR-0008 (rule matrix + boundary).
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md`.
- Process: `docs/process/cost-controls.md` (operational companion), `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/intake-triage.md`, `docs/process/operating-model.md`.
- Templates: `docs/templates/agent-run-report.md`, `docs/templates/agent-ready-ticket.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`.
