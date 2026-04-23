---
id: ADR-0011
title: Agent Control Layer language, runtime, and package location
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-20
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) the ACL outgrows a single-process skill/CLI host and needs a long-running service, shared queue, cross-run state, or multi-tenant telemetry ingest; (b) a required integration (a specific agent runner SDK, a telemetry substrate client, a vendor API) ships only for another language and bridging it from Node is demonstrably awkward (not merely inconvenient); (c) TypeScript/Node friction on agent-driven maintenance exceeds the cost of a rewrite on a concrete, measured basis (not a gut call); (d) the skill surface grows to a size where Node's startup cost per invocation becomes a UX problem for agents chaining many skill calls; or (e) Ben's personal stack preferences shift decisively toward Elixir/BEAM for owned services after the pilot has enough run data to compare.
---

# ADR-0011: Agent Control Layer language, runtime, and package location

## Context

ADR-0008 accepted an owned **Agent Control Layer (ACL)** as the operational substrate for any action requiring first-class APIs, native Linear relation semantics, deterministic dispatch, PR convention enforcement, cost-band checks, or high-fidelity run recording. That ADR deliberately left the ACL as "deterministic skills and adapters committed to this repo" and scoped the first concrete capability to a **Linear GraphQL adapter** implementing `issueRelationCreate` / inline `issue.relations` / `issueRelationDelete` plus the ADR-0005 next-dispatchable algorithm.

Implementation cannot start without naming the language, runtime, and package location. Leaving it implicit would produce one of two bad outcomes: (1) whichever coding agent picks up the first ACL ticket picks whatever is easiest for that agent in the moment, locking us into an accidental choice; or (2) the first ticket stalls because the agent has to re-derive the decision before touching code.

This ADR picks the language, runtime, and package location. It does **not** pick specific libraries, frameworks, the GraphQL client, the test runner, or the deployment platform — those are implementation details that the first ACL ticket will settle.

### What this ADR is architecting for

Review feedback on PR #14 correctly called out that "use TypeScript" is not, by itself, an architectural decision. The real decision is which runtime best supports the shape of work the ACL actually has to host. That shape, from ADR-0008 and from the LAT-19 direction, has two tiers:

1. **Skills framework first.** The ACL's primary surface is a set of composable, typed **skills** — small deterministic units (Linear relation CRUD, dispatch selection, PR convention checks, cost-band gate, run-report writer) that both humans and agents invoke. Skills are the unit of reuse and the unit of test. The ACL's job is to host them cleanly: typed inputs/outputs, structured errors, consistent logging, uniform config/secret loading, uniform run-artefact emission.
2. **CLI surface second, not first.** A CLI is *one* of several ways skills get invoked (the others being agent-harness skill calls and, later, a thin programmatic API). The CLI shape matters, but designing around "it's a CLI" first would couple the contract to argv/stdout and make the skills framework a second-class citizen. LAT-19 is being updated to prioritise the skills framework; this ADR is consistent with that order.

The runtime choice therefore has to be judged against **what makes skills good** (typed contracts, testability, modularity, low ceremony to add a skill, clean way to expose the same skill to an agent harness and a CLI) before it is judged against **what makes CLIs good** (startup time, single binary, argv ergonomics). Both matter; skills come first.

### Dimensions we are actually deciding on

The decision is not one-dimensional ("which language is nicer"). It is a weighted comparison across dimensions that each have pilot-relevant consequences:

1. **Tooling ecosystem** — language server, formatter, linter, test runner, type checker, dependency manager; how much ceremony to add a second package.
2. **Modularity and package boundaries** — how naturally the language/runtime expresses small skills with typed contracts, internal APIs between skills and adapters, and a stable public surface.
3. **Typed contracts and schema generation** — can skill inputs/outputs, Linear GraphQL responses, and run-report artefacts be strongly typed from a schema with no hand maintenance?
4. **Testability** — unit, contract (against recorded vendor responses), and end-to-end with real credentials, all runnable locally and in CI without heroics.
5. **Agentic coding / tooling support** — can Claude Code / Codex-style agents / Cursor read, modify, test, and ship small changes to the ACL with low friction? How good is training coverage, tool support (e.g. `tsc --noEmit` feedback), and idiom stability?
6. **SDK / client ecosystem for the integrations we know we need** — Linear (first), GitHub (soon), Anthropic / agent-runner SDKs (soon), telemetry substrate (later). First-party SDKs beat hand-rolled clients when they exist.
7. **Deployment ergonomics** — MVP is local/agent-sandbox invocation; the honest question is the cost of the eventual jump to a container or long-running process. A runtime that makes that jump painful is a problem even if today we do not make the jump.
8. **Local / developer experience** — how fast is "clone → install → test" for a human; how fast is "modify → rerun" for an agent; how well does the toolchain behave in ephemeral sandboxes (no postinstall network calls, deterministic installs).
9. **CI / release implications** — lockfile determinism, install speed in CI, reproducibility, release-artifact shape, secret handling story.
10. **Future service migration** — if/when the ACL outgrows a per-invocation process and needs a queue, scheduler, or stateful core, how expensive is that move? Can the skills be kept as-is behind a new entrypoint, or do they have to be rewritten?

The options are then compared on these ten dimensions, not on language preference.

## Decision Drivers

