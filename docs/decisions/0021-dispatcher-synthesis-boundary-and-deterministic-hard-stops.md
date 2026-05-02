---
id: ADR-0021
title: Dispatcher synthesis boundary and deterministic hard stops
status: proposed
date: 2026-05-02
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-132
  - LAT-129
  - LAT-134
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) the LAT-129 dispatcher MVP grows past one-issue-at-a-time invocation and the deterministic gate set must scale to label-driven polling without becoming a soft policy surface; (b) a Perplexity or frontier reasoning plug-in is wired in as a recommender and the boundary between "may recommend" and "may decide" needs to be re-stated against the actual call shape; (c) LAT-134's complexity / reasoning tags become structured frontmatter on agent-ready tickets and the dispatcher consumes them as first-class inputs (shape, validation, default-on-missing); (d) a near-miss occurs where a synthesis recommendation crossed into deciding (a hard blocker waived, an autonomy level escalated, a Stop-category action executed) and the deterministic gate set did not catch it; (e) the Linear write-back contract from ADR-0003 / LAT-129 changes shape such that the refusal / hard-stop signals here no longer fit; (f) a class of work emerges that the current classifier schema cannot represent (e.g. multi-implementer parallel dispatch, repo-wide migration runs) and the schema must be extended; (g) RunPod / opencode execution semantics from ADR-0019 / ADR-0020 change such that "missing RunPod config refuses" no longer maps cleanly to the dispatcher's pre-dispatch gates; or (h) human approval gates from ADR-0007 / ADR-0008 / `approval-gates-and-autonomy-rules.md` move and the dispatcher's enforcement points must follow.
---

# ADR-0021: Dispatcher synthesis boundary and deterministic hard stops

## Context

LAT-129 landed the first ICP-owned Linear polling dispatcher: `npm run dispatch:next` reads a single agent-ready ticket, applies a small set of crude risk heuristics (keyword scan, vague-title patterns, acceptance-criteria presence, description size), generates a bounded ticket pack, spawns the existing control-loop CLI, and writes a sanitised evidence comment back to Linear. One invocation = one selected ticket = one control-loop run = one Linear write-back. Promotion to *In Review* happens only on `READY_FOR_REVIEW`.

That MVP works because today's eligibility logic is a **deterministic keyword scan** in `packages/icp/src/dispatcher/select.ts`, applied to inputs the dispatcher itself reads at the boundary. There is no model-based classifier in the dispatch path. There is also no plug-in for Perplexity, no plug-in for a frontier reasoning model, and no consumption of richer ticket frontmatter.

Three forces are now pushing on that shape:

1. **Synthesis is going to want in.** ADR-0008 already named Perplexity as the cognitive front door; ADR-0020 already named `frontier_reasoning` as the lane for planning, decomposition, ADR/PRD synthesis, review synthesis, and hard debugging. As the dispatcher matures from one-shot operator-triggered runs toward label-driven polling, it will be tempting to ask a reasoning model to *decide* — "should this ticket dispatch right now?", "is this hard blocker really blocking?", "is this acceptance criteria good enough?", "what's the right cost class?". Each of those is exactly the kind of question synthesis is good at proposing and bad at being authoritative on.
2. **LAT-134 will produce richer per-ticket signals.** Complexity and reasoning tags from LAT-134 (e.g. `complexity: bounded|moderate|high`, `reasoning: implementation|synthesis|architecture`, equivalent class labels — exact field names land with LAT-134) are designed to *inform* dispatch: which lane (per ADR-0020), whether to refuse, whether human approval is required, how much budget the ticket pack should permit. They are not designed to *replace* the deterministic gates.
3. **The hard-stop posture must remain explicit.** ADR-0008's Stop list, ADR-0009's runaway-cost interrupt, ADR-0017's secrets/credential rules, ADR-0020's refuse-on-missing-config posture, and the LAT-129 risk-keyword scan all already encode "do not start the run" conditions. The dispatcher is the chokepoint that has to enforce them. If those enforcement points become a model recommendation rather than deterministic code, the chokepoint has dissolved.

The decision LAT-132 forces is the **synthesis boundary** of the dispatcher: which classes of judgement may a bounded synthesis or classification step recommend, and which classes of judgement must a deterministic gate enforce regardless of any synthesis input? The corollary: which signals are inputs to the dispatcher (consumed as data, validated at the boundary, redacted per ADR-0014) versus which are decisions the dispatcher itself makes?

This ADR fixes the boundary. It does not write the LAT-134 tag schema; it does not wire Perplexity or any frontier model into the dispatcher; it does not change the LAT-129 implementation. It defines the contract those follow-ons must land under.

The two anti-patterns this ADR is written to forbid:

- **Synthesis-as-decider.** A reasoning-model recommendation ("this ticket is fine to dispatch", "this hard blocker is stale", "this is L3-with-approval and the operator already approved similar work") is a **recommendation**, never a hard-stop waiver. The dispatcher does not consume model output as a `goto` past a deterministic gate.
- **Hard stops becoming soft.** A Stop-category condition (ADR-0008), a runaway-cost halt (ADR-0009), a missing-config refusal (ADR-0020), an unresolved hard blocker (ADR-0005), or an autonomy escalation that was not human-approved (`approval-gates-and-autonomy-rules.md`) is a **hard stop** in dispatcher code. It does not become a tunable, a confidence threshold, or a model-side judgement.

## Decision Drivers

- **Anti-astronautics (`docs/decisions/README.md`).** The synthesis boundary belongs as policy in this ADR plus a small enforcement surface in the existing dispatcher package — not as a new service, a new substrate, or a new model registry.
- **Determinism at the chokepoint (ADR-0005, ADR-0008, ADR-0013).** Dispatch is the last point where a wrong decision is cheap to catch. Hard stops must execute as deterministic code reading deterministic inputs, not as model output evaluated for compliance.
- **Recommend ≠ decide (ADR-0008's four action categories).** Synthesis steps live on the *Perplexity-direct* and *Perplexity-propose* side of ADR-0008's matrix; hard-stop enforcement lives on the *ICP-Routed* / *Stop* side. A dispatcher that consumes synthesis output without a deterministic gate in front of it has crossed the matrix.
- **Cost-class routing depends on a stable input shape (ADR-0020).** ADR-0020 already named the routing inputs: ticket size, ambiguity, architecture risk, expected runtime, concurrency, approval level, config availability. Adding LAT-134's complexity / reasoning tags as routing inputs is in-scope; replacing the deterministic refusal posture with a model-classified refusal is not.
- **Evidence harvestability (ADR-0006, ADR-0014, ADR-0019, ADR-0020).** Every recommendation, every gate firing, every refusal must land in the run-evidence record with redaction applied. Evidence schema is owned by the existing envelope; this ADR adds field-shape commitments, not a parallel telemetry channel.
- **Linear write-back is bounded (ADR-0003, LAT-129).** The write-back surface is one comment plus one optional state transition per dispatch. Synthesis recommendations are surfaced inside that comment, not as additional Linear writes, additional issues, or additional relations.
- **Refusal-over-silent-demotion (ADR-0008 Stop list, ADR-0017 Rule 4, ADR-0020).** The dispatcher refuses when a deterministic gate fires; it does not silently re-route, silently downgrade autonomy, or silently re-classify cost class to make a refusal go away.
- **RunPod / opencode execution lane is the only bounded-implementation lane (ADR-0019, ADR-0020).** Missing RunPod config refuses; the dispatcher does not silently fall through to local Qwen and does not silently escalate to frontier. The synthesis boundary does not give a recommender the ability to override that.
- **No new Markdown index tables.** This ADR does not edit shared index files, navigation tables, or generated central lists; consistent with `docs/decisions/README.md` ("filenames and frontmatter are authoritative; no hand-edited table").
- **TypeScript / Node / npm only.** No new languages or runtimes; the synthesis boundary lands in the existing `packages/icp/src/dispatcher/` surface when it lands.

## Considered Options

1. **No explicit boundary.** Let the dispatcher grow whichever synthesis hooks land first, and rely on review to catch crossings. Rejected: review caught nothing in past near-misses on autonomy levels (ADR-0010); the chokepoint must be coded.
2. **Synthesis-decides with a deterministic post-check.** Let a reasoning model classify and recommend a dispatch decision; require deterministic checks to *also* pass before the run starts. Rejected: this is the shape that erodes hard stops over time, because the model's "yes" is the load-bearing decision and the deterministic check becomes a rubber stamp that nobody reads when it agrees.
3. **Bounded synthesis recommends, deterministic gates enforce.** Synthesis (Perplexity, frontier reasoning, or any future plug-in) may produce structured *recommendations* — classifier outputs, suggested cost class, suggested routing inputs, summarisation of complexity/reasoning tags from LAT-134. The dispatcher reads those recommendations as **inputs** alongside ticket frontmatter, applies a fixed list of deterministic gates, and refuses if any gate fires regardless of what the recommender said. **Accepted.**
4. **Forbid synthesis in the dispatcher path entirely.** All classification is hand-coded heuristics (the LAT-129 keyword scan, plus extensions). Rejected: it would freeze the dispatcher at LAT-129's heuristic ceiling and would block LAT-134 / ADR-0020 from leveraging the cheap signal a bounded classifier offers; the issue is *boundary*, not *banning synthesis*.

### Trade-offs

| Axis | (1) No boundary | (2) Synthesis decides + post-check | (3) Synthesis recommends, gates enforce | (4) No synthesis at all |
|---|---|---|---|---|
| Anti-astronautics fit | Best on day one, worst the moment a reasoning plug-in lands | Acceptable, becomes worse as model trust grows | Acceptable: small, named surface | Acceptable but capped |
| Hard-stop integrity | Erodes by accident | Erodes by design (post-check rubber-stamps) | Strong: gates run regardless of recommendation | Strong but brittle |
| Use of LAT-134 signals | Whatever the implementer builds | Yes, as decisions | Yes, as inputs to gates | No |
| Cost-class routing fit (ADR-0020) | Drift-prone | Confused (model decides + router decides) | Clean: recommender produces routing inputs, router applies them | Clean but heuristic-ceilinged |
| Future Perplexity / frontier plug-in | Undefined | Plug-in is the decider | Plug-in is a recommender behind the gate | No plug-in |
| Reversibility | Costly once synthesis is wired | Costly: removing the model means re-deriving decisions | Cheap: swap or remove the recommender; gates unchanged | Cheap but no upside |
| Boundary fit (ADR-0008 / ADR-0013 / ADR-0019 / ADR-0020) | Weak | Weak | Strong | Strong |

## Decision

**Accepted: Option 3.** The dispatcher operates under a fixed boundary: **bounded synthesis or classification may recommend; deterministic gates enforce.** Synthesis output is an input to the dispatcher, structurally identical to ticket frontmatter or LAT-134 tags — read at the boundary, validated, redacted per ADR-0014, and surfaced in evidence. The decision to start a run, refuse a run, route to a cost class, or escalate to human approval is made by deterministic code in the dispatcher.

This ADR fixes the policy. The LAT-129 dispatcher stands as the implementation seam. LAT-134's tag work and any future Perplexity / frontier plug-in are gated on this boundary.

### Classifier schema (recommendation envelope)

A synthesis or classification step that wants to inform dispatch produces a single structured **recommendation envelope** consumed by the dispatcher. The envelope is data, not control flow. The dispatcher validates it at the boundary; an envelope that fails validation is treated as **no recommendation present** — the dispatcher proceeds with ticket-frontmatter inputs and the LAT-129 deterministic checks, never as a refusal-bypass.

Field-shape commitments (exact field names land with LAT-134 / the implementing ticket; this ADR fixes the shape):

- **`source`** — short structured identifier of the recommender (e.g. `perplexity`, `frontier-reasoning-claude-sonnet`, `lat-134-tagger`, `mock`). Distinguishes plug-ins for evidence and for revocation; the dispatcher does not treat any source as authoritative over deterministic gates.
- **`complexity_tag`** — one of a small enumerated set produced by LAT-134 (e.g. `bounded` / `moderate` / `high`, with the canonical enum landing in LAT-134). Recommends how much surface the ticket pack should permit.
- **`reasoning_tag`** — one of a small enumerated set produced by LAT-134 (e.g. `implementation` / `synthesis` / `architecture`). Recommends which ADR-0020 cost class the routing layer should pick.
- **`recommended_cost_class`** — one of `runpod_frontline` / `local_dev_fallback` / `frontier_reasoning` / `mock`. Recommendation only; the dispatcher consults ADR-0020's routing inputs and overrides the recommendation if any deterministic gate disagrees.
- **`routing_inputs`** — structured restatement of the ADR-0020 inputs the recommender observed: ticket size estimate, ambiguity assessment, architecture-risk flag, expected-runtime estimate, concurrency need, approval-level reading. Each is a recommendation the dispatcher cross-checks; none waives a hard stop.
- **`risk_flags`** — structured list of flags the recommender wants the dispatcher to consider (e.g. `touches-workflows`, `secret-rotation`, `spans-many-files`, `vague-acceptance`). The dispatcher treats `risk_flags` as a strict superset of the LAT-129 keyword scan: a flag added by the recommender that maps to a Stop-list category is honoured; a flag *omitted* by the recommender is never a license to skip the deterministic scan.
- **`confidence`** — the recommender's self-reported confidence in the envelope as a whole. Recorded in evidence; **never load-bearing**. The dispatcher does not branch on it; a "high-confidence" recommendation does not waive any gate.
- **`rationale`** — short prose rationale, surfaced to the operator in the Linear write-back. Redaction (ADR-0014) applies; rationale must not embed config values, URLs, or token-shaped strings.

The envelope is **schema-validated** at the dispatcher boundary. Unknown fields are dropped (or rejected, depending on the LAT-134 implementation choice). Required fields missing: the envelope is treated as absent.

### Validation boundary

The dispatcher reads the recommendation envelope, the ticket frontmatter, the ticket-pack inputs, and the runtime configuration **once at the boundary**, the same way LAT-129 already reads `LINEAR_API_KEY` and `LAT_DISPATCH_ISSUE` once at the boundary. Validation responsibilities at that boundary:

- **Shape validation.** Each input must match its declared schema. Out-of-enum values for `complexity_tag`, `reasoning_tag`, or `recommended_cost_class` reduce the envelope to absent for those fields; they do not crash the dispatcher and do not waive any gate.
- **Provenance.** The recommendation envelope's `source` is recorded in evidence. The dispatcher does not gate decisions on which `source` produced the envelope (that is a future ADR if it ever becomes load-bearing).
- **Redaction at the boundary (ADR-0014).** No envelope field, no rationale, no Linear write-back ever embeds token-shaped strings, RunPod pod IDs, endpoint URLs, or other secret-shaped material. The dispatcher's existing `redactOutput` (per LAT-129) is the floor; the recommendation envelope is fed through the same path.
- **Idempotence.** The dispatcher computes its decision deterministically from `(ticket, frontmatter, envelope, runtime config)`. Re-running with the same inputs produces the same decision. A recommender that emits non-deterministic output (e.g. timestamps, run IDs in the rationale) does not destabilise the dispatcher's decision; only the recommendation's evidence imprint changes.
- **Boundary, not control flow.** The validation step never invokes the recommender. Recommenders are out-of-process producers; their output is a serialised envelope the dispatcher reads. The dispatcher does not call Perplexity / a frontier model from inside a gate.

### Hard blockers (deterministic gates)

The following are **hard stops in dispatcher code**. Each is a deterministic check on inputs the dispatcher itself reads. None is waivable by a recommendation envelope. None is downgraded by `confidence`. Firing any one of them produces a refusal: the dispatcher does not start the run, does not silently re-route, does not silently re-classify cost class.

1. **Unresolved hard blocker (ADR-0005).** Any item in the ticket's `Hard blockers:` line that is not in `Done` / `Cancelled` / `Superseded` at dispatch time. The dispatcher re-verifies against Linear at dispatch even if a cached `Dispatch status` says `ready`.
2. **Stop-category action (ADR-0008, `approval-gates-and-autonomy-rules.md`).** Anything the rule matrix marks as Stop without an explicit, in-scope human approval recorded against this ticket: deploys, merges to main, secret rotation, autonomy-rule edits, approval-gate edits, ADR/PRD edits from inside an implementation run, `.github/workflows/**` edits from inside an implementation run, raising autonomy beyond the pilot default.
3. **Missing acceptance criteria (LAT-129).** Ticket description does not contain an acceptance-criteria heading or marker per the existing `select.ts` rules.
4. **Vague-title pattern (LAT-129).** Title matches a vague-planning pattern (`investigate`, `explore`, `think about`, `discuss`, `plan` as leading verb) without an explicit operator-approved override on the ticket.
5. **Risk-keyword scan (LAT-129).** Title or description matches the deterministic keyword scan (deploys, production, secrets, credentials, token rotation, architecture decision, broad refactor, rewrite, etc.). The recommendation envelope's `risk_flags` extend this set; they do not subtract from it.
6. **Oversize description (LAT-129).** Description length above the dispatcher's threshold without an explicit operator-approved override.
7. **Missing required runtime config (ADR-0019, ADR-0020).** Required RunPod config absent / invalid / unreachable when the chosen cost class is `runpod_frontline`. The dispatcher refuses with a `routing_refused` reason naming the missing item by name (per ADR-0017 / ADR-0014); it does not silently demote to `local_dev_fallback` and does not silently escalate to `frontier_reasoning` (ADR-0020).
8. **Runaway-cost band on the implied budget (ADR-0009).** The ticket pack's `Budget cap` implies a cost band of `runaway_risk` for the chosen lane. Refuse; ADR-0009's interrupt is the runtime backstop, but the dispatcher does not start a run whose pre-flight budget already classifies as runaway.
9. **Autonomy escalation without approval (ADR-0008, `approval-gates-and-autonomy-rules.md`).** The dispatch implies an autonomy level above the pilot default for the agent class without a human approval recorded on the ticket. Refuse.
10. **Stale or absent ticket frontmatter contract (ADR-0019, LAT-129).** Files-in-scope allowlist absent or incoherent, ticket-pack contract not satisfiable from the frontmatter, or the ticket pack would have to be invented rather than read.
11. **Recommendation envelope claims a Stop-category action.** If the envelope's `risk_flags` or `routing_inputs` indicate a Stop-category action even when the LAT-129 scan would have missed it, the dispatcher refuses. Recommenders may *add* Stops; they cannot *remove* them.
12. **Cost class disagreement that crosses a Stop boundary.** If the recommended cost class and the deterministic routing inputs disagree in a way that would route a Stop-category action through an implementation lane (ADR-0020), refuse. The dispatcher does not paper over a Stop with a cheaper lane.

A refusal produces a `dispatch_refused` event in the run evidence (the LAT-129 redaction path applies) and a Linear write-back that names the gate that fired and, where applicable, the missing input. No deterministic gate's reason is ever a model rationale string; the reason is a structured identifier the operator can act on.

### Human approval gates

These remain as ADR-0007 / ADR-0008 / `approval-gates-and-autonomy-rules.md` define them. The dispatcher's role is to **enforce that an approval that is required has been recorded against the ticket** before dispatch — not to invent new gates.

- **Project creation, merge, deploy, secret rotation, autonomy-rule edits, approval-gate edits, ADR/PRD edits from inside an implementation run, `.github/workflows/**` edits from inside an implementation run, and raising autonomy beyond the pilot default** continue to require explicit operator approval on the ticket. The dispatcher refuses absent that approval.
- **L3-with-approval ICP-routed coding work** continues to require operator approval per the rule matrix. The dispatcher checks the approval marker on the ticket and refuses if missing.
- **Re-dispatch after a refusal** is an operator action (consistent with ADR-0020 `routing_refused`). The dispatcher does not auto-retry across gates and does not auto-retry across cost classes.
- **Recommendation envelopes do not record approvals.** Approvals live on the ticket (Linear), not in a recommender's output. A model rationale cannot constitute approval.
- **Severity-mapped approval (ADR-0007).** When QA / review evidence assigns a severity that maps onto an existing approval gate, the dispatcher honours the mapping; it does not synthesise a different mapping.

### Evidence requirements

Every dispatch — start, refusal, or re-route — adds the following to the run-evidence record (additive to the ADR-0006 envelope, the ADR-0014 redaction rules, the ADR-0019 evidence shape, and the ADR-0020 routing fields). Field names are normative; the implementing ticket owns the schema landing.

- **`dispatcher_decision`** — one of `dispatched` / `refused` / `re_routed`.
- **`gate_fired`** — when `refused`, structured identifier of the gate that fired (one of the hard-blocker list above; no free-text reasons).
- **`recommendation_envelope_present`** — boolean. `true` iff a recommendation envelope was read and validated at the boundary.
- **`recommendation_envelope_source`** — when present, the recommender's `source` identifier.
- **`recommendation_envelope_summary`** — when present, the validated, redacted snapshot of the envelope's recommendation fields (`complexity_tag`, `reasoning_tag`, `recommended_cost_class`, `risk_flags`, `confidence`). Rationale is included only after redaction.
- **`recommendation_overridden`** — boolean. `true` iff a deterministic gate produced a decision that disagreed with the recommendation (e.g. recommender said "dispatch", a gate fired and refused; recommender said `runpod_frontline`, the routing layer chose `frontier_reasoning` based on architecture-risk inputs).
- **`recommendation_override_reason`** — when `recommendation_overridden` is `true`, structured identifier naming the gate or routing input that drove the override.
- **`approval_gates_consulted`** — structured list of the approval gates the dispatcher checked for this ticket and whether each was satisfied.
- **`hard_blockers_evaluated`** — structured list naming each hard-blocker check that ran for this dispatch and its outcome (`pass` / `fail` / `n/a`).

These are additive to ADR-0020's `cost_class`, `lane_chosen`, `lane_reason`, `routing_refused`, `routing_refused_reason`, `expected_cost_band`, `re_route_of`, and `config_present`. ADR-0020 fields describe routing; ADR-0021 fields describe the dispatch decision and its gates.

The Linear write-back surface (per ADR-0003 and the LAT-129 sanitised-comment shape) adopts the same structured fields, summarised. The write-back is one comment per dispatch; this ADR does not introduce additional Linear writes.

### Future Perplexity / frontier plug-in boundary

When (not if) Perplexity or a frontier reasoning model is wired in as a recommender:

- The plug-in produces a recommendation envelope and writes it where the dispatcher can read it (file in the run workspace, structured stdout from a planner step, an ICP-side artifact — implementation choice owned by the wiring ticket).
- The dispatcher reads the envelope through the validation boundary above. It does not call the plug-in synchronously from inside any gate.
- The plug-in **may recommend** any field in the envelope: complexity / reasoning tags, cost class, routing inputs, risk flags, rationale.
- The plug-in **may not** waive a hard-blocker check, modify approval requirements, edit ADR/PRD content from inside the dispatch path, write Linear native relations from inside the dispatch path, raise autonomy, change the cost-class routing rule, or override `routing_refused` posture.
- The plug-in is a recommender, not a fallback. Plug-in unavailability never silently demotes a refusal into a dispatch; it produces "no envelope present" and the dispatcher uses ticket-frontmatter inputs and the LAT-129 deterministic checks.
- The plug-in's surface is the recommendation envelope plus the run-evidence record. It does not gain additional Linear write surface, additional GitHub write surface, or additional repo-edit reach by virtue of being a recommender.
- A second or third recommender (e.g. LAT-134 tagger and a Perplexity plug-in producing envelopes for the same ticket) is reconciled by simple precedence in the dispatcher: deterministic ticket frontmatter > LAT-134 tagger output > Perplexity / frontier plug-in. The dispatcher does not vote between recommenders. The reconciliation rule itself is deterministic code.

### Interaction with cost-class routing (ADR-0020)

The recommendation envelope **feeds** ADR-0020's routing inputs; it does not **replace** them.

- The recommender's `recommended_cost_class` is one input among the ADR-0020 inputs. The router applies the rule already fixed in ADR-0020 and may select a different class. When it does, `recommendation_overridden` records the disagreement.
- ADR-0020's refuse-on-missing-config posture continues unchanged: missing RunPod config refuses regardless of any recommendation; the dispatcher does not silently demote to `local_dev_fallback` and does not silently escalate to `frontier_reasoning`.
- ADR-0020's exhaustive cost-class set (`runpod_frontline` / `local_dev_fallback` / `frontier_reasoning` / `mock`) is also exhaustive for the recommendation envelope's `recommended_cost_class`. This ADR does not introduce a fifth class; adding one is an ADR diff to ADR-0020 / a superseding ADR per its revisit triggers.
- LAT-134's `complexity_tag` / `reasoning_tag` map onto ADR-0020's routing inputs (`bounded` / `moderate` / `high` informs ticket-size and architecture-risk inputs; `implementation` / `synthesis` / `architecture` informs which ADR-0020 cost class the routing rule selects). The mapping is encoded in the dispatcher; it is not delegated to a model.

### Linear writeback (ADR-0003 + LAT-129)

The LAT-129 sanitised-comment shape is preserved. This ADR commits to:

- **One comment per dispatch.** Whether the dispatch starts a run, refuses, or re-routes, a single Linear comment summarises the decision, the gate(s) that fired (if refused), the cost class chosen, the recommendation envelope's redacted summary, and a pointer to the run-evidence record.
- **State transition only on `READY_FOR_REVIEW`.** Unchanged from LAT-129. No state change on refusal; no state change on a re-route to another lane.
- **No model rationale embedded as authoritative.** Rationale strings appear only as "the recommender said X"; the comment does not present them as the dispatcher's reason for the decision.
- **No new Linear writes.** Native-relation writes, additional issue creation, label changes — out of scope here. ADR-0003 and the existing dispatcher write-back surface are the contract.

### RunPod / opencode execution (ADR-0019, ADR-0020)

The bounded-implementation lane is unchanged.

- **Local RunPod / Qwen / opencode is the bounded implementation lane.** Routing into this lane requires the LAT-103 / LAT-104 ticket-pack contract per ADR-0019; missing config refuses per ADR-0020.
- **Perplexity / frontier reasoning handles high-value synthesis / architecture.** As a recommender to the dispatcher and as the cost-class destination for work the routing layer classifies as `frontier_reasoning` — never as a hard-stop waiver, never as a fallback for a missing implementation lane.
- **Missing RunPod config refuses.** Hard blocker #7 above. No silent local fallback, no silent frontier escalation. Symmetric to ADR-0020.
- **No silent local fallback or frontier escalation.** Restated as a dispatcher hard blocker so that the property is enforced at the dispatch chokepoint, not only at the routing layer.

### Complexity / reasoning tags from LAT-134 as dispatch inputs

When LAT-134 lands the per-ticket complexity / reasoning tags:

- **Tags arrive as ticket frontmatter** (preferred; deterministic, persistent, reviewable in PRs) **or as recommendation envelope fields produced by LAT-134's tagger** (acceptable; subject to the validation boundary above).
- **Tags are inputs, not gates.** A `reasoning: synthesis` tag recommends that the routing layer pick `frontier_reasoning`; it does not constitute approval for a Stop-category action. A `complexity: bounded` tag recommends that the routing layer pick `runpod_frontline`; it does not waive an unresolved hard blocker.
- **Tags may add Stops, never remove them.** A `complexity: high` tag may push the dispatcher toward refusal (e.g. the ticket pack's surface exceeds the bounded-implementation lane's contract); a `complexity: bounded` tag never overrides the LAT-129 risk-keyword scan.
- **Default-on-missing.** When LAT-134 tags are absent, the dispatcher uses ticket-frontmatter inputs and the LAT-129 deterministic checks. Missing tags are never a refusal; missing tags are never a license to skip deterministic checks.
- **Schema reconciliation.** If LAT-134's canonical enum disagrees with this ADR's example enum (`bounded` / `moderate` / `high`, `implementation` / `synthesis` / `architecture`), LAT-134's enum is authoritative. This ADR fixes the *role* of the tags; LAT-134 fixes the *enum*.

### What this ADR does *not* decide

- **The LAT-134 tag enum or schema landing.** Owned by LAT-134.
- **The Perplexity / frontier plug-in's code shape, transport, or invocation cadence.** Owned by the wiring ticket.
- **Numeric per-run / per-day dollar caps.** ADR-0009 / ADR-0020 own that.
- **A second cloud-GPU implementation lane.** ADR-0020 revisit triggers own that.
- **Auto-retry / auto-re-route across lanes.** Forbidden by ADR-0020; this ADR reinforces the same posture at the dispatch chokepoint.
- **Label-driven polling at scale.** LAT-129's documented next step. The synthesis boundary defined here applies to that follow-on without amendment.
- **A model registry, scoring function, or recommender voting layer.** Out of scope; reconciliation is deterministic precedence per above.
- **The exact run-evidence schema landing for the new fields.** Owned by the implementing ticket; ADR-0006 / ADR-0014 / ADR-0020 are the surrounding contracts.

## Consequences

Good:

- **Hard stops stay hard.** The Stop list (ADR-0008), the runaway-cost interrupt (ADR-0009), the missing-config refusal (ADR-0020), the unresolved-hard-blocker rule (ADR-0005), the autonomy gates (`approval-gates-and-autonomy-rules.md`), and the LAT-129 risk scans all execute as deterministic code. A reasoning model cannot waive any of them.
- **Synthesis still earns its keep.** Bounded synthesis can recommend cost class, complexity / reasoning tags, additional risk flags, and rationale. The dispatcher reads the recommendation as data and uses it where it is useful (routing inputs, evidence, write-back rationale) without ever delegating control flow.
- **LAT-134 has a concrete contract.** The complexity / reasoning tags have a defined role (dispatch inputs that map onto ADR-0020 routing inputs), a defined non-role (not gate waivers), and a defined default-on-missing posture (deterministic checks unaffected).
- **A Perplexity / frontier plug-in has a concrete boundary.** When wiring lands, there is no architecture decision to re-litigate: produces an envelope, validated at the boundary, never gates control flow.
- **Cost-class routing fits without changes.** ADR-0020's inputs and refusal posture are honoured at the dispatch chokepoint and at the routing layer; the two layers cannot disagree silently because the dispatcher records `recommendation_overridden` whenever they would.
- **Linear write-back stays bounded.** One comment per dispatch, ADR-0003 contract, redaction applied. No new write surface for recommenders.
- **Reversibility holds.** Removing a recommender, swapping a recommender, or adding a recommender is a swap of envelope producers; the gate set does not change. Adding a gate, changing a gate's condition, or changing the precedence rule is an ADR diff against this file plus the dispatcher PR — not a re-architecture.

Bad / open:

- **Refusal cost.** A recommender that adds a risk flag the LAT-129 scan would have missed is a refusal even when an operator might have judged the work fine. That is the explicit trade — recommenders may add Stops, never remove them — and the cost is paid in operator latency on edge cases. The benefit is paid in not silently shipping work that crossed a Stop boundary.
- **Operator burden on ticket frontmatter.** Some hard-blocker checks (acceptance-criteria presence, files-in-scope allowlist, autonomy approval marker, oversize override) lean on ticket frontmatter discipline. Until LAT-134 / structured frontmatter lands, those checks are partially keyword-driven. Mitigated by review and by the existing LAT-129 scans.
- **Recommendation envelopes can become a back-channel for free-form rationale.** The redaction rule (ADR-0014) and the `rationale` redaction floor partially mitigate; the longer mitigation is reviewing recommender output the same way QA review (ADR-0007) reviews QA evidence.
- **Two enums in flight.** This ADR uses example complexity / reasoning enums; LAT-134 may pick different labels. The reconciliation rule ("LAT-134's enum is authoritative") works but means a small docs-edit when LAT-134 lands. Acceptable: that edit is to the ADR-0021 example, not to the policy.
- **No mid-run synthesis re-evaluation.** A recommender does not get to re-classify mid-run; the envelope is read once at the boundary. That is intentional but means a long-running implementation that drifts toward `runaway_risk` is caught by ADR-0009's interrupt, not by a synthesis re-classification. This ADR does not introduce a new mid-run channel.
- **One ICP package owns the gates.** The deterministic gate set lives in `packages/icp/src/dispatcher/`. If a future runtime invokes the bounded-implementation lane outside that package, the gates must move or be wrapped; otherwise the synthesis boundary leaks. Mitigated by the ADR-0019 / ADR-0020 contract that the bounded-implementation lane is reached *through* the ICP, but worth flagging for revisit (a).
- **Mock-lane discipline is enforced by review.** Same caveat as ADR-0020: nothing here mechanically prevents `mock` from being chosen for a non-CI dispatch. Implementation must continue to reject `mock` for non-CI / non-dry-run callers.

## Confirmation

The decision is working when:

- **No model recommendation has waived a hard blocker.** Spot-checked at QA review (ADR-0007) and at the retro loop (ADR-0010). A `dispatch_refused` event paired with a recommendation that said "dispatch" should appear and be unremarkable; a successful dispatch paired with an unresolved hard blocker should never appear.
- **No silent demotion or escalation across lanes.** A missing-RunPod-config event produces a `dispatch_refused` (this ADR) plus a `routing_refused` (ADR-0020), surfaced to Linear and the run report — never a quiet local-lane run, never a quiet frontier-lane run.
- **`recommendation_overridden` is observable and acted on.** When a recommendation disagrees with a deterministic gate, the override is recorded. Patterns of frequent override are a signal to revisit the recommender, not the gate set.
- **LAT-134 tags arrive as inputs.** When LAT-134 lands, complexity / reasoning tags appear in `recommendation_envelope_summary` (or in ticket frontmatter consumed directly), the routing layer maps them onto ADR-0020 cost classes, and missing tags do not cause refusals.
- **`npm run check` remains offline and recommender-independent.** The check passes whether Perplexity is reachable, whether a frontier plug-in is wired, and whether LAT-134's tagger is up. No gate consults a recommender at check time.
- **No new Linear write surface for recommenders.** Recommenders never open issues, never write native relations, never change labels, never change ticket state. The dispatcher's one-comment-plus-state-on-`READY_FOR_REVIEW` write-back stands.
- **No endpoint material in evidence.** No recommender's rationale string surfaces a RunPod URL, a token, an internal hostname, or any other config value. Enforced by ADR-0014 redaction and `secret-guard` (ADR-0017).
- **Boundary holds.** Adding a recommender or swapping a recommender does not require touching the gate set. Adding or relaxing a gate is an ADR diff against this file. Auto-retry across lanes does not appear in the dispatcher.
- **Refusal posture is symmetric.** Missing RunPod config refuses; missing local-endpoint config when local was explicitly chosen refuses; missing frontier credential when frontier was chosen refuses; `mock` is never refused for missing config (absence of mock support is a bug). Same as ADR-0020.

Signals to revisit are enumerated in `revisit_trigger` above. The shortest paths are a near-miss where a synthesis recommendation shaped a decision past a deterministic gate, an LAT-134 tag schema landing that requires re-stating the input shape, or a Perplexity / frontier plug-in wiring whose call shape forces a re-statement of "may recommend, may not decide".

## Links

- Related Linear issue(s): LAT-132 (this decision), LAT-129 (dispatcher MVP that this ADR fixes the synthesis boundary for), LAT-134 (complexity / reasoning tags consumed as dispatch inputs).
- Related ADRs: ADR-0003 (Linear persistence boundary — write-back contract), ADR-0005 (Linear dependency and sequencing model — hard blockers), ADR-0006 (agent run visibility schema — evidence envelope this ADR adds fields to), ADR-0007 (QA / review evidence workflow — severity-mapped approval), ADR-0008 (agent control layer and Perplexity boundary — four action categories, Stop list), ADR-0009 (cost controls and runaway-cost interrupts — runtime backstop), ADR-0011 (ICP language and runtime — TypeScript/Node), ADR-0012 (ICP software architecture — gates live in the control plane, not a new service), ADR-0013 (agent invocation and integration boundaries — bounded ticket-pack contract), ADR-0014 (state persistence and telemetry redaction — applies to recommendation envelopes), ADR-0017 (credentials and secrets — config residence rules), ADR-0018 (first ICP agent runtime — frontier-reasoning lane uses this path), ADR-0019 (opencode + Qwen implementation runtime — bounded-implementation lane), ADR-0020 (cost-class inference routing policy — routing layer this ADR feeds inputs to).
- Related process: `docs/process/approval-gates-and-autonomy-rules.md` (rule matrix this ADR enforces at the dispatch chokepoint).
