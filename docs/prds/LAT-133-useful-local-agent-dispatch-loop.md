---
prd_id: LAT-133-useful-local-agent-dispatch-loop
title: Useful local agent dispatch loop MVP
status: draft
owner: Ben Elliott
date: 2026-05-02
related_linear:
  - LAT-133
  - LAT-120
  - LAT-129
  - LAT-131
  - LAT-134
  - LAT-58
  - LAT-59
related_adrs:
  - ADR-0006
  - ADR-0008
  - ADR-0009
  - ADR-0013
  - ADR-0014
  - ADR-0017
  - ADR-0018
  - ADR-0019
  - ADR-0020
derived_from:
  - root-agentic-development-flywheel
supersedes:
superseded_by:
---

# PRD: Useful local agent dispatch loop MVP

- **Owner:** Ben Elliott
- **Status:** draft
- **Related Linear:** LAT-133, LAT-120, LAT-129, LAT-131, LAT-134, LAT-58, LAT-59
- **Related ADRs:** ADR-0006, ADR-0008, ADR-0009, ADR-0013, ADR-0014, ADR-0017, ADR-0018, ADR-0019, ADR-0020

## 1. Problem Statement

The ICP can now dispatch a single Linear ticket through a sandboxed control loop end-to-end (LAT-117/LAT-121/LAT-129), and ADR-0020 fixes the cost-class routing policy. In practice the loop is still **not yet useful day-to-day**: it either over-refuses bounded implementation work that the local/RunPod lane could safely do, or it accepts work — synthesis, planning, ADR/PRD drafting, architecture — that the bounded implementer cannot reason about, then either invents a wrong answer or stalls behind a refusal it cannot itself escalate. We need a focused MVP that closes the gap between "dispatcher exists" and "dispatcher actually moves bounded tickets to merged PRs without burning operator attention," while keeping non-bounded work out of the local lane entirely. The MVP must reconcile *safety* with *usefulness*: the loop must refuse the right things and accept the right things, and the evidence it leaves behind must let the operator see, on every run, why it made each call.

## 2. Goals

1. Define the **canonical local agent loop contract** the dispatcher (LAT-129), the control-loop runner (LAT-121), the routing policy (ADR-0020/LAT-58), and the evidence surface (LAT-59) all agree on, so there is one shape for "dispatch one ticket, run it, write evidence, hand control back."
2. Make the loop **useful by default on bounded implementation tickets**: a well-formed agent-ready ticket with a valid LAT-104 ticket pack and a `runpod_frontline` classification runs to a PR (or a clean refusal with cause) without operator intervention.
3. Make the loop **safely refuse non-bounded work**: ADR/PRD/planning/synthesis/architecture tickets do not run on the local/RunPod lane. They are escalated to `frontier_reasoning` or to human review with a structured reason, never silently demoted, never silently attempted on the bounded implementer.
4. Ensure every dispatch produces **observable evidence** consistent with ADR-0006's run envelope and ADR-0020's routing fields, with ADR-0014 redaction applied, so the operator and the QA loop (ADR-0007) can audit each decision.
5. Avoid **dumb over-refusal**: refusal is reserved for missing config, ambiguous scope that the bounded implementer cannot resolve, work classified as non-bounded, or risky-keyword tickets. A bounded ticket with a valid pack and a healthy lane is not refused for cosmetic reasons.
6. Pick a small, achievable MVP slice (one ticket, one process, one run) and call out polling, queueing, daemonisation, dashboards, and auto-review explicitly as fast-follows.

## 3. Non-Goals

1. **No new substrate.** This PRD does not propose a new service, a new language, or a new persistence store. The loop lives in `@latentspacelabs/icp` (Node/TS, npm) and reuses the existing dispatcher, control-loop, and ticket-pack code.
2. **No daemon, no scheduler, no auto-poll loop in the MVP.** A single invocation processes a single explicit ticket; recurring polling, label watchers, and long-running daemons are fast-follows and require their own design and approval.
3. **No queue, no concurrency, no parallel runs.** One ticket, one run, one process. Multi-ticket queueing and concurrency control are fast-follows.
4. **No dashboard, no cockpit UI.** Evidence is JSON on disk + a Linear comment. A first-class observability cockpit is owned by LAT-28 and is out of scope here.
5. **No auto-review, no auto-merge, no auto-deploy.** The loop produces a PR (or a refusal); a human still reviews and merges.
6. **No router code, no schema landing, no policy mechanism here.** Router behavior is owned by LAT-58 (ADR-0020 implementation). Run-evidence schema landing is owned by LAT-59. This PRD constrains *what those tickets must satisfy* for the loop to be useful; it does not implement them.
7. **No promotion of `local_dev_fallback` to a default production lane.** ADR-0020 keeps local Qwen as opt-in fallback / dev. This PRD does not relitigate that.
8. **No edits to ADRs, PRDs, workflows, or secrets handling from inside the loop.** ADR-0013 boundary holds.

