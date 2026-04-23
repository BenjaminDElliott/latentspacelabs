---
id: ADR-0012
title: Integration Control Plane software architecture
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-19
supersedes:
superseded_by:
revisit_trigger: Revisit when the first vertical slice (skill framework + one dispatch skill + thin CLI harness) is running end-to-end in the pilot, when a second caller (scheduler, webhook, a second agent runner, or a second agent harness beyond Claude Code) needs to invoke the ICP's skills, when the run-recorder needs to answer queries the repo-committed run reports cannot answer, or when a component defined here is found to be in the wrong place (e.g. the dispatcher needs state the library boundary cannot give it, or the skill runner needs to grow coordination the pilot did not plan for).
---

# ADR-0012: Integration Control Plane software architecture

## Context

ADR-0008 named the owned operational substrate (there called the "Agent Control Layer / ACL") for anything that requires first-class APIs, Linear native-relation semantics, dispatch determinism, or high-fidelity telemetry, and kept it deliberately small — "skills and adapters in this repo, not a service." ADR-0008 did not, however, name the components, the internal boundaries, or the first vertical slice the implementation backlog should build. Without those, every implementation ticket has to re-derive the architecture.

This ADR closes that gap. It is a decision ticket, not an implementation ticket: it names the components, their boundaries, and the first end-to-end slice, and leaves runtime choice (LAT-20, in flight) and individual component implementations to their own tickets.

### Naming: Integration Control Plane (ICP), not Agent Control Layer (ACL)

This ADR renames the primary concept from ADR-0008's working name "Agent Control Layer / ACL" to **Integration Control Plane / ICP**. The substantive architecture decision is unchanged; only the name is.

- **ACL is avoided** because in common infrastructure usage "ACL" reads as "Access Control List" — a permissions list, not a coordination layer. That collision is load-bearing confusion the moment a reader comes from an ops, platform, or security background.
- **Integration Control Plane** describes what the thing actually does: it is the owned **coordination layer between user input, agents, external APIs, systems of record, and observability**. It translates messy intent into governed work — selecting skills, invoking agents/tools, enforcing approval gates, recording evidence, and writing durable state back to Linear, GitHub, and (eventually) telemetry. "Control plane" is the standard term for such a coordination layer; "integration" captures that its job is specifically to be the glue between those five surfaces rather than a general-purpose agent runtime.
- Upstream ADRs (0001, 0003, 0005, 0006, 0007, 0008) still use "ACL" and the category label "ACL-Routed" in their own text; those documents are not edited by this ADR. References below that quote those ADRs preserve the original term. Everywhere this ADR speaks in its own voice, the term is **ICP**.

A prior revision of this ADR framed the first vertical slice as `acl dispatch LAT-<n> --approve` — i.e. a CLI was the first architectural asset. Review feedback rejected that framing: the CLI is an operator surface, not the core abstraction, and structuring the architecture around it would couple the durable shape to argument parsing and would not generalise to the next caller (Perplexity shell-call, scheduler, a second agent harness, a test harness, a service surface later). The durable asset is the **skill framework** — reusable, versioned, provenance-anchored agent capabilities — and the CLI is one of several thin harnesses that invoke skills. This revision makes that framing explicit and moves the skill framework ahead of the CLI in the first slice.

Context already decided elsewhere:

- **ADR-0001** — Perplexity is intake/reasoning/control surface; Linear is the work graph; GitHub is the durable source of truth.
- **ADR-0003** — Linear persistence boundary and write-back contract; telemetry substrate deferred.
- **ADR-0004** — Process docs vs agent skills and commands: docs are canonical, skills/commands are operational adapters downstream of the docs, with a required `derived_from:` provenance header. This ADR's skill framework is the runtime side of ADR-0004's adapter regime.
- **ADR-0005** — Dispatch-readiness model, the `## Sequencing` block as the pilot connector-readable source, and the dispatch algorithm the ICP must implement. Native Linear relations are the migration target.
- **ADR-0006** — Run report envelope (the `run_id` / `agent_type` / `status` / `cost` / `correlation` shape every run must emit) and the five-element Linear write-back.
- **ADR-0007** — QA / PR-review evidence workflow the ICP must preserve when it dispatches QA/review agents.
- **ADR-0008** — The owned-substrate ⟷ Perplexity boundary and the four action categories (P-Direct, P-Propose, ACL-Routed, Stop). ADR-0008's category name "ACL-Routed" is preserved as a label when citing that ADR; inside ICP's own components and procedures, the equivalent routing is "ICP-Routed."

In-flight tickets (no dependency on their branches):

- **LAT-20** — language/runtime ADR. This ADR intentionally does not pick a runtime; it describes the architecture in runtime-neutral terms so LAT-20 can bind it.
- **LAT-6**, **LAT-11** — autonomy dial / operating posture refinements. This ADR treats ADR-0008's autonomy levels as stable and lets those tickets refine them without re-opening the architecture.

## Decision Drivers

