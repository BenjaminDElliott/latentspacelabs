---
id: ADR-0020
title: Cost-class inference routing policy
status: proposed
date: 2026-05-02
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-57
  - LAT-58
  - LAT-59
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) RunPod-hosted Qwen quality, throughput, or availability stops meeting the bar for default frontline implementation work and a different cloud-GPU provider or a managed-API runtime would clearly outperform it; (b) local Qwen quality on bounded implementation tickets is independently demonstrated to be acceptable for default production use, at which point the local lane stops being fallback/dev-only; (c) a class of work emerges that none of the named lanes covers cleanly (multi-repo refactors, long-horizon agentic loops, anything that wants planner + implementer in the same process) and a new lane is warranted; (d) the per-run or per-day cost shape on RunPod or on the frontier reasoning lane drifts far enough that the band thresholds in ADR-0009 stop matching reality; (e) a security or exposure incident on the RunPod-hosted endpoint, the local endpoint, or the frontier-reasoning credential path forces a tighter posture than this ADR enumerates; (f) ADR-0019's runtime contract changes shape such that "frontline implementation lane" stops meaning "opencode + RunPod-hosted Qwen via the LAT-103/LAT-104 ticket-pack contract"; or (g) a missing-config refusal fires often enough in practice that the refusal policy itself needs revisiting (versus the upstream config gap being fixed).
---

# ADR-0020: Cost-class inference routing policy

## Context

The ICP is now expected to dispatch model work across more than one runtime. ADR-0008 fixed Perplexity as the cognitive front door and the rule matrix that governs autonomy. ADR-0009 fixed the three cost bands (`normal` / `elevated` / `runaway_risk`) and the runaway-cost interrupt protocol but left quantitative budgets open. ADR-0018 fixed the first ICP agent runtime (GitHub Actions + Claude Code Action against the Anthropic API). ADR-0019 then named **opencode + a Qwen endpoint via a self-hosted GitHub Actions runner** as the primary implementation runtime for bounded tickets, with ADR-0018 retained as the manual fallback.

Two facts on the ground have changed since ADR-0019 was drafted:

1. **The default Qwen host for frontline implementation is RunPod-hosted, not local.** The operator's own local Qwen endpoint exists and is reachable, but local Qwen quality on bounded implementation tickets has not cleared the bar to be the **default** implementation lane. RunPod-hosted Qwen (cloud GPU, accessed by opencode through the LAT-103 wrapper) is the runtime that the ICP should pick first when it dispatches a bounded implementation ticket.
2. **The local Qwen lane is not "the implementer" — it is fallback / dev / offline experimentation.** Acceptable uses are: local development of the opencode wrapper itself, offline experimentation, dry-runs against LAT-105's harness, and **scheduled / non-production work where the operator has explicitly accepted local quality for that ticket class**. It is not the default lane for production implementation runs.

This forces a question ADR-0019 deferred: when the ICP looks at a ticket and decides where to run it, **what is the policy?** ADR-0019 enumerated the runtimes; it did not name the routing rule, did not name what happens when RunPod config is missing, and did not name what cost classes the ICP must distinguish. ADR-0009's bands govern *how much* a run can spend; this ADR governs *which runtime gets the run in the first place*.

LAT-57 is the decision ticket. LAT-58 and LAT-59 are the implementation/policy follow-ons gated on the answer here (the routing implementation in the ICP and the policy/observability surface that consumes the cost-class field). This ADR fixes the routing policy; it does not write the router code, does not commit RunPod endpoint URLs, and does not set numeric dollar caps.

The two anti-patterns this ADR is written to forbid:

- **Silent fallback to local Qwen when RunPod config is missing or unreachable.** If the frontline lane is unconfigured, the ICP must refuse the run, not quietly demote it to a lane whose quality has not been accepted for default production work.
- **Silent escalation to the frontier reasoning lane when RunPod config is missing.** Frontier spend is reserved for work the routing policy classifies as frontier-reasoning. A missing-config event is not a license to charge frontier rates for what was meant to be a cheap implementation run.

