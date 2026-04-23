---
id: ADR-0012
title: Agent Control Layer software architecture
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-19
supersedes:
superseded_by:
revisit_trigger: Revisit when the first vertical slice is running end-to-end in the pilot, when a second caller (a second human operator, a scheduler, a webhook, or a second agent runner) needs to invoke the ACL, when the run-recorder needs to answer queries the repo-committed run reports cannot answer, or when a component defined here is found to be in the wrong place (e.g. the dispatcher needs state the library boundary cannot give it).
---

# ADR-0012: Agent Control Layer software architecture

## Context

ADR-0008 named the Agent Control Layer (ACL) as the owned operational substrate for anything that requires first-class APIs, Linear native-relation semantics, dispatch determinism, or high-fidelity telemetry, and kept it deliberately small — "skills and adapters in this repo, not a service." ADR-0008 did not, however, name the components, the internal boundaries, or the first vertical slice the implementation backlog should build. Without those, every implementation ticket has to re-derive the architecture.

This ADR closes that gap. It is a decision ticket, not an implementation ticket: it names the components, their boundaries, and the first end-to-end slice, and leaves runtime choice (LAT-20, in flight) and individual component implementations to their own tickets.

Context already decided elsewhere:

- **ADR-0001** — Perplexity is intake/reasoning/control surface; Linear is the work graph; GitHub is the durable source of truth.
- **ADR-0003** — Linear persistence boundary and write-back contract; telemetry substrate deferred.
- **ADR-0005** — Dispatch-readiness model, the `## Sequencing` block as the pilot connector-readable source, and the dispatch algorithm the ACL must implement. Native Linear relations are the migration target.
- **ADR-0006** — Run report envelope (the `run_id` / `agent_type` / `status` / `cost` / `correlation` shape every run must emit) and the five-element Linear write-back.
- **ADR-0007** — QA / PR-review evidence workflow the ACL must preserve when it dispatches QA/review agents.
- **ADR-0008** — ACL ⟷ Perplexity boundary and the four action categories (P-Direct, P-Propose, ACL-Routed, Stop).

In-flight tickets (no dependency on their branches):

- **LAT-20** — language/runtime ADR. This ADR intentionally does not pick a runtime; it describes the architecture in runtime-neutral terms so LAT-20 can bind it.
- **LAT-6**, **LAT-11** — autonomy dial / operating posture refinements. This ADR treats ADR-0008's autonomy levels as stable and lets those tickets refine them without re-opening the architecture.

## Decision Drivers

- The ACL must be implementable in small, independently-mergeable pieces. A monolithic design blocks the pilot.
- The boundary between "what the ACL is responsible for" and "what Perplexity / Linear / GitHub / coding agents / telemetry are responsible for" must be explicit, so capability placement is a short conversation, not a re-derivation.
- The dispatch path must be deterministic and auditable end-to-end: read Linear → evaluate policy → invoke an agent → record the run → write back to Linear. Any hidden state between those steps is a defect.
- Merge, deploy, and autonomy-level changes remain human-gated (ADR-0008). The architecture must make those gates structural, not conventional.
- ADR-0008's anti-astronautics guardrail applies: no component exists unless it unblocks the first slice, prevents a known risk, or codifies a decision already relied on.
- Runtime choice is LAT-20's to make. The architecture must remain coherent whether LAT-20 picks Python, Node/TypeScript, Go, or something else.
- The first slice must be narrow enough to ship while exercising every component at least once; otherwise the boundaries are theoretical.

## Considered Options

1. **CLI-only.** The ACL is a set of CLI commands invoked from a terminal or from Perplexity as shell calls. All state lives on disk or in Linear/GitHub. Rejected as the *target* shape: structuring everything around a CLI entry point couples the dispatch and recording logic to argument parsing and shell I/O, making it awkward to later expose the same operations to a second caller (scheduler, webhook, test harness, second agent runner). Accepted as the *surface* shape for the first slice, but not as the internal shape.
2. **Service-first.** The ACL is a long-running service (HTTP/gRPC API, queue, persistent store, worker pool) from day one. Rejected: violates the ADR-0008 anti-astronautics guardrail. The pilot has one human operator, no concurrent agent runs, no cross-run coordination requirement, and no telemetry substrate yet. A service adds deployment, auth, persistence, and operational surface the pilot does not need, and it forces runtime/hosting decisions LAT-20 has not yet made.
3. **CLI-backed-by-library.** The ACL's durable shape is a **library** (internal package) of deterministic components with well-defined interfaces. The first and only delivered surface is a **CLI** that wires those components together for a human operator or for Perplexity to shell out to. A service surface can be added later — wrapping the same library — when a concrete second caller or coordination requirement forces it. **Accepted.**
4. **Perplexity-plugin-only.** Implement the ACL as Perplexity custom connectors / skills with no owned code path. Rejected: explicitly contradicts ADR-0008. The whole point of the ACL is that we own the operational substrate independently of Perplexity's connector roadmap.