## 4. Primary Users

1. **Operator (Ben Elliott).** Drives one ticket at a time today; needs the loop to either ship the bounded ticket or refuse it with a clear, structured reason — without manual intervention on each step.
2. **The ICP control plane itself.** Downstream tickets (LAT-58, LAT-59, future polling/queue/daemon work) consume this PRD as the contract for what the loop is and what evidence it must leave.
3. **Reviewers / QA loop (ADR-0007, ADR-0010).** Need every routing decision, refusal, and run outcome surfaced in evidence so retros and QA spot-checks can ask "did this run go to the right lane, and did it stay inside its boundary?" without re-running the work.

## 5. Operating Model / Workflow

This MVP slots into the existing Perplexity → Linear → repo flow (ADR-0001, `docs/process/operating-model.md`) without changing it:

1. Operator (or planner) lands an agent-ready ticket in Linear with the LAT-104 ticket-pack inputs and the classification fields LAT-134 will define (complexity / reasoning tags).
2. Operator invokes `npm run dispatch:next -- --mode <mock|plan|live>` with `LAT_DISPATCH_ISSUE=LAT-NN` (LAT-129's contract).
3. The dispatcher resolves config, runs ADR-0020 routing on the ticket inputs, and either:
   - Refuses (missing config, risky keywords, non-bounded classification, ambiguous scope) — posts a structured reason to Linear, leaves the issue unpromoted.
   - Dispatches into `runpod_frontline` (default) or `local_dev_fallback` (operator opt-in) for bounded work.
   - Escalates to `frontier_reasoning` or human review for ADR/PRD/planning/synthesis/architecture work — does not run it locally.
4. The control loop produces evidence; the dispatcher scrubs it (LAT-129 redaction) and posts to Linear.
5. Approval gates default to ADR-0008's pilot posture: human reviews and merges the PR. The loop never auto-approves, auto-merges, or chains tickets.

## 6. Requirements

Each requirement is marked **must** (P0), **should** (P1), or **nice-to-have** (P2). P0 items are the MVP. P1 items are the explicit fast-follows the MVP must not foreclose. P2 items are aspirational and deferred.

### 6.1 P0 — Canonical local agent loop contract (must)

- **must** Document the loop in one place (this PRD + a short section in `packages/icp/README.md`) as a single contract: inputs, outputs, exit codes, evidence shape, refusal vocabulary. The dispatcher (LAT-129), the control-loop runner (LAT-121), the router (LAT-58), and the evidence writer (LAT-59) all reference this contract.
- **must** One invocation = one ticket = one process = one run = one outcome record. No batching, no chaining, no multi-ticket loops in the MVP.
- **must** The loop never edits ADRs, PRDs, `.github/workflows/**`, secrets, or anything outside the LAT-104 ticket pack's `files-in-scope` allowlist (ADR-0013, ADR-0017, ADR-0019).

### 6.2 P0 — Evidence schema (must)

- **must** Every run, refusal, and re-route writes a record consistent with ADR-0006's run-report envelope and adds ADR-0020's routing fields (`cost_class`, `lane_chosen`, `lane_reason`, `routing_refused`, `routing_refused_reason`, `expected_cost_band`, `re_route_of`, `config_present`).
- **must** ADR-0014 redaction applies: no endpoint URLs, RunPod pod ids, tokens, or secret values in the run record or in the Linear write-back. The dispatcher's existing `redactOutput` (LAT-129) is the floor, not the ceiling.
- **must** The record includes the **complexity / reasoning tags** the router consumed (from LAT-134), so a reviewer can answer "why did the router pick this lane?" from the evidence alone.
- **must** The record includes the **refusal reason** as a structured value (one of an enumerated set: `missing_config`, `risky_keyword`, `ambiguous_scope`, `non_bounded_classification`, `pack_invalid`, `lane_unhealthy`, `runaway_risk`, `policy_stop`) plus a free-form short message. Reviewers should be able to count refusals by reason.
- **should** (P1) The evidence record is queryable by a future cockpit / dashboard without schema migration. LAT-59 owns the schema landing.

### 6.3 P0 — RunPod cold-start handling (must)

- **must** Treat RunPod cold-start as a known operational state, not a failure. The loop probes endpoint health before dispatching `runpod_frontline` work; a cold pod triggers a bounded warm-up wait (configurable, with a hard ceiling) before the run starts.
- **must** A cold-start that exceeds the wait ceiling produces a structured refusal (`lane_unhealthy`) with the elapsed wait recorded — **not** a silent demotion to `local_dev_fallback` and **not** an escalation to `frontier_reasoning` (ADR-0020 forbids both).
- **must** The warm-up wait, the probe outcome, and the elapsed cold-start time appear in the evidence record. No endpoint URLs, no pod ids, no tokens.
- **should** (P1) The warm-up ceiling is tunable per ticket (default sane, override via ticket frontmatter or env), so long-running classes can wait longer without changing the default.
- **should** (P1) Repeated cold-start failures across runs surface a `lane_unhealthy` signal the operator can act on (tighten config, kick the pod, or temporarily opt tickets into local). No auto-action.

### 6.4 P0 — Research vs implementation routing (must)

- **must** The loop distinguishes **bounded implementation** work (changes within a LAT-104 ticket pack's files-in-scope, concrete acceptance criteria, no ADR/PRD/architecture surface) from **research/synthesis/planning** work (ADR drafting, PRD drafting, architecture decisions, cross-cutting refactors, debugging that requires whole-repo reasoning, review synthesis).
- **must** Bounded implementation work is the only class that runs on `runpod_frontline` or (with operator opt-in) `local_dev_fallback`.
- **must** Research/synthesis/planning work is **never** dispatched onto the local/RunPod lane by the MVP loop. It is escalated to `frontier_reasoning` or to human review with a structured reason. ADR-0020's "no silent escalation as a fallback" rule still holds — escalation here is a *classification* decision, not a fallback for a missing-config event on the implementation lane.
- **must** The research-spike lifecycle defined for LAT-119 governs how a research item enters and exits the system; the local agent loop does not run those spikes itself.
- **should** (P1) The classifier's decision is recorded in evidence as a structured tuple (complexity tag, reasoning tag, derived class, lane chosen). LAT-134 owns the tag taxonomy; this PRD requires that whatever LAT-134 produces is what the router consumes.

### 6.5 P0 — Complexity / reasoning tags from LAT-134 (must)

- **must** Every agent-ready ticket the dispatcher accepts carries the LAT-134 classification tags (or fails the `pack_invalid` check). The router does not infer complexity at routing time from prose; it consumes structured tags.
- **must** Tags are at minimum: a complexity tag (e.g., `bounded` / `multi-file` / `cross-cutting`), a reasoning tag (e.g., `mechanical` / `interpretive` / `synthesis`), and an architecture-risk flag.
- **must** The router's lane selection is a function of (tags, ticket-pack validity, lane health, approval shape, config presence) — not of a free-form LLM read of the ticket body. This makes routing auditable.
- **must** Ambiguous or missing tags refuse the dispatch with `pack_invalid`. The loop does not guess.

### 6.6 P0 — Refusal / retry semantics (must)

- **must** Refusal is **structured, surfaced, and final-for-the-run**. It posts the structured reason to Linear, leaves the issue unpromoted, and writes the refusal into evidence. It does not loop, does not auto-retry on a different lane, does not silently demote (ADR-0020).
- **must** The refusal vocabulary is the enumerated set in §6.2. New refusal classes land as a PRD diff, not an ad-hoc string.
- **must** Operator-initiated re-dispatch after a refusal is a fresh routing decision and a fresh evidence record (`re_route_of` references the prior dispatch).
- **must** **Avoid dumb over-refusal.** A bounded ticket with valid tags, a valid pack, a healthy lane, and present config **does not** refuse for cosmetic reasons (formatting, whitespace, label gloss, etc.). Refusal is reserved for the enumerated structured causes.
- **should** (P1) The refusal-rate-by-reason is countable from evidence, so the operator can spot a misconfigured guard turning into a denial-of-service against themselves (per ADR-0020's revisit trigger (g)).

### 6.7 P0 — Approval points (must)

- **must** Default approval posture is ADR-0008's pilot: the loop produces a PR or a refusal; a human reviews and merges. No auto-approve, no auto-merge, no auto-deploy.
- **must** The loop never escalates a ticket's autonomy level on its own. If a ticket is operator-only or human-review, the loop refuses or routes to human review and records the reason.
- **must** Routing into `local_dev_fallback` requires explicit operator opt-in on the ticket (ADR-0020). The loop does not select the local lane on its own to satisfy a `runpod_frontline` request.
- **must** Anything ADR-0008's Stop list catches (deploy, secret rotation, force-push, ADR/PRD edits from a non-PRD ticket, workflow edits) is a refusal, not a run.

### 6.8 P0 — MVP scope vs fast-follow surface (must — MVP boundary)

- **must** The MVP is **explicit, single-ticket, operator-invoked**. It is `npm run dispatch:next -- --mode <mode>` with one `LAT_DISPATCH_ISSUE=LAT-NN`, exactly as LAT-129 already lands.
- **must** The following are explicitly **fast-follow (P1), not MVP**:
  - **Polling.** Label-driven or queue-driven polling for eligible tickets. Today operator names the ticket explicitly (LAT-129 already calls this out as a documented follow-up).
  - **Queue / concurrency.** Multi-ticket queueing, parallel dispatch, runner-pool concurrency control beyond what RunPod throughput already implies.
  - **Daemon / scheduler.** A long-running process that polls and dispatches without a human invoking the CLI per ticket.
  - **Cockpit / dashboard.** A visualisation of evidence, refusal rates, lane health, cold-start latency. LAT-28 owns the broader observability cockpit; this is a feeder, not a duplicate.
  - **Auto-review.** Any agent-on-agent review or auto-merge path. Reviewer is human in the MVP.
- **must** Each fast-follow gets its own Linear ticket and (where it changes scope) its own ADR or PRD diff. The MVP does not foreclose any of them — its contract is shaped so they can be added without re-architecture (e.g., the evidence schema is queryable, the loop is invoked once per ticket so a poller can call it N times, the refusal vocabulary is enumerated so a dashboard can group by reason).

### 6.9 P1 — Should-haves (fast-follows the MVP must not foreclose)

- **should** Polling / label-driven dispatch (see §6.8). Reuses the same single-ticket contract.
- **should** A small per-run health summary the operator can read at a glance (lane chosen, cold-start time, refusal reason if any), distinct from the full evidence record.
- **should** Per-ticket override of the cold-start ceiling and per-lane health probe cadence.
- **should** A QA-loop integration that reads evidence and surfaces "loop not used" or "wrong lane" patterns at retro (ADR-0010).

### 6.10 P2 — Nice-to-haves

- **nice-to-have** A first-class CLI for replaying a refusal as a re-dispatch with operator-supplied overrides (today the operator re-invokes by hand).
- **nice-to-have** Auto-suggestion (not auto-action) of which fast-follow lane (`frontier_reasoning`, human review) a refused ticket should re-dispatch into, based on its tags.
- **nice-to-have** Cross-run aggregation surfaced into the cockpit (LAT-28).

### 6.11 Non-functional requirements (must)

- **must** Stays on Node/TS/npm (ADR-0011). No Python, no pnpm, no yarn. Lives in `@latentspacelabs/icp`.
- **must** `npm run check` remains offline and lane-independent (ADR-0020). The MVP must pass `check` whether RunPod is reachable, whether the local endpoint is up, and whether frontier credentials are valid.
- **must** No committed secret material; ADR-0017 residence rules govern lane config.
- **must** Existing ADR-0009 cost-band semantics carry through: `runaway_risk` is always a Stop in any lane, refusal of a re-dispatch after a runaway-cost halt requires a human unblock.

## 7. Acceptance Criteria

PRD-level conditions for "done." These become the backbone of the implementation tickets that follow.

- [ ] This PRD is landed in `docs/prds/` and references LAT-120, LAT-129, LAT-131, LAT-58, LAT-59, and LAT-134.
- [ ] The canonical loop contract (§6.1) is documented in one place and cross-linked from `packages/icp/README.md`.
- [ ] The router (LAT-58) consumes the LAT-134 tags described in §6.5 and emits ADR-0020's routing fields plus the refusal vocabulary in §6.2.
- [ ] The evidence writer (LAT-59) lands the schema additions in §6.2 with ADR-0014 redaction and ADR-0006 envelope respected.
- [ ] RunPod cold-start handling (§6.3) is implemented and exercised in mock and live modes; cold-start time appears in evidence; ceiling overshoot produces `lane_unhealthy`, not silent demotion.
- [ ] Research/synthesis/planning tickets (§6.4) are routed to `frontier_reasoning` or human review and never run on `runpod_frontline` / `local_dev_fallback`.
- [ ] Refusal vocabulary (§6.6) is enforced; the loop does not refuse for cosmetic reasons; refusal-rate-by-reason is countable from evidence.
- [ ] Approval points (§6.7) hold: no auto-merge, no auto-approve, no autonomy escalation; operator opt-in is required for `local_dev_fallback`.
- [ ] MVP scope is explicit: polling, queue/concurrency, daemon/scheduler, dashboard, auto-review are tracked as fast-follow Linear tickets and **not** present in the MVP loop.
- [ ] `npm run check` passes offline and lane-independent.

## 8. Success Metrics

**Product metrics — is the loop useful?**

- **Bounded-ticket completion rate.** Of bounded implementation tickets dispatched in `live` mode with valid tags and a healthy lane, the share that reach a PR (or a structured refusal with cause that the operator agrees with on review) without operator intervention beyond invoking the CLI. Target: high enough that the operator stops doing the bounded work by hand.
- **Refusal-correctness rate.** Of refusals, the share the operator agrees with on retro (ADR-0010). A high disagreement rate signals dumb over-refusal — see ADR-0020 revisit trigger (g).
- **Wrong-lane rate.** Number of runs where evidence shows the lane chosen did not match the ticket's classification. Target: zero in the MVP. Any non-zero result is a router bug.

**Workflow metrics — is the loop cheap and observable?**

- **Cost per bounded run.** Median `runpod_frontline` run cost, tracked against ADR-0009's `normal` band. The MVP should keep most bounded runs in `normal`.
- **Cold-start latency distribution.** P50 / P90 of warm-up wait. Tracked to spot pod-health drift.
- **Time from intake to merged PR.** End-to-end wall-clock for bounded tickets dispatched through the loop, vs the same class done by hand.
- **Operator-intervention rate.** Number of human touches per ticket between intake and merge. MVP target: review + merge only (no mid-run touches).
- **Frontier-spend leakage.** Number of runs that landed on `frontier_reasoning` whose classification did not call for it. Target: zero.

## 9. Open Questions

Questions that do not block landing this PRD as `draft` but should be closed before approval. Each is candidate for an ADR or for a child PRD.

1. **What is the cold-start ceiling default value, and where does it live?** The MVP needs a number; ADR-0020 deliberately did not commit one. Candidate ADR: extend ADR-0009 with lane-health caps, or new ADR for runtime health policy. (LAT-131 surface.)
2. **Where do the LAT-134 complexity / reasoning tags live on the ticket?** Frontmatter on the agent-ready Linear ticket, fields in the LAT-104 ticket pack, or both? Owned by LAT-134; this PRD assumes structured tags and refuses without them.
3. **What is the canonical refusal-reason taxonomy beyond the §6.2 enumeration?** Likely needs a small ADR if/when new classes are added beyond the eight named here.
4. **How does the loop signal `lane_unhealthy` to a future poller without a daemon?** The MVP exits with a non-zero code (per LAT-129); a future poller will need a richer signal — protocol owned by the polling fast-follow, not this PRD.
5. **At what point does `local_dev_fallback` graduate?** ADR-0020 revisit trigger (b). Until then, the MVP keeps it as opt-in only. The loop should not embed assumptions that block that graduation.
6. **What's the right disagreement threshold on refusal-correctness before we relax a guard?** Likely a retro signal, not a hard threshold; document at the ADR-0010 retro template if needed.

## 10. Risks

**Product risk**

- **Dumb over-refusal eats trust.** If the loop refuses too aggressively, the operator stops invoking it and goes back to doing bounded work by hand — the MVP delivers nothing. Mitigation: the §6.2 enumerated refusal vocabulary, the refusal-correctness retro signal, and ADR-0020's revisit trigger (g).
- **Wrong-class acceptance is worse than refusal.** If the loop accepts ADR/PRD/synthesis work onto the bounded implementer, it produces wrong artifacts that *look* right and contaminate the system of record. Mitigation: §6.4 hard-routes those classes off the local lane; LAT-134 tags are required, not inferred.
- **Cold-start surprises.** A cold pod that sits past the ceiling looks like a hang to the operator. Mitigation: §6.3 surfaces cold-start time and ceiling overshoot as a structured refusal, not a silent stall.

**Process / cost risk**

- **Frontier-spend leakage via missing config.** ADR-0020 already forbids it; this PRD inherits the refusal posture so a missing-config event never escalates to `frontier_reasoning` as a fallback.
- **Local-lane silent use.** Same posture: the loop never picks `local_dev_fallback` to satisfy a `runpod_frontline` request.
- **Runaway cost in the bounded lane.** ADR-0009's runaway-cost interrupt is the backstop. The loop does not retry past a `runaway_risk` halt; re-dispatch is a human action.
- **MVP scope drift.** Polling, queueing, daemon, cockpit, and auto-review are tempting to bundle. Mitigation: §6.8 is normative; each fast-follow gets its own ticket and (where applicable) its own ADR/PRD diff.

**Reversibility**

- The MVP adds policy plus a small amount of code under `@latentspacelabs/icp`. Adding a fast-follow is a PR diff against this PRD plus a child ticket; no substrate to undo.

## 11. Dependencies

**Hard blockers**

- **LAT-134** — complexity / reasoning tag taxonomy. The router cannot do §6.4 and §6.5 without structured tags on the ticket.
- **LAT-58** — ADR-0020 router implementation in the ICP. Owns the lane-selection code shape.
- **LAT-59** — run-evidence and observability surface for ADR-0020's routing fields. Owns the schema landing.

**Recommended predecessors**

- **LAT-129** — ICP-owned Linear polling dispatcher MVP. Already on `main`; provides the single-ticket, single-process invocation contract this PRD canonicalises.
- **LAT-120** — RunPod key split / opencode argv / LAT-999 check trim. Already on `main`; clears config-residence and check-noise blockers that would otherwise produce false `missing_config` refusals.
- **LAT-131** — observability / health surface for the local lane (cold-start, lane health). Reduces the surface this PRD has to specify in §6.3.
- **LAT-119** — bounded research spike lifecycle. Defines how research items enter and exit the system, so §6.4 can hand them off cleanly.

**External**

- RunPod-hosted Qwen endpoint availability and the operator's local Qwen endpoint (ADR-0019, ADR-0020). The MVP refuses cleanly when either is unhealthy; it does not fail loud.
- Linear API availability for issue read + comment write (LAT-129 contract).

## 12. Approval & Autonomy

- **Pilot posture.** Default ADR-0008 pilot autonomy. The loop produces a PR or a refusal; humans review and merge.
- **No autonomy escalation from inside the loop.** A ticket's autonomy level is set on intake (ADR-0008). The loop refuses or escalates per §6.7; it never raises a ticket's autonomy on its own.
- **Operator opt-in for `local_dev_fallback`.** ADR-0020. Recorded on the ticket; the loop reads it, never sets it.
- **Stop list.** ADR-0008 Stop list applies in full. Deploy / secret rotation / force-push / ADR/PRD edits from a non-PRD ticket / `.github/workflows/**` edits are refusals, not runs.
- **Fast-follow tickets** that change autonomy posture (a daemon/scheduler, an auto-poller) require their own approval and may require an ADR diff before landing.

## 13. Definition of Done

- [ ] Goals (§2) met and acceptance criteria (§7) checked.
- [ ] Success metrics (§8) instrumented in evidence or explicitly deferred with a Linear follow-up.
- [ ] Open questions (§9) either resolved or escalated to ADRs / child PRDs.
- [ ] Linear and repo cross-linked: this PRD ↔ LAT-133, LAT-134, LAT-58, LAT-59, LAT-119, LAT-120, LAT-129, LAT-131.
- [ ] Fast-follow surface (§6.8) tracked as separate Linear tickets.

## 14. Links

- Linear issues: LAT-133 (this PRD), LAT-120, LAT-129, LAT-131, LAT-134, LAT-58, LAT-59, LAT-119.
- Related ADRs: ADR-0006 (run-evidence envelope), ADR-0008 (control layer & Stop list), ADR-0009 (cost bands & runaway interrupt), ADR-0013 (agent invocation boundary), ADR-0014 (telemetry redaction), ADR-0017 (credentials & secrets residence), ADR-0018 (first ICP runtime — frontier path), ADR-0019 (opencode + Qwen runtime), ADR-0020 (cost-class inference routing policy).
- Process docs: [`docs/process/operating-model.md`](../process/operating-model.md) (where it exists), [`packages/icp/README.md`](../../packages/icp/README.md) (LAT-129 dispatcher contract).
- Root PRD: [`root-agentic-development-flywheel.md`](root-agentic-development-flywheel.md).
