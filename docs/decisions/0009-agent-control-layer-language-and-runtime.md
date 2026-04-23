---
id: ADR-0009
title: Agent Control Layer language, runtime, and package location
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-20
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) the ACL outgrows a single-process CLI and needs a long-running service, shared queue, or cross-run state; (b) a required integration (a specific agent runner SDK, a telemetry substrate client) ships only for another language and proxying is awkward; (c) TypeScript/Node friction on agent-driven maintenance exceeds the cost of a rewrite; or (d) Ben's personal stack preferences shift decisively toward Elixir/BEAM for owned services.
---

# ADR-0009: Agent Control Layer language, runtime, and package location

## Context

ADR-0008 accepted an owned **Agent Control Layer (ACL)** as the operational substrate for any action requiring first-class APIs, native Linear relation semantics, deterministic dispatch, PR convention enforcement, cost-band checks, or high-fidelity run recording. That ADR deliberately left the ACL as "deterministic skills and adapters committed to this repo" and scoped the first concrete capability to a **Linear GraphQL adapter** implementing `issueRelationCreate` / inline `issue.relations` / `issueRelationDelete` plus the ADR-0005 next-dispatchable algorithm.

Implementation cannot start without naming the language, runtime, and package location. Leaving it implicit would produce one of two bad outcomes: (1) whichever coding agent picks up the first ACL ticket picks whatever is easiest for that agent in the moment, locking us into an accidental choice; or (2) the first ticket stalls because the agent has to re-derive the decision before touching code.

This ADR picks the language, runtime, and package location. It does **not** pick libraries, frameworks, the GraphQL client, the test runner, or the deployment platform — those are implementation details that the first ACL ticket will settle. LAT-6 (autonomy dial / operating posture) and LAT-11 are in flight in parallel; this decision is deliberately scoped not to depend on either of their PRs, though it is written with their likely direction (CLI-invoked, human-approved dispatch) in mind.

## Decision Drivers