## Decision

**Accepted: Option 3 — CLI-backed-by-library.** The ACL's durable shape is a library of components with explicit interfaces. The first surface is a CLI. A service surface is intentionally deferred and will be added, wrapping the same library, only when a concrete second caller or coordination need forces it.

### Components

The ACL is exactly seven components. Each has a single responsibility, a stated input/output contract, and a stated dependency direction. Nothing else is in the ACL for the pilot.

1. **Linear adapter.**
   - Responsibility: the only path in or out of Linear for ACL-Routed actions. Implements the Linear GraphQL operations named in ADR-0008 (`issueRelationCreate`, inline `issue.relations`, `issueRelationDelete`, issue status / parent / child / label reads, pagination) and the `## Sequencing` block read path per ADR-0005. Returns typed values; never returns raw GraphQL payloads upward.
   - Does not: decide whether to dispatch, format write-back text, or know about agents.
   - Depends on: the Linear GraphQL endpoint and a credential source. Nothing else in the ACL depends *on top of* the adapter other than the dispatcher, policy evaluator, and write-back formatter.
2. **Dispatcher.**
   - Responsibility: given a candidate `LAT-*` issue (or "next dispatchable"), orchestrate the read-evaluate-invoke-record-write-back pipeline. Executes the ADR-0005 dispatch algorithm end-to-end using the Linear adapter, the policy evaluator, the agent invocation adapter, the run recorder, and the write-back formatter. Produces a single dispatch decision record per attempt.
   - Does not: contain Linear GraphQL calls directly, contain policy rules directly, format the write-back string, or speak to agent runners directly. It composes the other components.
   - Depends on: all six other components.
3. **Policy evaluator.**
   - Responsibility: pure function over a dispatch input (issue fields, `## Sequencing` block, blocker statuses, autonomy level, cost-band signal) that returns a structured verdict: `ready | caution | blocked | stop`, plus the reason list and the required human-approval flag. Encodes the ADR-0005 dispatch algorithm, the ADR-0008 four-category placement for the specific action, the ADR-0008 autonomy levels, and the ADR-0008 failure-posture rules (low / medium / high / runaway-cost).
   - Does not: perform I/O, read Linear, mutate state, or invoke agents. It is deterministic and table-testable.
   - Depends on: only the types used by its inputs. No adapters.
4. **Run recorder.**
   - Responsibility: produce and persist a run report that conforms to the ADR-0006 envelope (required core fields, strongly-recommended fields, open sub-objects). For the pilot, "persist" means write a Markdown + JSON run report file into the repo at a conventional path and return its URL/path. Emits the envelope shape other components (dispatcher, write-back formatter) consume.
   - Does not: decide policy, call Linear, call agents, or format the Linear comment. It only owns the envelope.
   - Depends on: a filesystem / repo write path. Replaceable later by a telemetry-substrate writer without touching callers, per ADR-0006's forward-compatibility contract.