- The ICP must be implementable in small, independently-mergeable pieces. A monolithic design blocks the pilot.
- **The durable asset is reusable agent capability, not a CLI.** Whatever surface a human or a scheduler or a second harness presents, the actual work — "dispatch this ticket", "post this write-back", "run the triage procedure" — must live as a named, versioned, provenance-anchored skill that any caller can invoke. The CLI is one such caller.
- The boundary between "what the ICP is responsible for" and "what Perplexity / Linear / GitHub / coding agents / telemetry are responsible for" must be explicit, so capability placement is a short conversation, not a re-derivation.
- The dispatch path must be deterministic and auditable end-to-end: read Linear → evaluate policy → invoke an agent → record the run → write back to Linear. Any hidden state between those steps is a defect.
- Merge, deploy, and autonomy-level changes remain human-gated (ADR-0008). The architecture must make those gates structural, not conventional — at the skill-contract level, not only at the CLI flag level.
- ADR-0008's anti-astronautics guardrail applies: no component exists unless it unblocks the first slice, prevents a known risk, or codifies a decision already relied on.
- Runtime choice is LAT-20's to make. The architecture must remain coherent whether LAT-20 picks Python, Node/TypeScript, Go, or something else.
- The first slice must be narrow enough to ship while exercising every component at least once; otherwise the boundaries are theoretical.
- ADR-0004's provenance rule (`derived_from:` canonical docs) must be enforceable at runtime, not just at review time. A skill without provenance is a structural bug the skill framework should be able to detect.
- The name must not collide with a standard infra term readers bring in from elsewhere. "Access Control List" is the dominant industry meaning of "ACL"; using that label for a coordination layer invites sustained confusion. "Integration Control Plane" is unambiguous and accurately describes the coordination role between user input, agents, external APIs, systems of record, and observability.

## Considered Options

1. **CLI-only.** The ICP is a set of CLI commands invoked from a terminal or from Perplexity as shell calls. All state lives on disk or in Linear/GitHub. No named skill abstraction — the CLI commands *are* the reusable unit. Rejected: structuring everything around a CLI entry point couples the dispatch and recording logic to argument parsing and shell I/O, makes it awkward to expose the same operations to a second caller (scheduler, webhook, test harness, second agent harness), and conflates "reusable capability" with "one specific surface." Also fails to satisfy ADR-0004 cleanly, because there is no runtime unit that owns the `derived_from:` contract.
2. **Service-first.** The ICP is a long-running service (HTTP/gRPC API, queue, persistent store, worker pool) from day one. Rejected: violates the ADR-0008 anti-astronautics guardrail. The pilot has one human operator, no concurrent agent runs, no cross-run coordination requirement, and no telemetry substrate yet. A service adds deployment, auth, persistence, and operational surface the pilot does not need, and it forces runtime/hosting decisions LAT-20 has not yet made.
3. **CLI-backed-by-library (previous revision).** The ICP's durable shape is a library of deterministic components with well-defined interfaces, and the first surface is a CLI. Rejected on review: "library of components" is right as far as it goes, but it under-specifies the reusable unit. Components (dispatcher, policy evaluator, …) are internal plumbing; the thing an operator or a second harness actually wants to invoke is a **skill** — a named, versioned, provenance-anchored capability composed from those components. Without a skill-level abstraction, each new caller has to re-compose the library by hand, and ADR-0004's provenance contract has no runtime home. This framing also elevated the CLI to first-class architectural asset, which reviewers rejected.
4. **Skill-framework-first, CLI as thin harness (accepted).** The ICP's durable shape is a **skill framework**: a skill contract (inputs, outputs, required tools/connectors, approval/autonomy level, evidence contract, `derived_from:` provenance), a skill registry (the set of skills available in this repo), and a skill runner (the deterministic execution pipeline that loads a skill, resolves its tools, evaluates policy, invokes agents, records the run, and writes back). Skills are built on top of a small library of shared components (Linear adapter, policy evaluator, run recorder, agent invocation adapter, write-back formatter). The CLI is a thin operator surface that takes a skill name plus arguments and invokes the skill runner. A second harness (Perplexity shell-call, a future service surface, a test harness, a scheduler) can invoke the same skill runner without touching the CLI. **Accepted.**
5. **Perplexity-plugin-only.** Implement the ICP as Perplexity custom connectors / skills with no owned code path. Rejected: explicitly contradicts ADR-0008. The whole point of the ICP is that we own the operational substrate independently of Perplexity's connector roadmap.

## Decision

**Accepted: Option 4 — Skill-framework-first, CLI as thin harness.** The ICP's durable shape is a skill framework (skill contract, skill registry, skill runner) built on a library of shared components. The first *operator* surface is a CLI, but the CLI is a thin harness over the skill runner, not the core abstraction. A service surface, a Perplexity shell-call harness, and a scheduler harness are all future callers of the same skill runner; none of them require the skill framework itself to change.

The concept formerly called the "Agent Control Layer (ACL)" in ADR-0008 is named here as the **Integration Control Plane (ICP)**: the owned coordination layer between user input, agents, external APIs, systems of record, and observability. It translates messy intent into governed work, selects skills, invokes agents/tools, enforces approval gates, records evidence, and writes durable state back to Linear / GitHub / telemetry. The name change is cosmetic; the architecture decision is substantive.

### What is a skill (in this system)

A **skill** is a reusable procedure / capability bundle that a caller (human operator via CLI, Perplexity via shell-call, future scheduler, future service surface, or another agent harness) can invoke by name to perform one bounded piece of work with auditable inputs and outputs. Every skill is defined by the same contract — this is the unit the skill registry stores and the skill runner executes.

A skill definition must declare:

