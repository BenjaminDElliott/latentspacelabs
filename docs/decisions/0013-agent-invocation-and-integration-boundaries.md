---
id: ADR-0013
title: Agent invocation and integration boundaries
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-21
  - LAT-65
  - LAT-66
  - LAT-68
supersedes:
superseded_by:
revisit_trigger: Revisit when a second concrete agent type (QA, PR review, SRE/deploy) is bound to the agent invocation adapter; when a non-coding agent introduces an invocation shape the categories below cannot express; when the run contract's minimum fields prove insufficient to answer the ADR-0006 visibility questions; when Perplexity's connectors gain deterministic dispatch semantics and a P-Direct / ICP-Routed placement needs to move; or when a runaway-cost, destructive, or external-communication incident forces a boundary to tighten.
---

# ADR-0013: Agent invocation and integration boundaries

## Context

ADR-0008 named the owned operational substrate (originally "Agent Control Layer / ACL"; renamed to **Integration Control Plane (ICP)** by ADR-0012) and placed every action into one of four categories: **P-Direct**, **P-Propose**, **ICP-Routed** (the label ADR-0012 adopted in place of ADR-0008's "ACL-Routed"), and **Stop**. ADR-0012 defined the ICP's internal software architecture as a skill framework — skill contract, skill registry, skill runner — composed over shared adapters (Linear, policy evaluator, run recorder, agent invocation adapter, write-back formatter). ADR-0011 picked the runtime. ADR-0006 defined the run report envelope. ADR-0009 defined the three cost bands and the runaway-cost interrupt protocol. ADR-0007 defined the QA and PR-review evidence workflow. `docs/process/approval-gates-and-autonomy-rules.md` is the day-to-day rule matrix.

What remains unresolved is the **invocation boundary**: when a request arrives that says "do this ticket with a coding agent" or "run QA on this PR" or "roll out this deploy," the ICP needs an explicit rule for (a) whether it is even allowed to invoke the requested agent, (b) which approval gate applies, (c) how the invocation is isolated, (d) what minimum inputs the invocation must carry, and (e) what minimum outputs the run must write back. Today, those rules are distributed across the documents above. That is fine for coding-agent dispatch during the pilot — which is the only path ADR-0012 wires end-to-end in its first slice — but the moment QA, PR review, SRE/deploy, or any future agent type is added, every implementer has to re-derive the boundary from six ADRs and one process doc. That re-derivation is the failure mode this ADR prevents.

This ADR is a decision ticket, not an implementation ticket. It does not integrate any new agent provider, does not grant any autonomy above ADR-0008's L3-with-approval default, does not bypass any existing approval gate from LAT-6 / LAT-16 / ADR-0008 / ADR-0009, and does not decide where in the repo any code lives. It names the invocation categories, the minimum run contract, and the isolation expectations so that (1) the ICP has a structural answer to "is this invocation allowed, and under which gate?", (2) a completed run has an unambiguous minimum evidence shape, and (3) a future agent type has a known boundary to slot into.

**LAT-18 runs in parallel and owns persistence/telemetry detail.** This ADR therefore specifies *what* fields an invocation and its run report must carry (which LAT-18's persistence layer must be able to store and query), but deliberately does not specify *where* or *how* those fields are stored beyond what ADR-0006 / ADR-0009 already decided. If LAT-18's persistence model later requires an additional envelope field to answer a cross-run question, that is an ADR-0006 extension, not an edit to this ADR.

## Decision Drivers

- **ADR-0008 rule matrix already classifies individual actions** but says relatively little about the *caller-to-agent-runner* seam specifically — invocation categorisation is thinner than the Linear/GitHub categorisation. Every new agent type today forces a re-read of the full matrix.
- **ADR-0012 made the skill runner the single enforcement point for autonomy/approval.** Every invocation path must therefore flow through the skill runner (or a future harness over it); no caller may reach an agent runner directly. This ADR codifies that constraint as an invocation rule, not just an implementation note.
- **ADR-0006 defines the run-report envelope** but is agent-type-agnostic. Downstream tickets need a named minimum subset per run — the minimum run contract — so an invocation without a PR URL or a risk line is rejectable without re-reading the full envelope.
- **ADR-0009 runaway-cost interrupt is a Stop regardless of autonomy level.** Invocation categorisation must preserve this: no category, no caller, no approval flag overrides the runaway-cost halt.
- **Secrets, destructive actions, merge, deploy, and external communications are already Stop by default** (ADR-0008, approval-gates-and-autonomy-rules.md). The invocation boundary must carry those isolation expectations into every agent type at the point of invocation, not only at the action-level matrix.
- **The first slice ships only coding-agent dispatch (ADR-0012).** This ADR must stay compatible with that slice while being large enough to admit QA, PR review, and SRE/deploy agents without re-opening the architecture.
- **Anti-astronautics guardrail** (`docs/decisions/README.md`): no new component, no new category, and no new field unless it unblocks a known pilot slice, prevents a known risk, or codifies a decision already relied on.
- **Perplexity is the cognitive front door, not an agent invoker** (ADR-0008). Any invocation Perplexity wants to drive must pass through the ICP skill runner via a harness; Perplexity may trigger, but it must not execute.
- **Future agent types must be able to slot in without editing this ADR.** The categories below are designed so that adding e.g. a "research" agent or a "observability" agent is a skill-file change and, at most, an agent-invocation-adapter change — not a rewrite of invocation policy.

## Considered Options

1. **Leave invocation to the general action matrix.** Rely on `approval-gates-and-autonomy-rules.md` plus ADR-0008 / ADR-0012 to cover invocation implicitly. Rejected: the existing matrix is action-centric (Linear write, PR merge, deploy), not invocation-centric (coding vs QA vs review vs SRE vs future). Adding a new agent type today forces re-derivation; LAT-21's acceptance criteria explicitly require the opposite.
2. **Per-agent-type policies.** One sub-document per agent type with its own gate list. Rejected: fragments the rule surface, duplicates the ADR-0008 categories for each type, and makes it easy for policies to drift between types (e.g. "QA agents can post to Slack" slipping in without going through the ADR-0008 Stop list).
3. **A single invocation contract with four named categories, a minimum run contract, and an explicit isolation rule set — applied uniformly across all agent types and enforced at the skill runner.** Accepted. The categories refine (they do not replace) ADR-0008's four action categories so that classification is one lookup, not two.
4. **Full pluggable policy engine** (DSL, rule files, per-repo config). Rejected: violates the anti-astronautics guardrail. The pilot has one operator, one repo, and one skill framework; a rule-engine abstraction would be scaffolding without use.

## Decision

**Accepted: Option 3.** The ICP applies a single invocation contract to every agent invocation, regardless of agent type. The contract has three parts: (a) **invocation categories**, which refine ADR-0008's action categories for the caller-to-agent-runner seam; (b) a **minimum run contract**, which names the minimum inputs a skill must accept before invoking and the minimum outputs a run must produce before the skill runner returns success; and (c) **isolation and safety expectations**, which carry the existing ADR-0008 / ADR-0009 / approval-gates-and-autonomy-rules Stop rules into the invocation path as structural constraints rather than review-time conventions.

Enforcement lives at the skill-runner / invocation boundary (ADR-0012). No caller — CLI harness, Perplexity shell-call, future scheduler, future service surface, or another skill — may reach an agent runner except via the skill runner and the agent invocation adapter. The skill runner is the single gate, and it applies this contract uniformly.

### Invocation categories

Every agent invocation falls into exactly one of four categories. These categories are a refinement of ADR-0008's action categories applied to the invocation seam specifically; where an action is classified at both levels, the stricter classification wins.

1. **Direct.** The caller invokes a capability directly without going through the skill runner. **Reserved for reads and drafting only.** Applies exclusively to Perplexity P-Direct actions per the ADR-0008 rule matrix (reading Linear for human triage, drafting PR bodies, responding in-thread, reading connector status). No agent runner invocation is Direct — by definition, invoking an agent runner is never Direct during the pilot.
2. **Proposed.** The caller drafts an invocation or artifact; execution requires an explicit human approval in the same surface that produced the proposal (Perplexity thread, PR comment, Linear comment). Applies to ADR-0008 P-Propose actions (create Linear project, reassign owners, docs/ADR PRs). **An agent invocation is Proposed when a human is being asked to sign off before the ICP starts the agent** — this is the shape of L3-with-approval for ICP-dispatched agents during the pilot: the skill runner returns `needs_human` with the proposed invocation, the human approves, a subsequent call is made with the approval flag set.
3. **ICP-Routed.** The caller triggers, but the invocation executes through the ICP skill runner and the agent invocation adapter. **This is the only category under which an agent runner actually starts during the pilot.** It applies uniformly to coding, QA, PR review, SRE/deploy, and every future agent type. The category is not "coding-only" or "per-type"; it is the single invocation path, and the variance across agent types lives in which skill is invoked and which agent runner the adapter binds.
4. **Stop.** The invocation is refused and routed to a human. Applies to every ADR-0008 Stop item (merge, deploy, delete Linear issue, force-push, change secrets/permissions, external communication, etc.); to ADR-0009 runaway-cost halts; to any invocation whose minimum run contract cannot be satisfied before the call; and to any invocation that would raise an autonomy level, modify approval rules, or bypass a gate.

The four categories are exhaustive. An invocation that does not fit cleanly is treated as **Proposed** and asked, per the classification procedure in `approval-gates-and-autonomy-rules.md`. Over-asking is the pilot's preferred failure mode for unclassified invocations.

### How invocation maps to agent type (pilot)

The default placement for each agent type's *start-a-run* invocation during the pilot:

| Agent type | Invocation category | Minimum autonomy | Notes |
|---|---|---|---|
| Coding | ICP-Routed | L3-with-approval | The first-slice path (ADR-0012). Per-action approval; batching deferred (ADR-0008 open question 2). |
| QA | ICP-Routed | L3-with-approval | Same gate shape. Evidence contract follows ADR-0007. Ticket `Budget cap` required per ADR-0009. |
| PR review | ICP-Routed | L3-with-approval | Same gate shape. Review agent **never approves** the PR (`approval-gates-and-autonomy-rules.md`, GitHub row). Evidence is the review report per ADR-0007. |
| SRE / deploy (read-only; diagnosis, runbook proposal, alert triage) | ICP-Routed | L3-with-approval | Read/diagnose only; any write lands as Proposed for a human, or a Stop if the action itself is in the ADR-0008 Stop list. |
| SRE / deploy (actually deploys, rolls back, restarts services) | Stop | — | Human only during the pilot. An SRE agent that would take a production-affecting action is refused at the skill runner — no per-invocation approval flag unblocks this. Raising this requires a separate ADR. |
| PM / research / observability (analysis, dashboard reads, drafting) | Direct or Proposed | L1–L2 | If it produces durable artifacts in Linear or the repo, it flows through ICP-Routed as a recorded run; otherwise Direct (Perplexity) or Proposed per ADR-0008. |
| Any future agent type | See classification below | — | Classified before first invocation; default Proposed; ICP-Routed only after its skill, autonomy level, and evidence contract are declared. |

This table is the *default*; the action-level rules in `approval-gates-and-autonomy-rules.md` override when they are stricter (e.g. a coding agent that would merge a PR still hits the PR-merge Stop — the ICP-Routed *start* does not unblock a Stop *step*).

### Classifying a new agent type

When a future agent type is proposed, the ICP's boundary for it is fixed by answering four questions in order, before the agent's first skill is merged:

1. **Does it perform any action on ADR-0008's Stop list without human gating?** If yes, the agent type cannot be integrated without a new ADR. If no, continue.
2. **Does it take durable action on Linear, GitHub, production, or an external surface?** If yes, invocation is at most **ICP-Routed**; the skill must declare its autonomy level and evidence contract. If no, it may be **Direct** or **Proposed** per ADR-0008's P-Direct / P-Propose rules.
3. **Which autonomy level does its default invocation run at?** Pilot default is **L3-with-approval**. L4+ requires an ADR per ADR-0008.
4. **What is its evidence contract?** Must conform to the minimum run contract below and the ADR-0006 envelope. Agent-type-specific detail lives inside the ADR-0006 open sub-objects (`agent_metadata`, `cost`, `correlation`) and in the narrative, not as new top-level keys.

If those four answers are in place, adding the agent type is a skill-file and, at most, an agent-invocation-adapter change. No edit to this ADR is required.

### Minimum run contract

Every agent invocation carried through ICP-Routed has a structural minimum on both sides of the call. The skill runner refuses to start a run that is missing required inputs, and refuses to return `succeeded` on a run that is missing required outputs. This is an evidence contract enforced in the runner, not a review-time convention.

**Minimum inputs (required before invocation):**

- `ticket` — the Linear issue key (`LAT-<n>`) the invocation is acting on. Unbounded exploratory invocations are not supported in the pilot; every run is scoped to a ticket so the write-back has a home and the dispatch algorithm has an entry point. A read-only invocation that genuinely has no ticket (e.g. a scheduled backlog triage) may pass `ticket: null` but must declare `scope` in its skill inputs instead.
- `repo` — the repository the agent runs against, as `owner/name`. Single-repo invocations during the pilot; multi-repo invocations are deferred.
- `branch_target` — the branch the agent should base its work on, typically `main`, and the branch naming convention the agent must follow (`lat-<n>-<slug>` per `operating-model.md`). For read-only invocations, the branch target may be `null` with a note in the skill inputs.
- `autonomy_level` — the ADR-0008 level at which the invocation is requested (`L0` through `L4`; `L5` is Stop per ADR-0008). The skill runner rejects any invocation that requests a level above the skill's declared default without the approval flag set.
- `approval_flag` — an explicit boolean the caller must set to `true` for any side-effecting invocation at or above L3. The flag's meaning is "a human has approved *this specific invocation*"; it does not stand in for a general autonomy uplift.
- `budget_cap` — the ticket's numeric `Budget cap` (ADR-0009). An invocation without a budget cap is refused as a pre-flight failure (`approval-gates-and-autonomy-rules.md`, cost row). The cap is the per-run trigger for ADR-0009's bands.
- `cost_band_observed` — the caller's best-known cost signal before invocation, defaulting to `normal`. If the caller already knows the band is `elevated` or `runaway_risk`, the invocation is refused at the runner (an `elevated` band at the start of a run signals the ticket is mis-scoped; a `runaway_risk` band is a Stop per ADR-0009).
- `agent_type` — one of the ADR-0006 canonical agent types (`coding | qa | review | sre | pm | research | observability`). The agent invocation adapter binds the correct runner.
- `skill_name_and_version` — the `name@version` of the skill being invoked (ADR-0012). The skill runner looks this up in the registry before invocation; an unknown `name@version` is a hard fail, not a warning.

**Minimum outputs (required for a `succeeded` or `failed` result):**

- `run_id` — stable, unique per run (ADR-0006 required core field).
- `agent_type`, `status`, `started_at`, `ended_at` — the ADR-0006 required core fields.
- `evidence` — artefacts produced, per ADR-0006's `output_artifacts` and the narrative section; for dispatch-class skills this is at minimum the run report itself plus any type-specific artefact (coding: PR URL; QA: QA report per ADR-0007; review: review report per ADR-0007; SRE: runbook steps taken/recommended; etc.).
- `pr_url` — populated in `correlation.pr_url` when the run opened or acted on a PR. `null` is acceptable only for runs where a PR is not applicable (read-only triage, diagnosis-only runs); `n/a` is never acceptable in the JSON envelope and is only used in the human-readable summary.
- `risks` — the `Risks:` line of the Linear write-back, surfaced from `risk_level` plus `cost_band` (when not `normal`) plus flagged `errors`. `"none"` is acceptable only if the run genuinely produced none; silence is not.
- `run_report` — a rendered run report conforming to `docs/templates/agent-run-report.md` and the ADR-0006 envelope. For non-dry-run invocations, the run report is written to the conventional repo path (ADR-0012 open question 3) and its URL returned in the result.
- `linear_write_back` — the Linear comment per ADR-0003 / ADR-0006. Five-element contract (outcome / evidence / risks / PR / next action + open questions), rendered as six lines (`Outcome` / `Evidence` / `Risks` / `PR` / `Next action` / `Open questions`) because the fifth element splits so either half can read `"none"` unambiguously. LAT-36 reconciled the count. The write-back formatter (`packages/icp/src/adapters/write-back-formatter.ts`) is the canonical rendered shape. For dry-runs, the write-back is rendered but not posted unless the caller sets `--dry-run --write-back` explicitly (ADR-0012 open question 5).
- `cost_band_final` — the run's terminal `cost.band` per ADR-0009, plus populated `cost.budget_cap_usd`, `cost.spent_usd` (or `null` with a narrative note per ADR-0009), `cost.input_tokens`, `cost.output_tokens`, `cost.cached_tokens`.

A run that fails to produce any of the minimum outputs is converted to `status: failed` by the skill runner before return, per ADR-0012's evidence-contract enforcement rule. "Success without evidence" is a structural defect, not a tolerated edge case.

### Isolation and safety expectations

These are the structural constraints every ICP-Routed invocation carries into the agent runner, regardless of agent type. Each one is already decided by an upstream ADR or process doc; this section names the invocation-side responsibility so an implementer does not have to cross-reference six documents per invocation.

- **Secrets.** Credentials (Linear API key, GitHub token, agent-runner auth, model provider keys) are resolved by the ICP's credential loader, never passed in skill inputs or written to the run report. The run report references credential *identity* (`agent_metadata.runtime.harness`) but never credential *value*. A skill that would serialize a secret into `agent_metadata`, `correlation`, or the narrative is a defect and must be rejected in review. Credential rotation and credential-source choice are out of scope here (ADR-0008 open question 4, resolved when the Linear adapter is scoped).
- **Cost runaway.** ADR-0009's three bands and the runaway-cost interrupt apply verbatim. An invocation that enters `runaway_risk` halts, writes the run report with the runaway-cost narrative, posts the Linear write-back with `Halted: runaway-cost interrupt — {trigger}`, and does not auto-resume. The skill runner refuses to dispatch a ticket whose most recent run halted for runaway-cost if no human unblock comment has landed since (`approval-gates-and-autonomy-rules.md`, agent-runs row; ADR-0009). **Autonomy level does not override this. Approval flag does not override this. Dry-run does not bypass it.**
- **Destructive actions.** `rm -rf`, dropping tables, deleting branches with unmerged work, force-pushing shared history, revoking credentials, destructive migrations — all Stop per `approval-gates-and-autonomy-rules.md`. The skill runner is not the right place to enforce destructive-action detection at the filesystem or database level (the agent runner and the reviewer are); the invocation-side responsibility is that **no skill declares a destructive action as part of its evidence contract** and **no skill's inputs cause an agent runner to be invoked with flags known to perform destructive actions without a human in the loop.** A request for destructive behaviour is a Stop at the invocation, not a category override.
- **Merge and deploy.** Stop per ADR-0008 and `approval-gates-and-autonomy-rules.md`. No ICP-Routed invocation may merge a PR or deploy. A coding agent that would open a PR is ICP-Routed; the merge of that PR remains a human action. A deploy agent invocation that would actually deploy is refused at the skill runner; a deploy *proposal* (runbook draft, deploy-plan rendering) is Proposed, not ICP-Routed.
- **External communications.** Slack, email, public posts, cross-repo issue creation — Stop per `approval-gates-and-autonomy-rules.md`. An agent whose evidence contract would write to an external surface (a QA agent that pages Slack, an SRE agent that emails on-call, a coding agent that publishes a blog post) is refused at the skill runner unless the specific channel has been opted in via an explicit ADR or rule change. The ICP does not own a generic "notify" capability during the pilot.
- **Autonomy and approval rule changes.** Edits to ADR-0008, to this ADR, to `approval-gates-and-autonomy-rules.md`, or to the autonomy level of any skill are Stop. An agent may draft; a human decides and an ADR records the decision.
- **Sandbox and workspace.** Agent runs execute in the agent runner's own sandbox — container, worktree, or remote session per `agent-metadata.runtime.sandbox` (ADR-0006). The skill runner does not share process state with the agent runner. Artefacts cross the boundary as files or URLs, not as in-process handles. This keeps the agent invocation adapter replaceable without forcing the skill framework to move (ADR-0012 component boundaries).
- **Observability.** Every ICP-Routed invocation produces an ADR-0006 run report and, for non-dry-runs, a Linear write-back (ADR-0003). Until the telemetry substrate lands (ADR-0003 / ADR-0006 / ADR-0009 open questions), the run report is the primary observability artefact. LAT-18 owns the persistence/telemetry side of this; this ADR binds every invocation to producing the run report regardless of whether LAT-18's substrate is live.

### Direct-Path Operations

*Amended by LAT-68 (2026-04-23) to resolve LAT-65. Extends, does not replace, the Direct definition above.*

LAT-65 concluded that **direct model-provider invocation** (the ICP calling a model provider's API — Anthropic, OpenAI, etc. — from within a skill, without spawning an external agent-runner harness) fits the existing **Direct** category on the *model-provider seam* while the skill invocation itself remains **ICP-Routed** on the *caller-to-skill seam*. The two seams do not collapse: the skill runner still gates the invocation (the skill is started ICP-Routed, with the full minimum run contract above), and the skill's implementation may then reach the model provider directly rather than shelling out to a coding-agent runner. Nothing in this subsection permits a caller to bypass the skill runner, and nothing here contradicts the rule above that *invoking an agent runner* is never Direct during the pilot. A direct model-provider call is not an agent-runner invocation.

**Direct is a first-class sanctioned path, not a fallback.** Direct-Path Operations are a deliberate architectural choice when the skill's work is model-cognition-bounded (drafting, classification, analysis, structured extraction) and does not require the file-system, tool-use, or long-lived sandbox a coding-agent runner provides. Choosing Direct over ICP-spawned agent-runner dispatch is a cost, latency, and blast-radius decision made per skill; it is not a degraded mode used when a runner is unavailable. A skill that is Direct today does not become "more correct" if it is later rewrapped behind an agent runner — the agent-runner wrap is warranted only when the runner brings capabilities (filesystem, multi-turn tool-use, sandbox) the Direct path cannot provide.

**Secret lifecycle on the Direct path (ADR-0017, LAT-64).** A Direct model-provider call dissolves one layer of isolation: the skill process itself holds a raw provider credential in memory for the duration of the call, rather than handing a sandbox boundary to a coding-agent runner that loads its own credential inside its own process. This makes ADR-0017's credential-loader contract load-bearing at the skill level, not just at adapter boundaries:

- Provider keys (Anthropic, OpenAI, future) are loaded through the ICP credential loader per ADR-0017 and LAT-64. Skills must not read `process.env.ANTHROPIC_API_KEY` (or equivalents) directly; they accept a typed credential handle from the loader, and the loader is the single choke point for redaction and fail-closed-on-missing behaviour.
- Provider keys are never serialised into skill inputs, the run report, `agent_metadata`, `correlation`, narrative, Linear write-back, PR body, or any artefact that lands in the repo or on Linear. The run report references credential *identity* (e.g. `agent_metadata.runtime.provider: "anthropic"`, `agent_metadata.runtime.model: "<model-id>"`), never credential *value*. This is a restatement of the existing Secrets isolation rule above with Direct-specific emphasis; it is binding, not aspirational.
- The credential is resident for the skill process's lifetime only; rotation and revocation semantics follow ADR-0017 uniformly. A Direct skill that caches a provider key across invocations, in a file, or in a worker process is a defect.
- Provider-side request/response logs held by the provider are outside the ICP's observability substrate. Skills must not rely on the provider's own logs as the ICP's evidence — every Direct call produces the ADR-0006 run report regardless of what the provider retains.

**Cost-band enforcement is mandatory on Direct calls (LAT-66).** LAT-66 enforces cost-band evidence at the ICP runner boundary for ICP-Routed dispatch; the same enforcement applies, verbatim, to Direct model-provider calls made from inside an ICP-Routed skill. Specifically:

- `budget_cap` remains a required pre-flight input; a Direct skill without a budget cap is refused as a pre-flight failure per the minimum run contract above. The Direct path does not have its own budget-cap shape.
- The skill is responsible for translating provider-reported usage (input tokens, output tokens, cached tokens, dollar cost where derivable) into the ADR-0009 bands and populating `cost_band_final`, `cost.spent_usd` (or `null` with a narrative note), `cost.input_tokens`, `cost.output_tokens`, `cost.cached_tokens` on the run report. Token and dollar fields being populated is a minimum output; `null` cost is acceptable only with the narrative note ADR-0009 allows.
- Runaway-cost interrupt (ADR-0009) applies verbatim. A Direct call that crosses into `runaway_risk` halts at the next safe boundary, writes the run report with the runaway-cost narrative, posts the Linear write-back with the halt line, and does not auto-resume. Autonomy level, approval flag, and dry-run do not override this. Provider-side streaming does not exempt a Direct skill from halting mid-stream when usage projects into `runaway_risk`.
- An `elevated`-at-start band remains a pre-flight refusal (see `cost_band_observed` in the minimum inputs above). This is unchanged for Direct.

**Evidence parity with ICP-Routed.** A Direct model-provider invocation emits the **same structured evidence artefact** as an ICP-Routed agent-runner invocation: the full ADR-0006 run report, the Linear write-back per ADR-0003, the minimum output fields above (`run_id`, `agent_type`, `status`, `started_at`, `ended_at`, `evidence`, `pr_url` where applicable, `risks`, `run_report`, `linear_write_back`, `cost_band_final`). The `agent_type` field takes the closest ADR-0006 canonical value for the skill's purpose (e.g. a drafting skill is `pm` or `research`; a classification skill is `research`; a review-drafting skill is `review`), not a new type — agent-type taxonomy is ADR-0006's, and Direct-Path Operations does not add to it. `agent_metadata.runtime.harness` takes a value that names the Direct path explicitly (e.g. `"direct:anthropic"`, `"direct:openai"`) so downstream readers can distinguish a Direct call from a coding-agent-runner call without parsing narrative. "Direct means less evidence" is not an accepted trade; if a Direct skill cannot produce the minimum outputs, the skill runner converts it to `status: failed` per the minimum run contract above.

**Classification procedure for new Direct-Path skills.** Before a new skill's first invocation, the four questions in *Classifying a new agent type* still apply, with one addition for Direct: the skill must declare, in its skill manifest, (a) that its model-provider seam is Direct, (b) which provider and which model identity it binds, (c) which credential handle it requests from the loader, and (d) that its evidence contract emits the full ADR-0006 envelope. A skill that cannot answer all four is Proposed by default, per the over-asking rule.

**Out of scope for this amendment.** This subsection does not choose a long-term provider strategy (single vs. multi-provider, which providers are sanctioned), does not implement any provider adapter or skill, does not authorise auto-merge or deployment of provider-using code, and does not modify ADR-0008, ADR-0009, ADR-0012, or ADR-0017. It classifies the Direct-Path seam so that LAT-67 (direct Anthropic proof) has an accepted invocation classification before implementation begins.

### What this ADR does not do

- Does not integrate any new agent provider. The first-slice bound runner from ADR-0012 stays bound; additional runners are per-ticket follow-ups.
- Does not grant autonomous merge or deploy at any level. L5 remains out of scope for the pilot.
- Does not modify the approval gates from ADR-0008, LAT-6, LAT-16, ADR-0009, or `approval-gates-and-autonomy-rules.md`. The invocation categories refine ADR-0008's action categories for the invocation seam; they do not override any existing rule.
- Does not place any component or skill file in a specific repo path. That is ADR-0012's open question and LAT-20's runtime binding.
- Does not define quantitative cost caps. ADR-0009 open question; this ADR treats `budget_cap` as a required input and `cost_band` as a required output, without pre-deciding the dollar/token threshold.
- Does not define the persistence or query surface for run reports. LAT-18.
- Does not edit upstream ADRs. ADR-0008's "ACL-Routed" label stays where it is; this ADR speaks in ICP terminology and cites ADR-0008 explicitly when referencing the original label.

## Consequences

Good:

- Given a dispatch request, the ICP has a single structural answer to "is this invocation allowed, and which approval gate applies?" — classify into Direct / Proposed / ICP-Routed / Stop, look up the minimum autonomy level, apply the isolation rules. Per LAT-21's acceptance criteria, this is now a short lookup, not a re-derivation.
- Given a completed agent run, the minimum output fields are named in one place. A run that omits `pr_url` where applicable, `risks`, the run report, or the Linear write-back is rejectable without re-reading ADR-0006 in full.
- Given a future agent type, the classification procedure and the placement table make the invocation boundary explicit before the first skill merges. Adding QA, PR review, SRE/deploy, or a new type like `research` is a skill-file change plus a row in the placement table, not an ADR.
- The skill runner stays the single enforcement point (ADR-0012). Every caller — CLI, Perplexity shell-call, future scheduler, future service surface — applies the same invocation contract.
- Runaway-cost, destructive actions, merge, deploy, external communications, and autonomy/approval rule changes remain Stop. No category, caller, or approval flag added here overrides any existing gate.
- LAT-18's persistence work has a named set of invocation inputs and run-report outputs to model. If a new field is needed to answer a cross-run question, it is an ADR-0006 extension, not a re-opening of invocation policy.

Bad / open:

- The invocation categories (Direct / Proposed / ICP-Routed / Stop) are a refinement of ADR-0008's action categories (P-Direct / P-Propose / ACL-Routed / Stop in ADR-0008's original voice; ICP-Routed in ADR-0012's voice). Readers will see two overlapping four-category taxonomies until they notice that the invocation categories are ADR-0008's action categories applied to the caller-to-agent-runner seam. The accepted mitigation is that both are explicitly the same four categories with the same names (except P-Direct → Direct and P-Propose → Proposed to reflect that the caller is not always Perplexity at the invocation seam).
- The minimum run contract duplicates fields that are already named in ADR-0006 / ADR-0003 / ADR-0009. This is deliberate — the invocation-side contract must be readable in one place — but it introduces two documents that must stay in sync. The accepted convention is that the upstream ADRs own the field definitions; this ADR owns the "required at the invocation boundary" claim.
- The placement table (which agent type goes into which category at which autonomy level) is part prescription and part snapshot. It will need edits as new agent types are integrated. Edits to the table are allowed without a new ADR *only* if they slot a new agent type into an existing category at a pilot-default autonomy level; any category move, any raise above L3-with-approval, or any change that unblocks a Stop requires a new ADR.
- The "SRE / deploy (actually deploys)" row being Stop is deliberate, but it means the ICP has no path to run a real deploy during the pilot. That matches ADR-0008 and the "no autonomous merge/deploy" non-goal of this ticket, but it does mean SRE agents during the pilot are effectively read-only / proposal-only. When real deploy is desired, a separate ADR must decide its boundary.
- Isolation rules are stated; enforcement is partial. Secrets handling is enforced at the credential loader (when it lands), runaway-cost at ADR-0009's interrupt, merge/deploy at the PR and deploy surfaces, external communications at the adapter level. Until the credential loader exists, secrets discipline is a review-time convention, not a runtime gate. This matches ADR-0012's accepted "skill framework first, adapters grow as needed" trade-off.
- The Perplexity case deserves a sharp statement: **Perplexity never invokes an agent runner in ICP-Routed form directly.** The Perplexity harness (currently the CLI shell-call path, later potentially a dedicated harness) invokes a skill, and the skill runner invokes the agent runner. A future Perplexity shell-call harness does not change this; it is still a harness over the skill runner. The cost is that Perplexity-initiated invocations inherit the shell brittleness ADR-0012 already flagged; the alternative (letting Perplexity talk to the agent runner) collapses the ICP as an enforcement point and is rejected.

## Open Questions

1. **Dry-run semantics for non-coding agents.** ADR-0012 open question 5 covers the coding case. QA, PR review, and SRE agents may have their own dry-run shape (QA dry-run = plan only; review dry-run = heuristic pass without posting; SRE dry-run = runbook render). Out of scope here; decide in each agent type's integration ticket.
2. **Budget-cap semantics per agent type.** ADR-0009 treats the budget cap as a per-run dollar/token trigger. QA, review, and SRE runs may warrant a different default cap shape (e.g. time-boxed instead of token-boxed). Out of scope here; ADR-0009 open question and each type's integration ticket.
3. **Multi-repo invocations.** The minimum run contract fixes `repo: owner/name` as a single value. Cross-repo coding / QA work is deferred.
4. **Batched approval for repeated ICP-Routed invocations.** ADR-0008 open question 2. Leaning per-action during the pilot; this ADR preserves that and does not pre-decide a batching scheme.
5. **Whether `ticket: null` read-only invocations (e.g. scheduled backlog triage, connector-health checks) should write a full ADR-0006 run report or a lighter structured log.** Leaning full run report for consistency; revisit if volume becomes a problem once any scheduled invocation actually ships.
6. **Whether a future "notify" capability (Slack, email) should be ICP-Routed-with-explicit-opt-in or stay Stop forever during the pilot.** Leaning Stop; when the first real notify use case arrives, a separate ADR scopes the opt-in surface.

## Confirmation

Working if, across the next several invocations:

- Every ICP-Routed invocation resolves to exactly one cell of the placement table without re-reading ADR-0008 / ADR-0012 / `approval-gates-and-autonomy-rules.md`.
- Every completed run produces the minimum outputs named above; no run is accepted as `succeeded` without the evidence contract fields populated.
- No ICP-Routed invocation has started an agent that performed a Stop-category action without a human in the loop — in particular, no merge, no deploy, no destructive action, no external communication, no autonomy or approval rule change.
- When a second agent type is bound to the agent invocation adapter (QA or PR review is the likely first), the integration ticket touches only the skill file, the agent invocation adapter, and, at most, one row of the placement table — not this ADR's categories or minimum run contract.
- When LAT-18's persistence/telemetry substrate needs a field this ADR did not name, the change is an ADR-0006 extension, not a re-opening of the invocation contract.
- A runaway-cost interrupt fires at least once in the pilot and lands at `needs-human` per ADR-0009 without auto-resume. (Paradoxical but desired: the interrupt is the point; never firing it would mean we never pushed against the boundary.)

Revisit if any of those stops being true, or if the revisit trigger in the frontmatter fires.

## Links

- Linear: `LAT-21` (this ADR). Upstream context: `LAT-5`, `LAT-6`, `LAT-8`, `LAT-16`, `LAT-19`, `LAT-20`, `LAT-22`. Parallel in-flight: `LAT-18` (persistence/telemetry detail). Direct-Path Operations amendment: `LAT-65` (classification), `LAT-66` (cost-band enforcement at the runner boundary), `LAT-68` (this amendment), `LAT-67` (direct Anthropic proof — downstream of this amendment).
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md` (original "ACL" naming; this ADR uses the ADR-0012 rename), `0009-cost-controls-and-runaway-cost-interrupts.md`, `0011-integration-control-plane-language-and-runtime.md`, `0012-integration-control-plane-software-architecture.md`, `0017-icp-credentials-and-secrets-management.md` (credential loader binding for the Direct path).
- Process: `docs/process/approval-gates-and-autonomy-rules.md` (rule matrix), `docs/process/operating-model.md` (PR ↔ Linear linking, severity ladder), `docs/process/intake-triage.md` (severity classification), `docs/process/cost-controls.md` (cost bands and runaway-cost protocol).
- Templates: `docs/templates/agent-run-report.md` (ADR-0006 envelope), `docs/templates/agent-ready-ticket.md` (`Budget cap` requirement), `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`.