## Decision Drivers

- **Anti-astronautics (`docs/decisions/README.md`).** The routing policy is owned by the ICP control plane (ADR-0012, ADR-0013); it is a piece of policy, not a new substrate. This ADR fixes the policy in prose so LAT-58 has a contract to implement against, without inventing an additional service.
- **Cost of cognition vs cost of implementation (ADR-0009).** Frontier spend should buy frontier cognition (planning, decomposition, architecture, hard debugging, review synthesis). Bounded mechanical implementation should not. The routing policy makes that split mechanical: a ticket's classification determines its lane.
- **Quality bar for default lane.** Local Qwen has not been demonstrated to clear the quality bar for default frontline implementation. RunPod-hosted Qwen has. Treating the two as interchangeable would destroy the meaning of "default lane" the moment a RunPod config gap appeared.
- **Boundary discipline (ADR-0008, ADR-0013, ADR-0019).** ADR-0019's bounded ticket-pack contract is the *only* shape opencode consumes regardless of which Qwen host backs it. Routing changes the lane; it does not change the boundary.
- **Refusal over silent demotion (ADR-0008 Stop list, ADR-0017 Rule 4).** Missing or unreachable required config for a chosen lane is a Stop, not a license to invent an alternative lane. Silent fallback violates the operator's explicit cost intent.
- **Evidence must be harvestable (ADR-0006, ADR-0014, ADR-0019).** Whichever lane runs, the run record must name the lane, the model, and any retry / re-route the policy chose. The redaction rules (ADR-0014) still apply.
- **Stay on Node/TS/npm (ADR-0011).** The router lives inside the ICP package; it is not a new service.
- **Revocability.** Adding a lane or changing a default should be a single PR diff against this ADR + the LAT-58 implementation, not a re-architecture.
- **No committed secret material and no exposed endpoints (ADR-0017 Rule 3 and Rule 6).** Endpoint URLs (RunPod-hosted Qwen, local Qwen) and any auth tokens stay out of the repo and out of artifacts. That posture is unchanged from ADR-0019.

## Considered Options

1. **No explicit routing policy.** The ICP picks a runtime per ticket via ad-hoc operator judgement; ADR-0019 names runtimes, ADR-0009 governs spend, and routing is implicit.
2. **Two lanes only — implementation (Qwen, any host) and reasoning (frontier).** The ICP treats local and RunPod-hosted Qwen as one logical lane; missing-config events on one host fall back to the other.
3. **Four explicit cost classes with refusal on missing config.** Frontline implementation is cloud-GPU Qwen (RunPod-hosted); local Qwen is a separate, opt-in fallback/dev lane; frontier reasoning is its own lane; mock is its own lane for CI/test. Missing required config refuses the run rather than silently demoting or escalating. **Accepted.**
4. **Generic "model registry + scoring function".** Build a registry of models and let a scoring function pick per ticket from arbitrary axes. Rejected for the pilot: premature, hard to audit, unbounded surface, and not what one operator with one in-flight implementation path needs to ship the next slice.

### Trade-offs

| Axis | (1) No explicit policy | (2) Two lanes (Qwen merged) | (3) Four explicit classes + refusal | (4) Registry + scoring |
|---|---|---|---|---|
| Anti-astronautics fit | Best on day one, worst as soon as a second runtime is real | Acceptable | Acceptable: small, named surface | Worst: new abstraction for one operator |
| Default-lane quality contract | None | Diluted: any Qwen is "good enough" | Strong: frontline lane = RunPod-hosted Qwen | Implicit in scores |
| Missing-config behavior | Undefined | Silent fallback to whichever Qwen is up | Refuse the run (no silent demotion or escalation) | Whatever the score returns |
| Frontier-spend protection | Weak | Weak (a missing-config event can punt to frontier) | Strong: refusal blocks accidental frontier spend | Depends on weights |
| Observability | Operator memory | "Qwen lane" obscures which host actually ran | `cost_class` + `lane_chosen` + `lane_reason` in run report | Score traces (heavy) |
| Reversibility | Trivial today, expensive once memory drifts | Single PR | Single PR / ADR diff | Substrate to undo |
| Boundary fit (ADR-0008/0013/0019) | Weak | Weak | Strong | Strong but heavyweight |