- **Name and version.** Stable identifier (`dispatch-ticket`, `post-write-back`, `run-intake-triage`) and a semantic version. The registry rejects two skills with the same `name@version`. Version bumps are required for breaking input/output or policy changes.
- **Inputs.** Typed parameters, each with a name, type, and whether it is required. Example for `dispatch-ticket`: `linear_issue_id: string (required)`, `approve: bool (default false)`, `dry_run: bool (default false)`.
- **Outputs.** Typed result shape the caller receives. Must include — at minimum — a `status` field whose values map 1:1 to the skill runner's exit-code convention (`ready/succeeded`, `caution/failed`, `blocked/stopped`, `needs_human`). Additional fields per skill (e.g. `run_id`, `pr_url`, `linear_comment_url`).
- **Required tools and connectors.** The named external capabilities the skill needs to execute (`linear-adapter`, `coding-agent-runner`, `github-api`, `run-recorder`). The skill runner resolves these at load time; a skill that declares a tool the registry cannot provide fails fast at load, not mid-run.
- **Approval and autonomy level.** The ADR-0008 autonomy level at which this skill may run (`L1-read-only`, `L2-propose`, `L3-approve`, `L4-autonomous`) and whether an explicit per-invocation approval flag is required. The skill runner refuses to execute a skill above its allowed autonomy level without the approval flag — this is the structural human gate, enforced in the runner, not in the CLI.
- **Evidence contract.** What the skill must produce as proof of work. For dispatch-class skills, this is an ADR-0006 run report envelope plus the five-element Linear write-back. For read-only skills, a structured result plus any log lines a reviewer can paste into a Linear comment. A skill that runs to "success" without producing its declared evidence is a defect; the skill runner enforces this before returning.
- **Provenance (`derived_from:`).** A list of one or more repo-relative paths to the canonical doc(s) the skill adapts, per ADR-0004. The skill registry refuses to load a skill whose `derived_from:` list is empty or whose referenced paths do not exist. A `derived_at:` ISO date is required alongside, matching ADR-0004's provenance header.

A skill is therefore the runtime embodiment of an ADR-0004 adapter: the canonical doc in `docs/` says *what and why*, the skill file says *how*, and the skill runner enforces that the *how* declares which *what* it came from and produces the evidence the *what* requires.

Skills that cannot be expressed in this contract — long-running coordination tasks, multi-operator workflows, anything that needs to survive the runner process — are out of scope for the pilot and will require a follow-up ADR (see "intentionally deferred").

### How skills compose with ADR-0004 (canonical docs vs adapters)

ADR-0004 decided that `docs/` is canonical and skills/commands are operational adapters downstream of the docs, with a mandatory `derived_from:` header. This ADR is the runtime side of that decision:

- **Canonical docs (`docs/process/`, `docs/decisions/`)** define policy, procedure, and decision context — the "what and why." Humans read them; skills do not execute them directly.
- **Skills (loaded by the skill registry at runtime)** are the executable adapters that an agent or the skill runner actually invokes. Each skill's `derived_from:` header names the canonical doc(s) it adapts. The skill registry enforces that the header is present and the referenced paths exist; it does not yet enforce semantic fidelity (that is the CI drift check ADR-0004 anticipates).
- A skill that disagrees with its source doc is a bug in the skill, per ADR-0004. The skill runner does not silently paper over the disagreement; reviewers catch it at PR time via the `Affected adapters:` line, and a future CI check can upgrade this to a hard gate.
- ADR-0004's near-term adapter priorities (`commit-push-pr`, `intake-triage`, `adr-new`) become the near-term skill priorities for this framework, once the framework itself exists. The first of these — `dispatch-ticket` — is the first-slice skill (see below) because it is the one ADR-0008 most needs grounded in an owned substrate.

The skill framework thus operationalises ADR-0004: it is the mechanism by which "adapters downstream of canonical docs" stops being a review-time convention and becomes a structural runtime property (skill load fails if `derived_from:` is missing; skill run fails if the declared evidence contract is not produced).

### Components

The ICP is exactly nine components: three that make up the skill framework itself, and six that are shared building blocks the framework composes into skills. Each has a single responsibility, a stated input/output contract, and a stated dependency direction. Nothing else is in the ICP for the pilot.

**Skill framework (the durable architectural asset):**

1. **Skill contract.**
   - Responsibility: the shared type/interface definition every skill file conforms to — inputs, outputs, required tools, approval/autonomy level, evidence contract, `derived_from:` provenance, version. Defines the validation rules the registry and runner apply. Provides the ADR-0006 run report envelope type as the canonical "evidence" shape for dispatch-class skills.
   - Does not: execute skills, register skills, or call adapters. It is a pure schema/interface module.
   - Depends on: only the shared types used by other components (run report envelope, autonomy-level enum).
2. **Skill registry.**
   - Responsibility: discover, validate, and index the set of skills available in this repo at load time. Enforces the skill contract: rejects skills missing required fields, rejects duplicate `name@version`, rejects `derived_from:` paths that do not resolve, fails fast when a declared required tool is not provided by the runtime. Exposes lookup (`get(name, version?)`) to the skill runner and a listing (`list()`) to the operator interface.
   - Does not: execute skills, evaluate policy, or talk to Linear / agent runners. Pure load-and-validate.
   - Depends on: the skill contract, the filesystem / module loader, and the set of tool names the runtime can provide (for the fail-fast check). Not on the runner.