- **Linear GraphQL adapter is the first capability.** The chosen stack must have a mature, well-understood GraphQL client story and idiomatic typed API modelling. Linear publishes an official TypeScript SDK (`@linear/sdk`); no other language has an equivalent first-party client.
- **Deterministic, auditable, CLI-shaped workflow.** The pilot flow is "human (or Perplexity proposal) → ACL command → Linear/GitHub side effect → run report." A scriptable CLI that exits after each invocation matches that flow; a long-running service would be premature (ADR-0008's anti-astronautics guardrail).
- **Coding agents must be able to implement and maintain it.** Current agent runners (Claude Code, Codex-style CLIs, Cursor, etc.) have deeper training coverage and tooling affordances for TypeScript and Python than for Elixir. Friction on "agent writes/tests/ships a small change" directly affects pilot velocity.
- **Ben's stack.** Ben is advanced in TypeScript/JavaScript, Elixir, SQL, and Python; strong around Linux / Docker / Postgres / Kubernetes / AWS / observability. Any of TS, Python, or Elixir are viable for *him*; the differentiator is agent-maintainability and ecosystem fit, not personal capability.
- **Monorepo fit.** The repo today is docs-only (`docs/decisions/`, `docs/process/`, `docs/templates/`). Whatever stack we pick, its first package must land cleanly next to docs without dictating a global build system this early.
- **Cheap exit.** The ACL starts small. Whichever language we pick, we should be able to rewrite the first capability in a weekend if the choice turns out wrong. This biases toward the smallest reasonable surface: one package, one CLI entrypoint, no framework lock-in.
- **Growth path to a service.** ADR-0008 explicitly preserves the option of growing into a service (queue, cross-run coordination, telemetry ingest). The stack must not foreclose that path, but also must not pre-pay for it.

## Considered Options

1. **TypeScript on Node.js, scriptable CLI, `packages/acl/`.** First-party Linear SDK. Shared language with any future web/UI surface. Mature GraphQL ecosystem. Strong agent-maintainability. `pnpm` workspaces keep the monorepo light until a second package appears.
2. **Python (3.12+), scriptable CLI, `packages/acl/` or `acl/`.** Excellent agent-maintainability and scripting ergonomics. No first-party Linear SDK — would call Linear GraphQL via a generic client (`gql`, `httpx`) with hand-written or codegen'd types. Strong fit if the ACL grows toward data/ML tooling; weaker fit if it grows toward a web service Ben would also touch.
3. **Elixir/OTP, mix release, eventually a Phoenix service.** Best long-term fit for a stateful orchestrator (supervision trees, queues, distribution). Weakest agent-maintainability today; no first-party Linear SDK; premature for a pilot that doesn't yet need a service. Would lock out coding-agent velocity for a bet we don't yet need to make.
4. **Go, single static binary CLI.** Great deployment story. Decent GraphQL clients. Middling agent-maintainability relative to TS/Python. No first-party Linear SDK. Picks up operational strengths the pilot doesn't yet need and gives up ecosystem strengths it does.
5. **Bash + `gh` + `curl` against Linear GraphQL.** Zero dependencies. Rejected: no type safety, no structured testing, no sane path to run reports or cost-band logic, and any nontrivial capability turns into unmaintainable shell.
6. **Long-running service from day one (any language).** Rejected by ADR-0008's anti-astronautics guardrail. No pilot need justifies a queue, worker, or daemon yet.

## Decision

**Accepted: Option 1. TypeScript on Node.js, shipped as a scriptable CLI, in a new monorepo package at `packages/acl/`.**

### Language and runtime

- **Language:** TypeScript (strict mode). All ACL code is typed; the Linear adapter uses the official `@linear/sdk` types end-to-end so dispatch logic cannot silently drift from the Linear schema.
- **Runtime:** Node.js, current LTS at time of first commit. Pin the major via `.nvmrc` / `engines` in the package so agents don't flip between runtimes between tickets. No Deno, no Bun for the MVP — the deciding factor is ecosystem maturity for Linear SDK + any future agent-runner SDKs we adopt, not raw runtime ergonomics.
- **Package manager:** `pnpm` with a top-level workspace. Chosen over npm/yarn for workspace ergonomics and disk use; nothing in this ADR forecloses swapping later because the surface is one package.

### Runtime shape (CLI vs service vs hybrid)

- **Scriptable CLI, no long-running process.** Every ACL capability is exposed as a subcommand that runs, performs its side effect (or refuses), writes its run artefact, and exits non-zero on failure. Exit codes and machine-readable stdout (JSON on `--json`) are part of the contract because both humans and other agents will invoke it.
- **No orchestrator, no daemon, no queue, no UI.** If a future capability needs shared state or cross-run coordination, that triggers a new ADR (per ADR-0008's "grow into a service later" clause and the revisit trigger on this ADR).
- **Hybrid is allowed later, not now.** The CLI entrypoints are the contract; a future long-running mode can wrap them without breaking callers.

### Package location in the monorepo

- **New package:** `packages/acl/` at the repo root. Sibling to a future `packages/*` for additional owned surfaces.
- **Rationale for `packages/*`:** The repo is docs-only today (`docs/`). Introducing `packages/` rather than a bare `acl/` signals that more owned code (adapters, skills helpers, eventual service) belongs here, without pre-committing to any specific structure under `packages/`.
- **What does not move:** `docs/` stays as-is. Process docs and ADRs remain docs-first per ADR-0002 and ADR-0004. Skill definitions that agents invoke (per the ADR-0004 split) may later live under `skills/` or be co-located with `packages/acl/`; that placement is out of scope here and will be settled when the first skill ships.

## Implications

### Linear GraphQL integration

- Use `@linear/sdk` as the default path for the first adapter; fall back to raw GraphQL only for endpoints the SDK does not cover. This gives typed access to `issueRelationCreate`, `issue.relations`, `issueRelationDelete`, `IssueRelationType` (`blocks`, `related`, `duplicate`), issue status / parent / child / labels, and pagination — exactly the surface ADR-0008 named for the first capability.
- Authentication mode (personal API key vs OAuth app) and credential storage remain open (ADR-0008 Open Question 4); the implementation ticket picks the concrete approach. The stack choice here does not constrain that.

### Local development

- `pnpm install && pnpm --filter acl build && pnpm --filter acl test` is the expected loop.
- Secrets (Linear API token, later GitHub token) come from environment variables in a local `.env` that is git-ignored; the CLI reads them via a typed config module. No secret in the repo.
- Agents running the CLI in a sandbox must be able to set those env vars without network side effects at install time; this rules out postinstall scripts touching external services.

### Deployment

- **MVP: none.** The CLI runs wherever a human or agent invokes it (local dev box, agent sandbox, later a CI job). No hosted surface, no always-on process.
- When a service mode is eventually required (revisit trigger (a)), the likely path is a container image built from the same package, orchestrated wherever the rest of the homelab/AWS surface lands. This ADR intentionally does not pick that platform.

### Testing

- **Unit tests** for dispatch logic, rule-matrix checks, and adapter request shaping — runnable without network.
- **Contract tests** for the Linear adapter against a recorded GraphQL response fixture set; a live-credential smoke test is opt-in via env and not required in CI.
- Test runner choice (Vitest, Node's built-in, etc.) is left to the implementation ticket — not load-bearing for this decision.

### Future agent adapters

- The ACL will later host adapters for GitHub operations (beyond `gh` CLI conveniences), agent runners, and the telemetry substrate.
- Keeping the first package TypeScript aligns with the Linear SDK precedent and with most current agent runners' SDKs (including the Anthropic SDK). If a future adapter's best client is Python-only, we cross that bridge in a scoped ADR rather than pre-deciding polyglot today.

## Consequences

Good:

- Implementation can start immediately: language, runtime, package path, and CLI shape are all named.
- `@linear/sdk` gives the first adapter a typed, maintained client rather than hand-rolled GraphQL, directly shrinking the ADR-0008 "policy vs enforcement" gap.
- Coding agents have the shortest path to making small, correct changes — important while the ACL is still proving its shape.
- No premature service, queue, or framework. The package is small enough to rewrite if the decision proves wrong.
- `packages/acl/` establishes a clean home for subsequent owned code without forcing a global monorepo build system in this ticket.

Bad / open:

- We give up Elixir/OTP's native fit for a future stateful orchestrator. If the ACL grows into a long-running, concurrency-heavy service faster than expected, a partial rewrite (or a polyglot split where the stateful core is BEAM and the CLI stays TS) is on the table. The revisit triggers in the frontmatter cover this.
- Introducing `pnpm` / Node tooling adds the first non-docs build surface to the repo. Agents must install Node + pnpm before touching ACL code; until the first ticket lands, this is only a documentation cost.
- TypeScript's runtime/ESM/CJS quirks will bite at least once during the first ticket. Mitigated by keeping the package small and the entrypoint shape boring.
- Choosing TS does not by itself resolve ADR-0008 Open Question 1 (where skills/adapters live in the repo). That question reopens when the first skill definition (versus the adapter code) needs a home.

## Confirmation

Working if, by the time the first two ACL capabilities ship:

- A coding agent can clone the repo, read this ADR plus ADR-0008, and land a small ACL change without asking for language/runtime clarification.
- The Linear adapter uses `@linear/sdk` types end-to-end; dispatch logic references Linear fields via those types rather than stringly-typed GraphQL responses.
- The CLI is invokable by both a human and by Perplexity/an agent runner, with a stable `--json` mode that downstream run reports consume.
- We have not needed to introduce a second language for any owned ACL code.
- No decision in a follow-up ticket has been blocked on "but which language?"

## Open Questions

1. Exact Node LTS version to pin (resolved in the first implementation ticket; this ADR only requires "current LTS at time of first commit" and a pinned major).
2. Test runner (Vitest vs Node built-in vs other) — implementation detail.
3. Whether run reports are written by the ACL CLI itself or by a thin wrapper invoked after it — ties into LAT-6 / the run-report template in `docs/templates/agent-run-report.md`; out of scope here.
4. Credentials storage for the Linear token (ADR-0008 Open Question 4 — not reopened here, just not closed).
5. Whether `skills/` becomes a sibling of `packages/` or lives inside `packages/acl/` — deferred until the first skill definition needs a home.

## Links

- Linear: `LAT-20` (this ADR). Related in-flight: `LAT-6` (autonomy dial / operating posture), `LAT-11`. Related context: `LAT-5`, `LAT-10`, `LAT-14`, `LAT-16`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0003-linear-persistence-boundary.md`, `0004-process-docs-vs-agent-skills.md`, `0005-linear-dependency-and-sequencing-model.md`, `0008-agent-control-layer-and-perplexity-boundary.md`.
- Process: `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`.