## Decision

**Accepted: Option 3.** The ICP's inference router uses **four named cost classes**, with a **refuse-on-missing-config** posture that forbids silent fallback to the local lane and silent escalation to the frontier lane.

This ADR fixes the policy. **LAT-58** implements the router inside the ICP. **LAT-59** wires the policy outputs (cost class, lane chosen, lane reason, refusal events) into the run-evidence and observability surface that ADR-0006 / ADR-0014 / ADR-0009 already shape.

### Cost classes

The router emits exactly one of four `cost_class` values for every dispatch decision. The class is fixed at routing time and does not silently change mid-run.

- **`runpod_frontline`** *(also: `cloud_gpu_implementation`)* — RunPod-hosted Qwen via opencode, dispatched through the ADR-0019 self-hosted runner + ticket-pack contract (LAT-103, LAT-104). **This is the default lane for bounded implementation tickets.** "Frontline" because it is the lane the ICP picks first when a ticket clears the routing inputs below; "cloud_gpu_implementation" is a synonym retained for cross-document continuity. The lane is unavailable when RunPod endpoint config (URL + auth, scoped per ADR-0017) is missing or unreachable from the runner.

- **`local_dev_fallback`** — Operator's own local Qwen endpoint via opencode. **Not a default production implementation lane.** Acceptable uses, in order:
  1. Local development of the opencode wrapper itself, the ticket-pack validator, and the LAT-105 dry-run harness.
  2. Offline experimentation when no production work is in flight.
  3. Scheduled / non-production work where the operator has explicitly accepted local quality for that ticket class (recorded on the ticket).
  Any non-experimental implementation run that ends up in this lane requires an explicit operator opt-in on the ticket; the router does not select this lane on its own to satisfy a frontline request.

- **`frontier_reasoning`** — Claude Sonnet / Opus or equivalent frontier-grade model, accessed through the ADR-0018 runtime path or the ICP planner's existing path. Reserved for work the policy classifies as needing frontier cognition: high-value reasoning, architecture decisions, ADR/PRD synthesis, review synthesis on substantive PRs, and hard debugging that the bounded implementer cannot reach. **Not a fallback for missing RunPod config.** Routing into this lane is on the basis of the ticket's classification, not on the basis of another lane being unavailable.

- **`mock`** — Deterministic, no-network, no-spend execution for CI, unit tests, dry runs, and any path that must not hit a real model. The mock lane is the only lane allowed to run inside `npm run check` and in CI by default. The mock lane is always available; absence of mock support is a router bug.

The four classes are exhaustive for the pilot. Adding a fifth (a different cloud-GPU provider, a managed open-weights API, a separate review-only frontier lane) lands as an ADR diff or a superseding ADR, not as a quiet router change.

### Routing inputs

The router classifies a ticket / dispatch by the following inputs. Inputs come from the ticket pack (ADR-0019 / LAT-104), the agent-ready ticket frontmatter, and the dispatch caller; the router does not invent any of them.