3. **Skill runner.**
   - Responsibility: given a resolved skill plus caller-supplied inputs, execute the skill's procedure deterministically end-to-end. Resolves declared tools to concrete adapter instances (Linear adapter, agent invocation adapter, run recorder, write-back formatter, policy evaluator). Enforces the autonomy/approval gate: if the skill's declared autonomy level exceeds the runtime default and the caller did not pass the approval flag, the runner returns `needs_human` without invoking side effects. Enforces the evidence contract: a skill that returns without producing its declared evidence is converted to `failed`. Emits a single run record per invocation (one ADR-0006 run report for dispatch-class skills, a lighter structured log for read-only skills).
   - Does not: contain skill-specific procedure logic (that lives in each skill's module), make Linear calls directly (the Linear adapter does), format the write-back string directly (the write-back formatter does), or parse CLI arguments (the operator interface does).
   - Depends on: the skill contract, the skill registry, the policy evaluator, the run recorder, the Linear adapter, the agent invocation adapter, the write-back formatter.

**Shared components the skill framework composes (library layer):**

4. **Linear adapter.**
   - Responsibility: the only path in or out of Linear for ICP-Routed actions (equivalent to ADR-0008's "ACL-Routed" category). Implements the Linear GraphQL operations named in ADR-0008 (`issueRelationCreate`, inline `issue.relations`, `issueRelationDelete`, issue status / parent / child / label reads, pagination) and the `## Sequencing` block read path per ADR-0005. Returns typed values; never returns raw GraphQL payloads upward.
   - Does not: decide whether to dispatch, format write-back text, know about skills, or know about agents.
   - Depends on: the Linear GraphQL endpoint and a credential source. Exposed to the skill runner as a named required-tool.
5. **Policy evaluator.**
   - Responsibility: pure function over a dispatch input (issue fields, `## Sequencing` block, blocker statuses, autonomy level, cost-band signal) that returns a structured verdict: `ready | caution | blocked | stop`, plus the reason list and the required human-approval flag. Encodes the ADR-0005 dispatch algorithm, the ADR-0008 four-category placement for the specific action, the ADR-0008 autonomy levels, and the ADR-0008 failure-posture rules (low / medium / high / runaway-cost).
   - Does not: perform I/O, read Linear, mutate state, invoke agents, or know about skills as a concept. It is deterministic and table-testable, reused by any dispatch-class skill.
   - Depends on: only the types used by its inputs. No adapters.
6. **Run recorder.**
   - Responsibility: produce and persist a run report that conforms to the ADR-0006 envelope (required core fields, strongly-recommended fields, open sub-objects). For the pilot, "persist" means write a Markdown + JSON run report file into the repo at a conventional path and return its URL/path. Emits the envelope shape the skill runner consumes to enforce evidence contracts, and that the write-back formatter consumes to produce the Linear comment.
   - Does not: decide policy, call Linear, call agents, format the Linear comment, or know about specific skills. It only owns the envelope.
   - Depends on: a filesystem / repo write path. Replaceable later by a telemetry-substrate writer without touching callers, per ADR-0006's forward-compatibility contract.
7. **Agent invocation adapter.**
   - Responsibility: the only path out of the ICP to a coding, QA, review, SRE, PM, research, or observability agent runner. Translates an invocation request (plus autonomy level and approval flag) into a concrete agent-runner invocation, captures the runner's exit signal (succeeded / failed / cancelled / needs_human), and returns the run's output artifacts (PR URL, run-id, cost signal if the runner provides one) in the ADR-0006 shape.
   - Does not: decide whether to invoke (the skill's procedure, composed via the runner, decides), format the write-back, or persist the run report.
   - Depends on: the concrete agent runner(s) available in the pilot. Kept behind an interface so LAT-20 can bind runners without changing the skill framework.
8. **Write-back formatter.**
   - Responsibility: given a run report envelope, produce the exact five-element Linear comment string defined by ADR-0006 (`Outcome` / `Evidence` / `Risks` / `PR` / `Next action` / `Open questions`) and hand it to the Linear adapter for posting. Enforces the ADR-0003 comment-shape guideline and the ADR-0007 QA/review evidence conventions when the run is a QA or review run.
   - Does not: decide what the outcome was, pick the next action, or post anything directly (the Linear adapter posts).
   - Depends on: the run report envelope type from the run recorder and the Linear adapter.
9. **Operator interface (thin CLI harness).**
   - Responsibility: the human (or Perplexity shell-call) entry point. For the pilot, this is a CLI whose job is argument parsing and wiring: take a skill name and arguments, hand them to the skill runner, surface the runner's structured result to the shell. Commands map 1:1 to skills: `icp run <skill-name> [--flag value …]` (generic), with a small set of convenience aliases where they are clearer (`icp dispatch LAT-<n> --approve` → `icp run dispatch-ticket --linear-issue-id LAT-<n> --approve`). Exposes `icp skills list` (via the registry) and `icp skills show <name>` (skill metadata, including `derived_from:`) so an operator can inspect what is available. Emits exit codes that reflect the skill runner's structured status (`0` ready/succeeded, `1` caution/failed, `2` blocked/stopped, `3` needs_human) so shell callers can script around it.
   - Does not: contain dispatch logic, policy rules, Linear/agent/GitHub calls, or skill-specific behaviour. A skill added to the registry is invocable via `icp run` without CLI changes; only named convenience aliases require a CLI edit. This is the structural expression of "CLI is a thin harness, not the core abstraction."
   - Depends on: the skill runner and the skill registry. It does not reach into the adapter layer except for read-only inspection commands where doing so is simpler than going through a skill (e.g. `icp skills list`).

The CLI binary name (`icp` above) is illustrative, not load-bearing. LAT-20 or the first CLI-implementation ticket may pick a different invocation name; what matters architecturally is that the CLI is a thin harness over the skill runner.

### Dependency direction (no cycles)

```
operator interface (CLI harness) ── other future harnesses (Perplexity shell, service, scheduler)
        │                                   │
        └───────────────┬───────────────────┘
                        ▼
                  skill runner
                   ▲    │
                   │    ▼
          skill registry ── skill contract
                        │
                        ▼
       ┌────────┬───────┼────────────┬──────────────┐
       ▼        ▼       ▼            ▼              ▼
    policy   run-    agent-      write-back     (other shared
    eval    recorder invocation  formatter       adapters added
                     adapter          │          as skills need)
                                      ▼
                                 Linear adapter
                                      │
                                      ▼
                              Linear GraphQL
```

- The skill contract is a leaf (pure types/interfaces). It never calls anything.
- The skill registry depends on the contract and on the filesystem/module loader. It does not depend on the runner.
- The skill runner is the composition point: it depends on the registry, the contract, and every shared adapter it may need to resolve as a tool for a skill.
- The policy evaluator is a leaf function. It never calls anything in the ICP.
- The Linear adapter is called by the skill runner (for dispatch-skill reads) and by the write-back formatter (for the write-back post). Nothing else talks to Linear.
- The agent invocation adapter is called only by the skill runner (when a skill declares it as a required tool). Nothing else talks to agent runners.
- The run recorder is called by the skill runner and read by the write-back formatter. Nothing else writes run reports.
- Other harnesses (Perplexity shell-call wrapper, future service surface, scheduler) sit at the same layer as the CLI harness: they all invoke the skill runner and differ only in how they collect arguments and present results.

Any change that introduces an edge not shown here (e.g. the policy evaluator calling the Linear adapter, the write-back formatter calling an agent runner, the CLI harness reaching into the Linear adapter to bypass a skill) is an architectural change and requires an ADR update.

### External boundaries

The ICP is the only component in the system that may:

- Read or write Linear native relations, or post ADR-0003-shaped write-back comments.
- Select the next dispatchable `LAT-*` issue per ADR-0005.
- Invoke a coding, QA, review, SRE, PM, research, or observability agent runner for a dispatched ticket.
- Emit an ADR-0006 run report.
- Apply an ADR-0008 autonomy-level or failure-posture rule to an action.
- Load, register, or execute a skill that claims ICP-Routed authority (the concrete form of ADR-0008's "ACL-Routed" category).

The following are explicitly *not* the ICP's responsibility, and the architecture must keep them out:

- **Perplexity.** Cognition, triage, drafting, read-heavy analysis. May call the ICP via the skill runner (through the CLI harness as a shell-call, or later a dedicated Perplexity shell-call harness) but never bypasses it for ICP-Routed actions (ADR-0008 rule matrix).
- **Linear.** Durable work graph and human review surface (ADR-0001, ADR-0003). The ICP reads and writes through the Linear adapter; it does not replicate Linear state.
- **GitHub.** Durable source of truth for code, docs, ADRs, run reports (during the pilot), and PRs (ADR-0001). The ICP does not manage GitHub directly; opening PRs and pushing commits is the agent runner's job (ADR-0007). A skill records the resulting PR URL via `correlation.pr_url` in the run report.
- **Coding / QA / review agents.** Doing the actual work on a dispatched ticket. They return exit signals and artifacts; they do not post to Linear (a skill's evidence contract, via the write-back formatter, does) and they do not evaluate dispatch policy.
- **Future telemetry substrate.** Long-term run storage, cross-run queries, dashboards (ADR-0003, ADR-0006). Until it exists, the run recorder writes Markdown + JSON to the repo and that is sufficient for pilot volume. When the substrate lands, it replaces the run recorder's persist step; no skill and no other component changes.
- **Operator judgement.** Approval at L3 and above, any Stop-category action, any autonomy-level change. The skill runner asks (by returning `needs_human` or `stop`), it does not decide.

The ICP therefore sits exactly at the seam between **user input → agents → external APIs → systems of record → observability**, and its job is to be the governed coordination layer across that seam. That is the reason "Integration Control Plane" is the right name: each of those five surfaces is a separate system that the ICP integrates, and "control plane" is the standard term for a coordination layer that selects and governs work rather than doing the work itself.

### First vertical slice

The implementation backlog should build exactly this slice first. It is the smallest path that stands up the skill framework, proves one dispatch-class skill against it end-to-end, and exercises every shared component at least once.

**Goal:** from a single skill invocation (via the thin CLI harness, for the pilot), load and validate a registered `dispatch-ticket` skill, read a named `LAT-*` issue from Linear, evaluate it against the ADR-0005 dispatch algorithm and the ADR-0008 policy matrix, invoke one bounded coding-agent run with explicit human approval, record the run against the ADR-0006 envelope, enforce the skill's declared evidence contract, and post the ADR-0006 five-element write-back back to Linear.

**Concretely, the first slice delivers:**

1. **Skill contract.** The shared interface/type module that every skill file conforms to. Inputs, outputs, required tools, approval/autonomy level, evidence contract, `derived_from:`, version. One passing validator for a known-good skill definition and one for a known-bad one (missing `derived_from:`, duplicate `name@version`, unknown required tool).
2. **Skill registry.** Loads all skill files under the conventional skills directory, validates each against the contract, fails fast with a readable error if any skill is malformed, and exposes `get(name, version?)` / `list()`.
3. **Skill runner.** Executes a skill end-to-end: resolve required tools to shared-component instances, enforce autonomy/approval gate, run the skill's procedure, enforce evidence contract, return a structured result. One passing integration test that executes the first-slice skill from registry load through write-back.
4. **One skill: `dispatch-ticket@0.1.0`.**
   - Inputs: `linear_issue_id: string (required)`, `approve: bool (default false)`, `dry_run: bool (default false)`.
   - Outputs: `status: ready/succeeded | caution/failed | blocked/stopped | needs_human`, `run_id`, `linear_issue_id`, `pr_url` (nullable), `linear_comment_url` (nullable), `reasons: string[]`.
   - Required tools: `linear-adapter`, `policy-evaluator`, `agent-invocation-adapter` (coding agent runner bound), `run-recorder`, `write-back-formatter`.
   - Approval / autonomy: declared `L3-with-approval`, requires the approval flag for any side-effecting run; `--dry-run` bypasses invocation and write-back and is allowed without approval.
   - Evidence contract: one ADR-0006 run report (Markdown + JSON) plus, for non-dry-run runs, one ADR-0006 five-element Linear comment. The runner rejects a "succeeded" result that did not produce these.
   - `derived_from:` `docs/decisions/0005-linear-dependency-and-sequencing-model.md`, `docs/decisions/0006-agent-run-visibility-schema.md`, `docs/decisions/0008-agent-control-layer-and-perplexity-boundary.md`.
5. **Shared components used by the first slice skill:**
   - **Linear adapter.** Reads the candidate issue (description + status), reads the `## Sequencing` block, reads each hard blocker's status. One Linear write path: post the five-element write-back comment. No native-relation writes in the first slice — reads only — because ADR-0005 still requires the `## Sequencing` block to be authoritative until its follow-up ADR.
   - **Policy evaluator.** Implements `ready | caution | blocked | stop` over `## Sequencing` + blocker statuses + the autonomy-level default (L3-with-approval for ICP-dispatched agents, per ADR-0008) + the runaway-cost stop rule. No cost-band quantification yet (ADR-0008 open question 3); treat any unknown cost as `caution` rather than `ready`.
   - **Agent invocation adapter.** One agent runner bound. One agent type bound (`coding`). The runner returns an exit signal and a PR URL (or `n/a`). Other agent types are stubs that error out — they are added in subsequent tickets and subsequent skills, not this slice.
   - **Run recorder.** Writes a run report Markdown + JSON file at a conventional repo path with the ADR-0006 required core fields and every strongly-recommended field the first slice can populate (`triggered_by: user`, `linear_issue_id`, `autonomy_level: L3`, `correlation.pr_url`, `correlation.commit_sha` if known).
   - **Write-back formatter.** Renders the five-element comment from the run report envelope and hands it to the Linear adapter.
6. **Operator interface (thin CLI harness).** `icp run dispatch-ticket --linear-issue-id LAT-<n> --approve` (and `--dry-run` for policy-only). The convenience alias `icp dispatch LAT-<n> --approve` is acceptable as sugar, but it is wired to the same skill. `icp skills list` and `icp skills show dispatch-ticket` work from day one. Exit codes as defined above. No TUI, no config file beyond credentials. The binary name (`icp`) is illustrative; the CLI-implementation ticket or LAT-20 may choose otherwise without changing this architecture.

This slice is also the end-to-end test: if the skill runner can load `dispatch-ticket`, the CLI harness can invoke it, it can dispatch one real `LAT-*` ticket, start one coding-agent run, record it, and post the write-back, every component boundary — skill framework and shared adapters — is exercised. Adding the second skill (e.g. `post-write-back-only` or `intake-triage`) after this is a skill-file + `derived_from:` addition, not an architectural change.

### What is intentionally deferred

Listed here so future tickets do not have to re-discover that they are out of scope for this ADR. None of these are forbidden; they each require a follow-up ADR or an implementation ticket with an explicit scope decision.

- **Additional harnesses beyond the CLI.** A dedicated Perplexity shell-call harness, a service surface (HTTP/gRPC), a scheduler harness, a webhook receiver. All of these invoke the same skill runner; none require the skill framework itself to change. Deferred until a concrete second caller forces one.
- **Additional skills beyond `dispatch-ticket`.** `intake-triage`, `commit-push-pr`, `post-write-back`, `adr-new`, QA/review/SRE/PM/research/observability dispatch skills. Each is a follow-up ticket. ADR-0004's near-term adapter priorities order the first few. Adding one is a skill-file + `derived_from:` change; the framework does not move.
- **Skill versioning policy (breaking vs compatible changes, deprecation windows, multiple live versions in registry).** The first slice accepts one live version per skill name. A follow-up ADR handles multi-version coexistence when a concrete compat break lands.
- **CI enforcement of `derived_from:` semantic fidelity.** ADR-0004 anticipates this. The skill registry enforces the header exists and paths resolve; it does not yet diff the skill against the doc.
- **Skill signing / provenance beyond repo paths** (e.g. commit SHAs, registry-level signatures). Deferred until at least one skill outside this repo is consumed.
- **Native Linear relation writes.** ADR-0005 requires its own follow-up ADR before the dispatch source moves off the `## Sequencing` block. The Linear adapter may read native relations as a human-mirror cross-check, but `dispatch-ticket` does not consume them for dispatch yet.
- **Telemetry substrate.** ADR-0003 / ADR-0006 defer. The run recorder writes to the repo until the substrate ADR lands, at which point only the recorder's persist step changes.
- **Quantitative cost bands.** ADR-0008 open question 3. Until then, the policy evaluator treats unknown or elevated cost as `caution`.
- **Multi-tenant / multi-operator support.** Explicit non-goal.
- **Merge and deploy automation.** Stop-category in ADR-0008. Not in MVP; a future ADR is required to change this.
- **Batched L3 approvals.** ADR-0008 open question 2. Default per-action until decided.
- **Agent runners for QA / review / SRE / PM / research / observability.** Scoped in per-type implementation tickets and their corresponding skills under LAT-6 / LAT-11 and their successors. The agent invocation adapter is designed so adding a runner is a bounded change.
- **Runtime / language choice.** LAT-20. This ADR does not depend on a specific runtime.
- **Credential management.** ADR-0008 open question 4. Resolved when the Linear adapter is scoped as its own ticket.
- **`## Sequencing` ↔ native-relation parity automation.** ADR-0005 open question 1.
- **Propagating the ICP rename to upstream process docs and ADRs.** Follow-up tickets update `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`, and any renamed category labels (`ACL-Routed` → `ICP-Routed`) in ADR-0008 and its dependents. This ADR deliberately does not edit those so the naming decision lands in one reviewable place first.

### MVP-in vs MVP-out for orchestration complexity (acceptance criterion)

A recurring question during implementation will be "should the ICP also do X?" The default answer, per ADR-0008 and this ADR, is **no** unless X is one of the nine components above or the first slice requires it. Specifically:

- **In MVP:** exactly the nine components (skill contract, skill registry, skill runner, Linear adapter, policy evaluator, run recorder, agent invocation adapter, write-back formatter, CLI harness), exactly the first slice, exactly one skill (`dispatch-ticket@0.1.0`), exactly the read-path Linear usage described above, exactly one coding-agent runner bound, exit-code-based operator interface.
- **Out of MVP:** anything in the "intentionally deferred" list above; any new top-level ICP component; any new harness beyond the CLI; any skill whose `derived_from:` is empty or points at a doc that does not exist; any new external integration (Slack, email, dashboards); any autonomy level above L3-with-approval; any Stop-category action becoming non-Stop.

A request to add orchestration complexity is answered by pointing to this section. A request to add a new skill is answered by pointing to ADR-0004's near-term adapter list and the skill contract. Changing either of these requires a new ADR.

## Consequences

Good:

- The reusable unit is a **skill**, not a CLI command. Any future caller (Perplexity shell-call, scheduler, a future service surface, a second agent harness, a test harness) invokes the same skill runner with the same skill definitions; no logic moves.
- ADR-0004's provenance regime becomes structural at runtime: a skill without `derived_from:` does not load. Drift between canonical docs and executable adapters is detectable at the registry, not only at review time.
- Implementation can start immediately on the skill framework in runtime-neutral terms, unblocking LAT-20 to pick the runtime without re-opening architecture.
- Component boundaries are narrow enough that each component is an independent ticket, and the first slice touches all of them end-to-end.
- Adding a skill is a file-plus-header change, not an architectural change. Adding a harness is a thin wrapper around the skill runner, not a refactor of the skill framework. Both are bounded and reviewable.
- The dispatch path is auditable from a single run report: one envelope per skill invocation with side effects, every decision traceable to the policy evaluator and the `## Sequencing` block and the declared skill version.
- Merge, deploy, and autonomy-level changes remain structurally human-gated because the skill runner — not the CLI — enforces the approval gate on every skill above L2, for every caller.
- The "intentionally deferred" list gives future tickets a short reference for scope arguments.
- The name **Integration Control Plane (ICP)** replaces the ambiguous "Agent Control Layer / ACL" working title from ADR-0008 with a term that does not collide with "Access Control List" and that describes the actual role: the coordination layer between user input, agents, external APIs, systems of record, and observability.

Bad / open:

- Nine components is more surface than a single monolithic script, and during the first slice some components will feel underweight (the skill contract is pure types, the write-back formatter is almost trivial). This is deliberate: the slim components earn their keep the first time a second skill lands, a second harness lands, a runner changes, the write-back format grows, or the policy rules are extended.
- A skill framework on day one is more scaffolding than a CLI-only design would need. We accept this because the cost of retrofitting the abstraction later — after several CLI commands have accreted policy and adapter wiring — is higher than the cost of writing the contract and runner up front. Review feedback on the prior revision made this trade-off explicit.
- Keeping the Linear adapter as the only Linear caller requires discipline during implementation. Temptation will exist to let a skill procedure make "just one small" Linear call directly. This is an architectural change and must be rejected in review.
- Until the native-relation write path lands (separate ADR), the Linear adapter's read surface is richer than its write surface, which can make the adapter feel lopsided. Accepted for the pilot.
- The CLI harness being the only operator surface means Perplexity calls the ICP via shell execution, with all the brittleness of shell quoting and exit-code parsing that implies. If this becomes the dominant failure mode, that is the trigger to add a dedicated Perplexity shell-call harness (a different harness, still over the same skill runner), not to merge logic into the CLI.
- Runtime-neutral wording means LAT-20 can pick a runtime that makes one of the component boundaries awkward (e.g. a language without ergonomic interface/protocol types for the skill contract, or without a clean module-discovery story for the registry). Mitigation: LAT-20 explicitly considers these boundaries when it picks.
- Upstream docs (ADR-0001, ADR-0003, ADR-0005, ADR-0006, ADR-0007, ADR-0008, `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`) still use "ACL" and "ACL-Routed." Until a follow-up ticket propagates the rename, readers will encounter both terms. This ADR is the authoritative definition of the new term; the follow-up is mechanical.

## Open Questions

1. Where exactly in the repo the ICP library, the skill definitions, and the CLI harness live (likely `skills/` or `.claude/skills/` for skill files per ADR-0004 open question 1, plus an `icp/` package for the framework and shared components; ties into ADR-0004 and ADR-0008 open question 1). Resolved when LAT-20 picks the runtime.
2. Whether the skill registry loads from the same directory ADR-0004 governs (`.claude/skills/`) or from a parallel ICP-owned location. Leaning same directory, so ADR-0004's `derived_from:` regime has one home. Confirm when the first skill file is written.
3. Whether the run recorder writes run reports under a single `runs/` directory or co-located with the triggering ticket. Pilot preference: single `runs/` directory, one file per `run_id`, until the telemetry substrate replaces this.
4. Whether the policy evaluator should also emit a machine-readable reason list (for later consumption by Perplexity queries) in addition to human-readable reasons. Leaning yes; a small structured list in the run report under `decisions` satisfies both.
5. Whether `dispatch-ticket --dry-run` should post any write-back at all. Leaning no (dry-run means no external side effects), but allow `--dry-run --write-back` as an explicit opt-in if it proves useful during refinement.
6. Whether skills can compose (one skill invoking another through the runner) in the pilot, or whether composition is deferred. Leaning deferred: the first slice has one skill, and a second skill that calls the first would entangle the evidence contract. Revisit after the second non-trivial skill lands.
7. The exact CLI binary name (`icp` is used illustratively here). LAT-20 or the CLI-implementation ticket picks the final name; the architecture does not depend on it.
8. Whether the follow-up rename propagation (ACL → ICP, ACL-Routed → ICP-Routed in upstream ADRs and process docs) is one ticket or split by document. Pilot preference: one ticket, mechanical, no semantic edits.

## Confirmation

Working if, when the first slice ships:

- The skill registry loads `dispatch-ticket@0.1.0`, rejects a deliberately malformed sibling skill with a readable error, and lists both states via the CLI harness's `skills list` command.
- A single CLI invocation of `dispatch-ticket` (directly or via the `dispatch` alias) dispatches one `LAT-*` ticket end-to-end and produces one run report that matches ADR-0006 and one Linear write-back that matches ADR-0003 / ADR-0006.
- The skill runner refuses to execute `dispatch-ticket` without `--approve` at L3 for any caller, including a direct library call from a test harness — the gate is in the runner, not the CLI.
- No component has acquired a responsibility not listed above; in particular, no Linear GraphQL call exists outside the Linear adapter, no agent-runner invocation exists outside the agent invocation adapter, and no skill without a resolvable `derived_from:` exists in the registry.
- Implementation tickets for subsequent skills (QA dispatch, review dispatch, intake triage, …) change only the skill file(s) and, at most, the agent invocation adapter and write-back formatter — not the skill framework, the policy evaluator, or the run recorder.
- Adding a second harness (Perplexity shell-call, service surface, scheduler) is a wrapper around the skill runner that does not require editing any skill or any shared component.
- A request to add orchestration complexity is closed by citing the "MVP-in vs MVP-out" section without a new ADR.
- LAT-20's runtime choice binds cleanly to the component interfaces without forcing a component to move or merge.
- The name "Integration Control Plane (ICP)" is used consistently in this ADR and is the name future tickets adopt; the follow-up rename ticket has propagated it through upstream process docs and ADRs without semantic drift.

Revisit if any of those stops being true, or if the revisit trigger in the frontmatter fires.

## Links

- Linear: `LAT-19` (this ADR). Related in-flight: `LAT-20` (runtime), `LAT-6`, `LAT-11` (autonomy). Related context: `LAT-5`, `LAT-8`, `LAT-10`, `LAT-14`, `LAT-15`, `LAT-16`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0004-process-docs-vs-agent-skills.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md` (which uses the older "ACL" name for the same substrate).
- Process: `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`, `docs/process/intake-triage.md`, `docs/process/qa-review-evidence.md` (upstream docs still use "ACL" pending the follow-up rename).
- Templates: `docs/templates/agent-run-report.md`, `docs/templates/agent-ready-ticket.md`.