5. **Agent invocation adapter.**
   - Responsibility: the only path out of the ACL to a coding, QA, review, SRE, PM, research, or observability agent runner. Translates a dispatch input (plus autonomy level and approval flag) into a concrete agent-runner invocation, captures the runner's exit signal (succeeded / failed / cancelled / needs_human), and returns the run's output artifacts (PR URL, run-id, cost signal if the runner provides one) in the ADR-0006 shape.
   - Does not: decide whether to invoke (dispatcher's job), format the write-back, or persist the run report.
   - Depends on: the concrete agent runner(s) available in the pilot. Kept behind an interface so LAT-20 can bind runners without changing the dispatcher.
6. **Write-back formatter.**
   - Responsibility: given a run report envelope, produce the exact five-element Linear comment string defined by ADR-0006 (`Outcome` / `Evidence` / `Risks` / `PR` / `Next action` / `Open questions`) and hand it to the Linear adapter for posting. Enforces the ADR-0003 comment-shape guideline and the ADR-0007 QA/review evidence conventions when the run is a QA or review run.
   - Does not: decide what the outcome was, pick the next action, or post anything directly (the Linear adapter posts).
   - Depends on: the run report envelope type from the run recorder and the Linear adapter.
7. **Operator interface.**
   - Responsibility: the human (or Perplexity shell-call) entry point. For the pilot, this is a CLI. Commands map 1:1 to the dispatcher's operations: evaluate a candidate, dispatch with approval, dry-run a dispatch (policy-only, no invocation), list recent runs, re-post a write-back from an existing run report. Emits exit codes that reflect the policy verdict (`0` ready/succeeded, `1` caution/failed, `2` blocked/stopped, `3` needs_human) so shell callers can script around it.
   - Does not: contain dispatch logic, policy rules, or Linear/agent/GitHub calls. It is a thin wiring layer over the library.
   - Depends on: the dispatcher and, for read-only commands, the Linear adapter and run recorder directly.

### Dependency direction (no cycles)

```
operator interface (CLI)
        │
        ▼
   dispatcher ────────────────────────────────┐
    │    │    │                               │
    ▼    ▼    ▼                               ▼
 policy  run-     agent-invocation       write-back
 eval    recorder adapter                formatter
                                               │
                                               ▼
                                          Linear adapter
                                               │
                                               ▼
                                       Linear GraphQL
```

- The policy evaluator is a leaf. It never calls anything in the ACL.
- The Linear adapter is called by the dispatcher (for reads) and by the write-back formatter (for the write-back post). Nothing else talks to Linear.
- The agent invocation adapter is called only by the dispatcher. Nothing else talks to agent runners.
- The run recorder is called by the dispatcher and read by the write-back formatter. Nothing else writes run reports.

Any change that introduces an edge not shown here (e.g. the policy evaluator calling the Linear adapter, or the write-back formatter calling an agent runner) is an architectural change and requires an ADR update.

### External boundaries

The ACL is the only component in the system that may:

- Read or write Linear native relations, or post ADR-0003-shaped write-back comments.
- Select the next dispatchable `LAT-*` issue per ADR-0005.
- Invoke a coding, QA, review, SRE, PM, research, or observability agent runner for a dispatched ticket.
- Emit an ADR-0006 run report.
- Apply an ADR-0008 autonomy-level or failure-posture rule to an action.

The following are explicitly *not* the ACL's responsibility, and the architecture must keep them out:

- **Perplexity.** Cognition, triage, drafting, read-heavy analysis. May call the ACL as a shell call (operator-interface entry) but never bypasses it for ACL-Routed actions (ADR-0008 rule matrix).
- **Linear.** Durable work graph and human review surface (ADR-0001, ADR-0003). The ACL reads and writes through the Linear adapter; it does not replicate Linear state.
- **GitHub.** Durable source of truth for code, docs, ADRs, run reports (during the pilot), and PRs (ADR-0001). The ACL does not manage GitHub directly; opening PRs and pushing commits is the agent runner's job (ADR-0007). The ACL records the resulting PR URL via `correlation.pr_url` in the run report.
- **Coding / QA / review agents.** Doing the actual work on a dispatched ticket. They return exit signals and artifacts; they do not post to Linear (the ACL's write-back formatter does) and they do not evaluate dispatch policy.
- **Future telemetry substrate.** Long-term run storage, cross-run queries, dashboards (ADR-0003, ADR-0006). Until it exists, the run recorder writes Markdown + JSON to the repo and that is sufficient for pilot volume. When the substrate lands, it replaces the run recorder's persist step; no other component changes.
- **Operator judgement.** Approval at L3 and above, any Stop-category action, any autonomy-level change. The ACL asks (by returning `needs_human` or `stop`), it does not decide.

### First vertical slice

The implementation backlog should build exactly this slice first. It is the smallest path that touches every component, produces an auditable run, and demotes no decision to "we'll figure it out later."

**Goal:** from a single CLI invocation, read a named `LAT-*` issue from Linear, evaluate it against the ADR-0005 dispatch algorithm and the ADR-0008 policy matrix, invoke one bounded coding-agent run with explicit human approval, record the run against the ADR-0006 envelope, and post the ADR-0006 five-element write-back back to Linear.

**Concretely:**

1. **CLI command.** `acl dispatch LAT-<n> --approve` (and `acl dispatch LAT-<n> --dry-run` for policy-only evaluation). No TUI, no config file beyond credentials.
2. **Linear adapter.** Read the candidate issue (description + status), read the `## Sequencing` block, and read each hard blocker's status. One Linear write path: post the five-element write-back comment. No native-relation writes in the first slice — reads only — because ADR-0005 still requires the `## Sequencing` block to be authoritative until its follow-up ADR.
3. **Policy evaluator.** Implement `ready | caution | blocked | stop` over `## Sequencing` + blocker statuses + the autonomy-level default (L3-with-approval for ACL-dispatched agents, per ADR-0008) + the runaway-cost stop rule. No cost-band quantification yet (ADR-0008 open question 3); treat any unknown cost as `caution` rather than `ready`.
4. **Agent invocation adapter.** One agent runner bound. One agent type bound (`coding`). The runner returns an exit signal and a PR URL (or `n/a`). Other agent types are stubs that error out — they are added in subsequent tickets, not this slice.
5. **Run recorder.** Write a run report Markdown + JSON file at a conventional repo path with the ADR-0006 required core fields and every strongly-recommended field the first slice can populate (`triggered_by: user`, `linear_issue_id`, `autonomy_level: L3`, `correlation.pr_url`, `correlation.commit_sha` if known).
6. **Write-back formatter.** Render the five-element comment from the run report envelope and hand it to the Linear adapter.
7. **Operator interface.** Exit codes as defined above. Log lines that a human can paste into a Linear comment or a postmortem without editing.

This slice is also the end-to-end test: if the CLI can dispatch one real `LAT-*` ticket, start one coding-agent run, record it, and post the write-back, every component boundary is exercised.

### What is intentionally deferred

Listed here so future tickets do not have to re-discover that they are out of scope for this ADR. None of these are forbidden; they each require a follow-up ADR or an implementation ticket with an explicit scope decision.

- **Service surface.** HTTP/gRPC API, hosted deployment, auth, queues, persistent store for the ACL itself. Deferred until a concrete second caller or coordination requirement exists.
- **Native Linear relation writes.** ADR-0005 requires its own follow-up ADR before the dispatch source moves off the `## Sequencing` block. The Linear adapter may read native relations as a human-mirror cross-check, but the dispatcher does not consume them for dispatch yet.
- **Telemetry substrate.** ADR-0003 / ADR-0006 defer. The run recorder writes to the repo until the substrate ADR lands, at which point only the recorder's persist step changes.
- **Quantitative cost bands.** ADR-0008 open question 3. Until then, the policy evaluator treats unknown or elevated cost as `caution`.
- **Multi-tenant / multi-operator support.** Explicit non-goal.
- **Merge and deploy automation.** Stop-category in ADR-0008. Not in MVP; a future ADR is required to change this.
- **Batched L3 approvals.** ADR-0008 open question 2. Default per-action until decided.
- **Agent runners for QA / review / SRE / PM / research / observability.** Scoped in per-type implementation tickets under LAT-6 / LAT-11 and their successors. The agent invocation adapter is designed so adding a runner is a bounded change.
- **Runtime / language choice.** LAT-20. This ADR does not depend on a specific runtime.
- **Credential management.** ADR-0008 open question 4. Resolved when the Linear adapter is scoped as its own ticket.
- **`## Sequencing` ↔ native-relation parity automation.** ADR-0005 open question 1.

### MVP-in vs MVP-out for orchestration complexity (acceptance criterion)

A recurring question during implementation will be "should the ACL also do X?" The default answer, per ADR-0008 and this ADR, is **no** unless X is one of the seven components above or the first slice requires it. Specifically:

- **In MVP:** exactly the seven components, exactly the first slice, exactly the read-path Linear usage described above, exactly one coding-agent runner bound, exit-code-based operator interface.
- **Out of MVP:** anything in the "intentionally deferred" list above; any new top-level ACL component; any new external integration (Slack, email, dashboards); any autonomy level above L3-with-approval; any Stop-category action becoming non-Stop.

A request to add orchestration complexity is answered by pointing to this section. Changing this section requires a new ADR.

## Consequences

Good:

- Implementation can start immediately on a library-shaped ACL in runtime-neutral terms, unblocking LAT-20 to pick the runtime without re-opening architecture.
- Component boundaries are narrow enough that each component is an independent ticket, and the first slice touches all of them end-to-end.
- The CLI-backed-by-library shape preserves the option to grow into a service without a rewrite: adding a service surface means wrapping the same library, not redoing the components.
- The dispatch path is auditable from a single run report: one envelope per dispatch attempt, every decision traceable to the policy evaluator and the `## Sequencing` block.
- Merge, deploy, and autonomy-level changes remain structurally human-gated because the operator interface only exposes dispatch with explicit approval.
- The "intentionally deferred" list gives future tickets a short reference for scope arguments.

Bad / open:

- Seven components is more surface than a single monolithic script, and during the first slice some components will feel underweight (the write-back formatter is almost trivial, the policy evaluator is a pure function). This is deliberate: the slim components earn their keep the first time a runner changes, the write-back format grows, or the policy rules are extended.
- Keeping the Linear adapter as the only Linear caller requires discipline during implementation. Temptation will exist to let the dispatcher make "just one small" Linear call directly. This is an architectural change and must be rejected in review.
- Until the native-relation write path lands (separate ADR), the Linear adapter's read surface is richer than its write surface, which can make the adapter feel lopsided. Accepted for the pilot.
- The operator interface being a CLI means Perplexity calls the ACL via shell execution, with all the brittleness of shell quoting and exit-code parsing that implies. If this becomes the dominant failure mode, that is the trigger to add the service surface.
- Runtime-neutral wording means LAT-20 can pick a runtime that makes one of the component boundaries awkward (e.g. a language without ergonomic interface/protocol types). Mitigation: LAT-20 explicitly considers these boundaries when it picks.

## Open Questions

1. Where exactly in the repo the ACL library and CLI live (likely `skills/` or a future `adapters/` / `acl/` directory; ties into ADR-0004 and ADR-0008 open question 1). Resolved when LAT-20 picks the runtime.
2. Whether the run recorder writes run reports under a single `runs/` directory or co-located with the triggering ticket. Pilot preference: single `runs/` directory, one file per `run_id`, until the telemetry substrate replaces this.
3. Whether the policy evaluator should also emit a machine-readable reason list (for later consumption by Perplexity queries) in addition to human-readable reasons. Leaning yes; a small structured list in the run report under `decisions` satisfies both.
4. Whether `acl dispatch --dry-run` should post any write-back at all. Leaning no (dry-run means no external side effects), but allow `--dry-run --write-back` as an explicit opt-in if it proves useful during refinement.

## Confirmation

Working if, when the first slice ships:

- A single CLI invocation can dispatch one `LAT-*` ticket end-to-end and produce one run report that matches ADR-0006 and one Linear write-back that matches ADR-0003 / ADR-0006.
- No component has acquired a responsibility not listed above; in particular, no Linear GraphQL call exists outside the Linear adapter, and no agent-runner invocation exists outside the agent invocation adapter.
- Implementation tickets for subsequent agent types (QA, review, …) change only the agent invocation adapter and, at most, the write-back formatter — not the dispatcher, policy evaluator, or run recorder.
- A request to add orchestration complexity is closed by citing the "MVP-in vs MVP-out" section without a new ADR.
- LAT-20's runtime choice binds cleanly to the component interfaces without forcing a component to move or merge.

Revisit if any of those stops being true, or if the revisit trigger in the frontmatter fires.

## Links

- Linear: `LAT-19` (this ADR). Related in-flight: `LAT-20` (runtime), `LAT-6`, `LAT-11` (autonomy). Related context: `LAT-5`, `LAT-8`, `LAT-10`, `LAT-14`, `LAT-15`, `LAT-16`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md`.
- Process: `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`, `docs/process/intake-triage.md`, `docs/process/qa-review-evidence.md`.
- Templates: `docs/templates/agent-run-report.md`, `docs/templates/agent-ready-ticket.md`.