- **Ticket size.** Lines / files in scope, expected diff surface. Small bounded edits favour the implementation lanes; large or unbounded scope favours decomposition by the planner before dispatch.
- **Ambiguity.** Whether acceptance criteria are concrete, whether the ticket pack files-in-scope allowlist is unambiguous, whether the planner has already decomposed the work. High ambiguity routes to the planner / frontier reasoning, not to an implementer.
- **Architecture risk.** Whether the change touches durable contracts (ADRs, PRDs, persistence boundaries, the cost or autonomy surface, `.github/workflows/**`, secrets handling). Architecture-risk work routes to frontier reasoning by default; the implementation lanes are bounded and do not edit ADRs/PRDs/workflows.
- **Expected runtime.** Estimated wall-clock for the run (short bounded edits vs. long agentic loops). Long-runtime agentic work routes to a path the ADR-0009 cap can supervise; it does not silently sit in an implementation lane.
- **Concurrency need.** Whether more than one implementation run is expected to execute in parallel. The frontline lane's concurrency is bounded by the runner pool and the RunPod endpoint's throughput; routing must respect that, not exceed it.
- **Approval level.** The autonomy level / approval shape on the ticket (ADR-0008's rule matrix). Higher-stakes / higher-approval work cannot be silently shipped to the cheapest available lane; the approval shape constrains the lane set.
- **Config availability.** Whether the lane the inputs above point at has its required config present, valid, and reachable. If the chosen lane's config is missing or unreachable, the router refuses (see "Missing-config / refusal behavior" below) — it does not pick a different lane on its own.

### Lane selection rule (informal)

For any dispatch:

1. If the dispatch is a CI / test / dry-run path, the lane is `mock`. (No network, no spend, deterministic.)
2. If the work is architecture-risk, ambiguous, planning, decomposition, ADR/PRD synthesis, review synthesis, or hard-debugging, the lane is `frontier_reasoning`.
3. Otherwise — bounded implementation work consuming a valid LAT-104 ticket pack — the lane is `runpod_frontline`.
4. The lane is `local_dev_fallback` **only** when the ticket / dispatch carries an explicit operator opt-in for local execution (development, offline experimentation, or accepted scheduled work). The router does not pick `local_dev_fallback` to satisfy a request that asked for `runpod_frontline`.
5. If the chosen lane's config is missing or unreachable, the router refuses the dispatch (see below). It does not silently demote, silently escalate, or pick a neighbour lane.

### Escalation / de-escalation criteria

Movement between lanes is a deliberate routing event, not a silent retry.

- **Escalate to `frontier_reasoning`** when, *prior to dispatch*, the routing inputs reveal the work is architecture-risk, planning/decomposition, review synthesis, or a debug path the implementation lanes are not equipped for. Escalation **does not happen mid-run** as a silent retry: a failed `runpod_frontline` run does not auto-retry on `frontier_reasoning`. Re-dispatch under a different cost class is an operator action, surfaced in the run record.
- **De-escalate from `frontier_reasoning` to `runpod_frontline`** when a planner step has decomposed the work into a bounded ticket pack that meets the ADR-0019 contract. De-escalation is the planner's deliverable: it produces a ticket pack, the ICP routes the *next* run on that pack to the implementation lane.
- **De-escalate from `runpod_frontline` to `local_dev_fallback`** is **not a router-initiated move.** It only happens when the operator explicitly opts into the local lane on the ticket (development, offline experimentation, or accepted scheduled work). Missing-config or RunPod outage does **not** trigger de-escalation; it triggers refusal.
- **Move to `mock`** when the dispatcher is CI, a test path, or LAT-105's dry-run harness. The mock lane is never selected for a production implementation run.

A re-route — the same ticket re-dispatched into a different lane after a refusal or after a failed run — is a fresh routing decision, recorded as such in the run evidence, with its own `cost_class` and `lane_reason`. It is not a continuation of the prior run.

### Budget caps and stop conditions

This ADR does **not** introduce numeric per-run or per-day dollar caps. ADR-0009 is the source of truth for cost bands and the runaway-cost interrupt; this ADR adds the routing-time hooks that make those bands enforceable per lane.

- Each lane carries the ADR-0009 band semantics unchanged: `normal` / `elevated` / `runaway_risk`, one-way ratchet, runaway-cost is always a Stop.
- The router records the **expected band** for the dispatch (the band the operator and the ticket pack's `Budget cap` imply) alongside the chosen lane. Mid-run band escalation is the agent's responsibility per ADR-0009; the router does not re-route a run that is heading toward `elevated` or `runaway_risk`.
- A `runaway_risk` event in any lane halts the run per ADR-0009 §2 and is **not** a license to retry on a cheaper lane. Re-dispatch after a runaway-cost halt requires a human unblock, the same as ADR-0009 already requires.
- Quantitative dollar / token caps per lane remain an open question owned by the telemetry substrate (ADR-0014) and ADR-0009's revisit triggers. When that work lands, the router gains the ability to block a dispatch whose ticket-pack `Budget cap` is incoherent with the lane's per-call cost shape; that is a LAT-58 / LAT-59 follow-up, not this ADR's commitment.

### Missing-config / refusal behavior

This is the policy LAT-57 most needs nailed down. The router's behavior when required configuration for the chosen lane is **missing**, **invalid**, or **unreachable** is:

1. **Refuse the dispatch.** The router does not start the run.
2. **Do not silently demote to `local_dev_fallback`.** Local Qwen is not a default production implementation lane; an unconfigured RunPod is not a license to use it as one.
3. **Do not silently escalate to `frontier_reasoning`.** Frontier spend is a routing decision based on ticket classification, not a side effect of a missing-config event.
4. **Emit a `routing_refused` event** with the missing-config reason: which lane was chosen, which config item was missing or invalid, and where it was expected to come from (per ADR-0017 residence rules — environment, runner-side secret manager, etc.). The reason names the gap; it does not embed the missing value, the URL, or the token.
5. **Surface the refusal in the run-evidence path** (ADR-0006, ADR-0014) and in the Linear write-back (ADR-0003 / ADR-0008) the same way a runaway-cost interrupt is surfaced — `Halted: routing-refusal — {missing config item}` — so the operator sees the gap immediately and can either (a) fix the config and re-dispatch on the originally chosen lane, or (b) explicitly opt the ticket into the local fallback lane on the operator's own judgment.
6. **No auto-retry.** A refused dispatch is not retried on a different lane by the router. Re-dispatch is an operator action.

The refusal posture applies symmetrically:

- Missing RunPod config when `runpod_frontline` was chosen → refuse. Do not pick local. Do not pick frontier.
- Missing local-endpoint config when `local_dev_fallback` was explicitly chosen → refuse. Do not pick RunPod (the operator chose local on purpose; the router does not override).
- Missing frontier credential / runtime when `frontier_reasoning` was chosen → refuse. Do not silently retry on an implementation lane (wrong cognition class).
- `mock` is never refused for missing config; absence of mock support is a router bug, not a config gap.

### Observability fields required in run evidence

Every dispatch — whether it produces a run, a refusal, or a re-route — adds the following fields to the run-evidence record (ADR-0006's run-report envelope, ADR-0014's redaction rules, ADR-0019's evidence shape). Field names are normative for the policy; LAT-59 owns the exact schema landing.

- **`cost_class`** — one of `runpod_frontline` / `local_dev_fallback` / `frontier_reasoning` / `mock`.
- **`lane_chosen`** — the runtime actually invoked (e.g. `opencode+runpod-qwen`, `opencode+local-qwen`, `claude-sonnet-via-actions`, `mock`). Distinct from `cost_class` because a class can map to more than one concrete runtime over time.
- **`lane_reason`** — short structured reason for the routing decision: which routing inputs drove the class (e.g. `bounded-ticket-pack`, `architecture-risk`, `operator-opt-in-local`, `ci-mock`).
- **`routing_refused`** — boolean. `true` iff the router refused the dispatch.
- **`routing_refused_reason`** — when `routing_refused` is `true`, a structured reason naming the missing or invalid config item and its expected residence. Never the value itself.
- **`expected_cost_band`** — `normal` / `elevated` / `runaway_risk`, the band the routing decision implies given the ticket pack's `Budget cap` (ADR-0009).
- **`re_route_of`** — when the dispatch is a re-route after a prior refusal or halted run, the prior run / dispatch ID. Empty otherwise.
- **`config_present`** — minimal structured fact set indicating which required-config items were present at routing time, by name only (never values, never URLs, never tokens; ADR-0014 and ADR-0017 redaction rules apply).

These fields are additive to ADR-0006's existing envelope. They do not replace `cost.band`; ADR-0009's band remains the runtime-level cost signal, while `cost_class` and `expected_cost_band` are the routing-time lane and lane-implied band.

### What this ADR does *not* decide

- **Numeric per-run / per-day dollar caps.** ADR-0009's revisit trigger owns that.
- **The router's code shape.** Owned by **LAT-58**.
- **The exact run-evidence schema landing for the new fields.** Owned by **LAT-59**.
- **Endpoint URLs, RunPod tenancy details, GPU SKU, or any RunPod-specific operational config.** Out of repo per ADR-0017; the routing policy treats RunPod as a black-box endpoint with config residence rules.
- **A second cloud-GPU provider as a peer to RunPod.** Not in the pilot; revisit (a).
- **Auto-retry / auto-re-route across lanes.** Forbidden by this ADR; revisit only via a superseding ADR.
- **Whether the local Qwen lane ever becomes the default.** Revisit (b); requires independent quality demonstration.
- **The planner's own routing inside `frontier_reasoning`** (which model, which prompt, which compaction strategy). Owned by ADR-0008 / ADR-0015 and the planner's evolution; not this ADR.

## Consequences

Good:

- The default implementation lane has a single, named meaning (RunPod-hosted Qwen via opencode), and it cannot quietly become "whichever Qwen is up." Quality of the default lane stops being a function of which host happens to be reachable.
- Frontier spend is protected from accidental escalation. A missing RunPod config event cannot turn a $0.03 implementation run into a $3 frontier run, because the router refuses rather than escalates.
- Local Qwen stays a useful tool — for development, dry runs, offline experimentation, and explicitly-opted-in scheduled work — without being load-bearing for production quality.
- The cost-class field is a *routing* fact distinct from ADR-0009's *runtime* `cost.band`. Reviewers and the QA loop (ADR-0007) can ask "did this run go to the lane it should have?" separately from "did this run stay in budget once it started?"
- LAT-58 has a concrete contract (the lane set, the inputs, the refusal rule, the observability fields) and does not have to invent the policy alongside the implementation. LAT-59 has a concrete schema-shape commitment to land against ADR-0006's envelope.
- ADR-0019's bounded ticket-pack contract carries through unchanged. Routing changes which Qwen host backs `opencode`; it does not change the boundary `opencode` runs inside.
- Reversibility holds: changing a default, adding a lane, or relaxing the refusal rule is an ADR diff plus a LAT-58 PR, not a re-architecture.

Bad / open:

- **Refusal cost.** A missing RunPod config event blocks the run instead of producing a (lower-quality) result. That is the explicit trade. The cost is paid in operator latency when config drifts; the benefit is paid in not silently shipping under-quality work or accidentally burning frontier spend.
- **Operator-opt-in for local lane is policy, not yet mechanism.** The "explicit operator opt-in on the ticket" required to route into `local_dev_fallback` for non-development work is a policy commitment here; LAT-58 / LAT-59 turn it into a ticket-frontmatter field or equivalent. Until then, the policy is enforced by review, not code.
- **Quantitative caps still open.** ADR-0009's quantitative-cap gap is not closed by this ADR. A run that the policy correctly routes to `runpod_frontline` can still spend its way into `runaway_risk` if its ticket-pack `Budget cap` is wrong. The ADR-0009 interrupt remains the backstop.
- **One implementation lane is a single point of failure for default work.** When RunPod is down, default production implementation work is blocked until either RunPod comes back or the operator opts a ticket into the local lane (with the local-quality acceptance that implies). ADR-0019's "fallback exercise" cadence partially mitigates by keeping ADR-0018's path warm, but ADR-0018's path is a *manual* re-dispatch, not an auto-route.
- **Cost-class ↔ runtime mapping can drift.** `cost_class` is the durable routing concept; `lane_chosen` is the concrete runtime. If the runtime backing a class changes (a different cloud-GPU provider, a managed open-weights API), older run evidence still names the historical `lane_chosen`. That is intentional — the class is the policy axis, the lane is the operational axis — but reviewers must not conflate them.
- **No mid-run re-route increases operator burden.** A failed run does not auto-retry on a different lane; the operator decides. That is the right default for the pilot but is friction the pilot must accept until enough lane-quality data exists to trust an automatic policy.
- **Mock-lane discipline is enforced by review.** Nothing in this ADR mechanically prevents a non-CI dispatch from selecting `mock`; LAT-58 should reject `mock` for non-CI / non-dry-run callers, and LAT-59 should make that visible in evidence.

## Confirmation

The decision is working when:

- **LAT-58 lands** an ICP router that emits one of the four `cost_class` values for every dispatch, picks `runpod_frontline` by default for bounded implementation tickets, picks `frontier_reasoning` only on the routing-input criteria above, picks `local_dev_fallback` only on explicit operator opt-in, picks `mock` only for CI / test / dry-run paths, and refuses (without silent demotion or escalation) when the chosen lane's required config is missing or unreachable.
- **LAT-59 lands** the run-evidence / observability surface for the routing fields (`cost_class`, `lane_chosen`, `lane_reason`, `routing_refused`, `routing_refused_reason`, `expected_cost_band`, `re_route_of`, `config_present`), with ADR-0014 redaction applied and ADR-0006 envelope respected.
- **No silent fallback.** A missing-RunPod-config event produces a `routing_refused` event surfaced to Linear and the run report — never a quiet local-lane run, never a quiet frontier-lane run. Spot-checked at the LAT-54 retrospective loop (ADR-0010) and at QA review (ADR-0007).
- **No silent escalation.** No run lands on `frontier_reasoning` whose ticket classification did not call for it. Spot-checked the same way.
- **No endpoint material in evidence.** RunPod or local-endpoint URLs, tokens, internal hostnames, or other config values do not appear in the run report, the Linear write-back, or any artifact. Enforced by ADR-0014 redaction and `secret-guard` (ADR-0017).
- **`npm run check` remains offline and lane-independent.** The check passes whether RunPod is reachable, whether the local endpoint is up, and whether the frontier credential is valid. The router's offline behavior is enforced by tests in the `mock` lane.
- **Boundary holds.** Routing changes the lane, not the bounded ticket-pack contract. No implementation run reaches Linear, opens additional PRs, batches tickets, edits ADRs/PRDs, or edits `.github/workflows/**` because of a routing decision.
- **Scope increase = ADR diff.** Any change that adds a lane, changes the default, relaxes the refusal rule, or introduces auto-re-route across lanes lands as a PR diff to this ADR or as a superseding ADR — not as a quiet router or evidence-schema change.

Signals to revisit are enumerated in `revisit_trigger` above. The shortest paths are RunPod quality / availability drift, an independently-demonstrated local-Qwen quality bar that justifies promoting the local lane, or a refusal-rate signal that says the missing-config policy is firing more than the underlying config gap warrants.

## Links

- Related Linear issue(s): LAT-57 (this decision), LAT-58 (router implementation in the ICP — owns the code shape that selects `cost_class`, applies the routing inputs, and enforces refusal), LAT-59 (run-evidence and observability surface for the routing fields — owns the schema landing into ADR-0006's envelope and ADR-0014's redaction rules).
- Related ADRs: ADR-0006 (agent run visibility schema — run-report envelope this ADR adds fields to), ADR-0008 (agent control layer, cognitive front door, Stop list — refusal posture aligns), ADR-0009 (cost bands and runaway-cost interrupts — runtime cost backstop, distinct from routing-time class), ADR-0011 (ICP language/runtime — router lives in Node/TS), ADR-0012 (ICP software architecture — router is policy inside the control plane, not a new service), ADR-0013 (agent invocation boundary — bounded ticket-pack contract carries through), ADR-0014 (state persistence and telemetry redaction — applies to routing fields), ADR-0017 (credentials and secrets management — config residence rules govern lane-config items), ADR-0018 (first ICP agent runtime — frontier-reasoning lane uses this path), ADR-0019 (opencode + Qwen implementation runtime — the runtimes this ADR routes between).