- **Skills framework is the primary architectural unit.** The runtime must make a typed skill — one that an agent harness, a CLI, and (later) a programmatic caller all see as the same contract — the path of least resistance. A runtime that makes this easy wins even if it loses on other dimensions.
- **Linear GraphQL adapter is the first concrete integration.** The chosen stack must have a mature, well-understood GraphQL client story and idiomatic typed API modelling. Linear publishes an official TypeScript SDK (`@linear/sdk`); no other language has an equivalent first-party client. This biases — but does not by itself decide — the choice.
- **Deterministic, auditable, skill-shaped workflow.** Every skill invocation is a unit: runs, performs its side effect (or refuses), writes its run artefact, exits non-zero on failure. Skills compose but the individual invocation is the audit unit. A long-running service would be premature (ADR-0008's anti-astronautics guardrail) and would also obscure this audit shape.
- **Coding agents must be able to implement and maintain it.** Current agent runners (Claude Code, Codex-style CLIs, Cursor) have deeper training coverage and tighter tooling integration for TypeScript and Python than for Elixir. Friction on "agent writes/tests/ships a small change" directly affects pilot velocity, which is the pilot's main constraint.
- **Typed contracts end-to-end.** Skill inputs, skill outputs, Linear GraphQL responses, and run-report artefacts should all be typed from schemas where schemas exist. Hand-rolled types are acceptable only where no schema is available.
- **Ben's stack.** Ben is advanced in TypeScript/JavaScript, Elixir, SQL, and Python; strong around Linux / Docker / Postgres / Kubernetes / AWS / observability. Any of TS, Python, or Elixir are viable for *him*; the differentiator is agent-maintainability and ecosystem fit, not personal capability.
- **Monorepo fit.** The repo today is docs-only (`docs/decisions/`, `docs/process/`, `docs/templates/`). Whatever stack we pick, its first package must land cleanly next to docs without dictating a global build system this early.
- **Cheap exit.** The ACL starts small. Whichever language we pick, we should be able to rewrite the first capability in a weekend if the choice turns out wrong. This biases toward the smallest reasonable surface: one package, a skills module, a thin CLI entrypoint, no framework lock-in.
- **Growth path to a service.** ADR-0008 explicitly preserves the option of growing into a service (queue, cross-run coordination, telemetry ingest). The stack must not foreclose that path, but also must not pre-pay for it.
- **Anti-astronautics.** No architecture that does not unblock the next pilot slice, prevent a known risk, or codify a decision already being relied on.

## Considered Options

1. **TypeScript on Node.js**, skills module + scriptable CLI, `packages/acl/`, `pnpm` workspace.
2. **Python (3.12+)**, skills module + scriptable CLI, `packages/acl/` or `acl/`, `uv` or `poetry`.
3. **Elixir/OTP**, `mix` project, skill modules invokable via `mix` tasks / escript, eventually a Phoenix service.
4. **Go**, single static binary CLI with skills as internal packages, `cmd/acl/` + `internal/skills/`.
5. **Bash + `gh` + `curl`** against Linear GraphQL.
6. **Long-running service from day one** (any language).

## Comparative analysis

The comparison below judges options 1–4 on the ten dimensions from Context. Options 5 and 6 are rejected for reasons captured under "Other rejected options" and do not warrant a per-dimension pass.

### 1. Tooling ecosystem

- **TypeScript / Node.** `tsc`, `eslint`, `prettier`, `vitest` / Node's built-in test runner, `tsx` for direct execution, `pnpm` for fast deterministic installs. Every modern agent harness integrates with `tsc --noEmit` and eslint output cleanly. Mature monorepo tooling (`pnpm` workspaces, `turbo`/`nx` optional later).
- **Python.** `ruff` covers lint+format+import sort in one tool and is genuinely excellent. `pyright`/`mypy` for types; `pytest` for tests; `uv` has dramatically improved install speed and lockfile determinism. Still two-languages-worth-of-tooling in practice because the type system is optional and library type coverage is uneven.
- **Elixir.** Excellent built-ins: `mix`, ExUnit, `dialyxir`/`dialyzer`, `credo`. Tooling is coherent and stable. Downside: smaller ecosystem of pre-built linters/formatters for adjacent concerns (Markdown, JSON schema, GraphQL codegen).
- **Go.** Famously coherent toolchain: `go build/test/fmt/vet`, `golangci-lint`. Best-in-class for single-language projects. Weaker than TS/Python for GraphQL codegen and for rich typed-schema workflows; strongly idiomatic about interface shapes that don't map cleanly to "skill as typed input/output function."

Ranking for our use: **TS ≥ Python > Elixir > Go** (GraphQL+codegen+agent-harness integration carries TS).

### 2. Modularity and package boundaries

- **TS.** `pnpm` workspaces make per-skill sub-packages cheap if we ever want them; until then a single package with a `src/skills/` directory and per-skill `index.ts` is idiomatic. ES modules give clean public/private boundaries. Typed interfaces between skills and adapters are natural.
- **Python.** Packages are fine; namespace packages work. Boundaries between skills and adapters rely on discipline more than on compiler enforcement (no non-exported symbols by default). Runtime-typed inputs need Pydantic or similar to match TS's compile-time guarantees.
- **Elixir.** Modules are excellent units; behaviours (`@behaviour`) give typed-ish contracts; umbrella apps scale to many skills. Genuinely elegant for this shape — but the "skill" abstraction has to be hand-built (no community convention), and the payoff only lands if the ACL grows large.
- **Go.** Packages are strict. `internal/` enforces real privacy. Interfaces are structurally typed, which fits skill contracts well. Monorepo/multi-module ergonomics are improving but still more manual than pnpm workspaces.

Ranking: **Elixir ≈ TS > Go > Python**. TS wins on community convention + tooling even though Elixir/Go are slightly more rigorous about module boundaries.

### 3. Typed contracts and schema generation

This is a big one for the skills framework. The ACL will consume Linear's GraphQL schema and will emit run-report artefacts that match `docs/templates/agent-run-report.md` and related templates.

- **TS.** `@linear/sdk` ships generated types from the real Linear schema. For skill I/O and artefact schemas, `zod` (or `valibot`, `arktype`) gives a single source that produces both runtime validators and static types. JSON Schema ↔ TS is mature. GraphQL codegen (`graphql-codegen`) is the de facto standard.
- **Python.** Pydantic v2 is genuinely excellent; it gives runtime validation + static types from a single model. GraphQL codegen exists (`ariadne-codegen`, `gql`'s DSL) but is less mature than TS codegen. No first-party Linear types.
- **Elixir.** `Ecto.Schema` / `typed_struct` / `NimbleOptions` cover structured data, but there is no community-standard "one schema, runtime + static types + JSON Schema" pipeline. GraphQL client code is usable (`neuron`, `absinthe_client`) but typing is hand-rolled. No first-party Linear types.
- **Go.** Strongly typed, but in a way that makes codegen central rather than optional. GraphQL codegen exists (`genqlient`); schema → Go works. JSON Schema → Go is mature. No first-party Linear SDK; we would consume GraphQL via codegen. More upfront ceremony than TS or Python.

Ranking: **TS > Python > Go > Elixir** (driven by Linear SDK existing in TS, and by `zod`-style dual runtime/static schemas).

### 4. Testability

- **TS.** Unit tests trivial. Contract tests against recorded GraphQL responses: `msw` or hand-rolled fetch stubs. Snapshot testing for run-report artefacts is native. Vitest is fast; Node's built-in test runner is adequate and dependency-free. Test parallelism is good.
- **Python.** `pytest` is genuinely delightful. Contract tests: `vcrpy` / `responses` / `respx`. Snapshot testing is well supported. Marginally easier than TS for shell-ish integration tests because Python is a better shell glue language than Node.
- **Elixir.** ExUnit is excellent; `Mox` + behaviour-based mocking is one of the cleanest testing stories in any language. Contract tests against recorded HTTP responses: `Bypass`, `Mox`. Snapshot testing is less mainstream.
- **Go.** Standard `testing` package is minimal but effective. `httptest` for recorded responses. Table-driven tests are idiomatic and fit skill contracts well. Snapshot testing is less mainstream.

Ranking: **Python ≈ Elixir ≥ TS > Go** (all four are good enough; Python and Elixir are slightly better for this specific shape).

### 5. Agentic coding / tooling support

This is the dimension where the gap is largest and where pilot velocity is most sensitive.

- **TS.** Deepest training coverage of any typed language for current agent runners. `tsc --noEmit` provides fast, machine-readable feedback that agents already know how to consume. `eslint --format json` likewise. Agent-generated TS with strict mode and Zod schemas is idiomatic and reviewable.
- **Python.** Also extremely deep training coverage. But the *typed* Python an ACL needs (Pydantic + pyright strict) has thinner coverage than "Python scripts." Agents tend to regress typed Python into dynamically typed Python unless explicitly constrained. Type-checker output is less uniformly consumed by agent harnesses than `tsc`.
- **Elixir.** Shallower training coverage. Agents can produce correct Elixir for common shapes, but OTP patterns (supervision trees, GenServers, behaviours) are more error-prone, and `dialyzer` feedback loops are slower and noisier than `tsc`. This is the dimension where Elixir loses decisively today.
- **Go.** Solid training coverage. Go's strictness (unused imports, error handling) actually helps agent-generated code — many classes of bugs become compile errors. Interface satisfaction being implicit occasionally confuses agents. Overall: good, but less "agent-native" than TS today.

Ranking: **TS > Python > Go >> Elixir**.

### 6. SDK / client ecosystem for known integrations

- **Linear** (first): first-party TS SDK (`@linear/sdk`) with generated types. Python: no first-party SDK; community `linear-api` wrappers exist but are thin. Elixir / Go: no first-party SDK; raw GraphQL only.
- **GitHub** (soon): Octokit for TS is first-party and mature. PyGithub is solid. Elixir has `tentacat`; Go has `go-github` (first-party, excellent). Roughly even except Python lags slightly.
- **Anthropic / agent-runner SDKs** (soon): Anthropic SDKs are first-party for TS and Python, with parity and fast release cadence. Go has a first-party SDK but with less surface coverage. Elixir: community-only.
- **Telemetry** (later): OpenTelemetry is first-class in all four languages; Node and Go have the most mature auto-instrumentation; Elixir has `Telemetry` built-in but OTel integration is younger; Python is mature.

Ranking: **TS > Python ≈ Go > Elixir** for our specific integration set.

### 7. Deployment ergonomics

- **TS / Node.** MVP deployment is "run locally or in an agent sandbox." Container path is a thin `node:lts-alpine` image + `pnpm install --prod`. Long-running service later: straightforward. Cold-start is the worst of the four options (~100–300 ms for Node startup); this matters if agents chain many skill calls, and is a real revisit trigger, not a theoretical one.
- **Python.** Similar story. Cold-start comparable to Node. Virtualenv / image size slightly larger historically; `uv` has closed most of the gap.
- **Elixir.** `mix release` produces a self-contained release. Great for long-running services; less great for "invoke once and exit" because the BEAM startup cost dwarfs the actual work for a per-invocation skill. Escripts exist but are awkward.
- **Go.** Best-in-class for CLI: single static binary, negligible cold-start, trivial container image (scratch or distroless). If the ACL were *CLI-first*, Go would lead this dimension.

Ranking for our shape: **Go > TS ≈ Python > Elixir** for MVP; **Elixir > Go ≈ TS ≈ Python** for an eventual long-running service.

### 8. Local / developer experience

- **TS.** `pnpm install` is fast and deterministic; `tsx src/cli.ts` runs without a build step during development; `pnpm test` is fast. Sandbox-friendly (no required postinstall network calls if we ban them in CI). `.nvmrc` + `engines` pins Node.
- **Python.** `uv sync` is extremely fast now; ergonomics are good. Virtualenv activation is still an occasional friction point for agents.
- **Elixir.** `mix deps.get && mix test` works; compile step is longer than TS/Python for small changes. Hot-reload is great for servers, irrelevant for per-invocation skills.
- **Go.** `go test ./...` is fast; `go run` works without a project file. Minimal friction.

Ranking: **TS ≈ Go ≈ Python > Elixir**.

### 9. CI / release implications

- **TS.** `pnpm` lockfile is deterministic; `pnpm install --frozen-lockfile` in CI is the standard. Release artefact today is "source + lockfile"; if/when we publish, either `npm publish` or a container image. Secret handling is via env vars; no framework-specific story needed.
- **Python.** `uv.lock` is deterministic. `uv sync --frozen` in CI. Release: wheel or container.
- **Elixir.** `mix.lock` is deterministic. CI speed is decent but Dialyzer PLT caching is its own chore. Release: `mix release` tarball or container.
- **Go.** `go.sum` is deterministic. CI is the fastest of the four for small projects. Release: single binary per platform.

Ranking: **Go > TS ≈ Python ≈ Elixir** (Go's single-binary release story is a real advantage, but not load-bearing for the pilot).

### 10. Future service migration

The question here is: *if the ACL has to become a long-running service with a queue, scheduler, or stateful core, what does that migration cost, and can the skills survive it unchanged?*

- **TS.** The skills module is runtime-agnostic; wrapping it in Fastify / Hono + BullMQ (or similar) is straightforward. Skills themselves need not change. Downsides: Node's concurrency model (event loop + workers) is adequate but not as clean as Elixir's for heavily concurrent orchestration. Upside: same language for CLI and service means no polyglot handoff.
- **Python.** Same story as TS with FastAPI + Celery/RQ. Global interpreter lock is a real concern only for CPU-bound work, which the ACL is not.
- **Elixir.** This is where Elixir shines: OTP gives supervision, per-request isolation, and distribution natively. *If* the ACL grows into a stateful orchestrator, Elixir is the least-pain target. The cost is paying Elixir's agent-maintainability tax for the entire pilot before we know whether that service ever materialises.
- **Go.** Excellent for services generally, but skills written as Go functions would likely need reshaping to fit an HTTP handler surface; not a rewrite, but more than "wrap and go."

Ranking for the honest "we might need this later" case: **Elixir > TS ≈ Go > Python**, with a heavy asterisk that paying Elixir's cost today against a maybe-never future service is exactly the astronautics ADR-0008 warned about.

### Summary of the comparison

No option wins on every dimension. The weighting that matters for *this* pilot, in *this* quarter, with *these* constraints:

- Skills framework + typed contracts + Linear SDK + agent-maintainability are **load-bearing today**.
- Deployment ergonomics and future service migration are **real but deferred** (MVP runs locally or in an agent sandbox; the service may never materialise).
- CLI ergonomics are **a nice-to-have**, not the primary surface.

TypeScript wins on the load-bearing dimensions (1, 3, 5, 6 strongly; 2, 4, 8, 9 at parity or better-by-a-nose). It loses to Go on deployment (7) and to Elixir on future service migration (10), both deferred. The revisit triggers in the frontmatter cover the cases where those deferred losses become load-bearing.

## Decision

**Accepted: Option 1. TypeScript on Node.js, shipped as a skills module plus a thin scriptable CLI, in a new monorepo package at `packages/acl/`.**

### Language and runtime

- **Language:** TypeScript (strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). All ACL code is typed end-to-end. The Linear adapter uses `@linear/sdk` types end-to-end so dispatch logic cannot silently drift from the Linear schema. Skill input/output contracts use a schema library (`zod` or equivalent) so we get one source of truth for runtime validation and static types; library choice is an implementation detail.
- **Runtime:** Node.js, current LTS at time of first commit. Pin the major via `.nvmrc` and `"engines"` in the package so agents do not flip between runtimes between tickets. No Deno, no Bun for the MVP — the deciding factor is ecosystem maturity for Linear SDK + any future agent-runner SDKs we adopt, not raw runtime ergonomics.
- **Package manager:** `pnpm` with a top-level workspace. Chosen over npm/yarn for workspace ergonomics and disk use; nothing in this ADR forecloses swapping later because the surface is one package today.

### Runtime shape: skills framework first, CLI second

- **Skills module is the primary surface.** Every ACL capability is a typed skill with a declared input schema, output schema, side-effect category (read / reversible-write / irreversible-write), cost-band, and structured-error contract. Skills are the unit of reuse, test, audit, and review. Agent harnesses and other programmatic callers import skills directly.
- **CLI is a thin adapter over the skills module.** The CLI exposes each skill as a subcommand; it parses argv into the skill's input schema, invokes the skill, and emits machine-readable output (`--json`) plus a run artefact. The CLI contains no business logic of its own. This keeps the CLI from becoming the canonical contract and keeps LAT-19's skills-first direction coherent.
- **No orchestrator, no daemon, no queue, no UI** for the MVP. If a future capability needs shared state or cross-run coordination, that triggers a new ADR (per ADR-0008's "grow into a service later" clause and this ADR's revisit triggers).
- **Hybrid is allowed later, not now.** The skill contracts are the stable boundary; a future long-running mode wraps the same skills without changing their signatures.

### Package location in the monorepo

- **New package:** `packages/acl/` at the repo root. Sibling to a future `packages/*` for additional owned surfaces.
- **Internal layout (illustrative, not prescriptive):**
  - `packages/acl/src/skills/<skill-name>/{index.ts,schema.ts,skill.test.ts}` — each skill is a directory with a typed entrypoint, schemas, and colocated tests.
  - `packages/acl/src/adapters/<vendor>/` — Linear, GitHub, etc. Skills compose adapters.
  - `packages/acl/src/cli.ts` — thin CLI entrypoint.
  - `packages/acl/src/runtime/` — shared concerns (config loading, structured logging, run-artefact emission, error taxonomy).
- **Rationale for `packages/*`:** The repo is docs-only today (`docs/`). Introducing `packages/` rather than a bare `acl/` signals that more owned code (adapters, skills helpers, eventual service) belongs here, without pre-committing to any specific structure under `packages/`.
- **What does not move:** `docs/` stays as-is. Process docs and ADRs remain docs-first per ADR-0002 and ADR-0004. Whether skill *definitions* (the ADR-0004 adapter artefacts that agent harnesses load) live under `.claude/skills/` (as today), co-located with `packages/acl/`, or in a top-level `skills/`, is out of scope for this ADR and will be settled when the first skill definition that is also an ACL-backed capability ships. This ADR is about where the **executable skill code** lives; ADR-0004 governs the adapter-artefact layer above it.

## Implications

### Skills framework

- Each skill declares: input schema, output schema, side-effect category, cost-band, required config/secrets, and a `run` function. The runtime layer provides uniform invocation, structured error mapping, and run-artefact emission.
- Skills are importable as library functions (for agent harnesses and future internal callers) and as CLI subcommands (for humans and shell-shaped callers). The same schema validates both paths.
- The first skills to ship, in order (per ADR-0008): Linear relation read/write (`issueRelationCreate`, inline `issue.relations`, `issueRelationDelete`), next-dispatchable selection per ADR-0005, dispatch-decision record writer.

### Linear GraphQL integration

- Use `@linear/sdk` as the default path for the first adapter; fall back to raw GraphQL only for endpoints the SDK does not cover. This gives typed access to `issueRelationCreate`, `issue.relations`, `issueRelationDelete`, `IssueRelationType` (`blocks`, `related`, `duplicate`), issue status / parent / child / labels, and pagination — exactly the surface ADR-0008 named for the first capability.
- Authentication mode (personal API key vs OAuth app) and credential storage remain open (ADR-0008 Open Question 4); the implementation ticket picks the concrete approach. The stack choice here does not constrain that.

### Typed contracts end-to-end

- Linear responses are typed via `@linear/sdk`.
- Skill I/O is typed via a schema library that emits both runtime validators and static types from one source.
- Run-report artefacts match `docs/templates/agent-run-report.md` (and siblings). The template schema is the canonical source; the TS types derive from it, not vice versa. If the template changes, the derived types must change with it (CI check is a future improvement, not a day-one requirement).

### Local development

- `pnpm install && pnpm --filter acl build && pnpm --filter acl test` is the expected loop. During development, `pnpm --filter acl dev` runs via `tsx` without a build step.
- Secrets (Linear API token, later GitHub token) come from environment variables in a local `.env` that is git-ignored; the CLI reads them via a typed config module. No secret in the repo.
- Agents running the CLI in a sandbox must be able to set those env vars without network side effects at install time; this rules out postinstall scripts touching external services. `pnpm`'s `onlyBuiltDependencies` / ignoring install scripts by default is aligned with this.

### Testing

- **Unit tests** for skill logic, rule-matrix checks, and adapter request shaping — runnable without network.
- **Contract tests** for the Linear adapter against a recorded GraphQL response fixture set; a live-credential smoke test is opt-in via env and not required in CI.
- **Snapshot tests** for run-report artefacts so template drift surfaces immediately.
- Test runner choice (Vitest, Node's built-in, etc.) is left to the implementation ticket — not load-bearing for this decision. Whatever is chosen must support parallel execution and machine-readable output for agent-run consumption.

### CI / release

- CI uses `pnpm install --frozen-lockfile`, `tsc --noEmit`, `eslint`, and the chosen test runner, each with machine-readable output consumable by future agent-run reports.
- MVP "release" is just the `main` branch: humans and agents invoke the CLI directly from a checkout. When a released artefact is needed, the first plausible form is a container image built from the package; an `npm`-published library form is deferred until a second consumer exists.

### Deployment

- **MVP: none.** The CLI runs wherever a human or agent invokes it (local dev box, agent sandbox, later a CI job). No hosted surface, no always-on process.
- When a service mode is eventually required (revisit trigger (a)), the likely path is a container image built from the same package, orchestrated wherever the rest of the homelab/AWS surface lands. The skills module stays the same; a new entrypoint (HTTP, queue worker) wraps it. This ADR intentionally does not pick that platform.

### Future service migration

- The skills module is the stable migration boundary. A service mode wraps the same skill functions; no skill needs to be rewritten when we grow a queue/worker/HTTP surface.
- If the stateful-orchestrator case ever becomes real and Node's concurrency model becomes a bottleneck, a polyglot split (BEAM core invoking TS skills as subprocess workers, or a targeted rewrite of specific skills) is on the table under a new ADR. The revisit triggers name the conditions under which that conversation reopens.

### Future agent adapters

- The ACL will later host adapters for GitHub operations (beyond `gh` CLI conveniences), agent runners, and the telemetry substrate.
- Keeping the first package TypeScript aligns with the Linear SDK precedent and with most current agent runners' SDKs (including the Anthropic SDK). If a future adapter's best client is Python-only, we cross that bridge in a scoped ADR rather than pre-deciding polyglot today.

## Consequences

Good:

- Skills-first framing makes the ACL's primary architectural unit explicit and testable; the CLI is a thin adapter rather than the contract.
- Implementation can start immediately: language, runtime, package path, skill/CLI split, and typing strategy are all named.
- `@linear/sdk` gives the first adapter a typed, maintained client rather than hand-rolled GraphQL, directly shrinking the ADR-0008 "policy vs enforcement" gap.
- Typed contracts end-to-end (Linear SDK types, schema-library skill I/O, template-derived artefact types) make drift detectable in CI.
- Coding agents have the shortest path to making small, correct changes — important while the ACL is still proving its shape.
- No premature service, queue, or framework. The package is small enough to rewrite if the decision proves wrong.
- `packages/acl/` establishes a clean home for subsequent owned code without forcing a global monorepo build system in this ticket.

Bad / open:

- We give up Elixir/OTP's native fit for a future stateful orchestrator. If the ACL grows into a long-running, concurrency-heavy service faster than expected, a partial rewrite (or a polyglot split where the stateful core is BEAM and the skills stay TS) is on the table. The revisit triggers in the frontmatter cover this.
- We give up Go's single-binary deployment story. If the CLI distribution case ever becomes real (e.g. shipping to contributor machines without Node), repackaging a subset of skills as a Go binary behind the same contract is the escape hatch.
- Node cold-start is non-trivial (~100–300 ms). If a future workflow chains many skill calls per agent turn, that adds up; the mitigation is either in-process skill composition (preferred, natural in the skills-first design) or a long-running mode (covered by revisit trigger (d)).
- Introducing `pnpm` / Node tooling adds the first non-docs build surface to the repo. Agents must install Node + pnpm before touching ACL code; until the first ticket lands, this is only a documentation cost.
- TypeScript's runtime/ESM/CJS quirks will bite at least once during the first ticket. Mitigated by keeping the package small, picking one module system and sticking to it, and keeping the entrypoint shape boring.
- Choosing TS does not by itself resolve ADR-0008 Open Question 1 (where *skill definitions* — the ADR-0004 adapter artefacts — live in the repo). That question reopens when the first skill definition that is also an ACL-backed capability needs a home.

## Confirmation

Working if, by the time the first two ACL capabilities ship:

- A coding agent can clone the repo, read this ADR plus ADR-0008, and land a small ACL change without asking for language/runtime clarification.
- The skills module exists with at least two typed skills; both are invokable as library functions *and* as CLI subcommands with no duplicated validation logic.
- The Linear adapter uses `@linear/sdk` types end-to-end; dispatch logic references Linear fields via those types rather than stringly-typed GraphQL responses.
- Skill I/O and run-report artefacts are schema-validated at runtime and statically typed at compile time from a single source per contract.
- The CLI is invokable by both a human and by Perplexity/an agent runner, with a stable `--json` mode that downstream run reports consume.
- We have not needed to introduce a second language for any owned ACL code.
- No decision in a follow-up ticket has been blocked on "but which language?" or "is this a CLI or a skill?"

## Other rejected options

- **Bash + `gh` + `curl`.** Zero dependencies; unmaintainable past the first capability. No type safety, no structured testing, no sane path to run reports or cost-band logic. Rejected on sight.
- **Long-running service from day one (any language).** Rejected by ADR-0008's anti-astronautics guardrail. No pilot need justifies a queue, worker, or daemon yet; the skills-first design preserves the option without pre-paying for it.

## Open Questions

1. Exact Node LTS version to pin (resolved in the first implementation ticket; this ADR only requires "current LTS at time of first commit" and a pinned major).
2. Schema library for skill I/O (`zod` vs `valibot` vs `arktype`) — implementation detail; the requirement is "one source yields runtime validator + static type."
3. Test runner (Vitest vs Node built-in vs other) — implementation detail.
4. Whether run reports are written by the ACL skill runtime itself or by a thin wrapper invoked after it — ties into LAT-6 / the run-report template in `docs/templates/agent-run-report.md`; out of scope here but the skills-first framing makes "runtime writes the artefact" the default.
5. Credentials storage for the Linear token (ADR-0008 Open Question 4 — not reopened here, just not closed).
6. Whether `skills/` (as ADR-0004 adapter artefacts) becomes a sibling of `packages/` or lives inside `packages/acl/` — deferred until the first skill definition that is also an ACL-backed capability needs a home.
7. Whether a later CI check enforces that types derived from `docs/templates/*` stay in sync with the templates — nice-to-have, not day-one.

## Links

- Linear: `LAT-20` (this ADR). Related in-flight: `LAT-6`, `LAT-11`, `LAT-19` (skills framework prioritisation). Related context: `LAT-5`, `LAT-10`, `LAT-14`, `LAT-16`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0003-linear-persistence-boundary.md`, `0004-process-docs-vs-agent-skills.md`, `0005-linear-dependency-and-sequencing-model.md`, `0008-agent-control-layer-and-perplexity-boundary.md`.
- Process: `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/operating-model.md`.
