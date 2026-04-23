---
id: ADR-0016
title: ICP skill directory and adapter layering
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-39
  - LAT-52
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) a skill needs to live outside `packages/icp/src/skills/` (e.g. a harness-specific skill loaded from `.claude/skills/` at runtime, or a skill shipped from a second package); (b) a non-TypeScript caller needs to register a skill and the TS-first representation becomes load-bearing friction; (c) the three adapter senses named here are no longer sufficient to describe a new boundary (e.g. a "policy adapter" or "persistence adapter" appears); (d) skill versioning grows beyond a single live `name@version` per registry (deferred by ADR-0012); or (e) the provenance binding here conflicts with a future CI drift-check against canonical docs.
---

# ADR-0016: ICP skill directory and adapter layering

## Context

ADR-0011 picked TypeScript on Node.js and named `packages/icp/` as the package location. ADR-0012 picked a skill-framework-first architecture with nine named components and a first vertical slice built around `dispatch-ticket`. LAT-52 landed that first slice: the skill contract, registry with load-time provenance enforcement, runner with structural approval-gate, five shared adapters as stubs, and the `dispatch-ticket@0.1.0` skill file in `packages/icp/src/skills/dispatch-ticket.ts`.

LAT-39 was opened earlier as a scoping ticket to *decide* where ICP skills live, how skill definitions relate to canonical docs and ADRs, whether the representation should be TypeScript-first or a separate `SKILL.md` / JSON-schema format, how provenance binds a skill file to the ADRs / PRDs / process docs it adapts, the naming and versioning convention for skills, and — orthogonally — to clarify the word "adapter", which has been used with at least three different meanings in ADR-0004 / ADR-0011 / ADR-0012.

LAT-52 answered most of these questions *implicitly in code* without a decision record to point back to. That is reviewable today, but it means future contributors and future agents will re-derive the answers (or, worse, drift away from them). This ADR does not rewrite the framework. It codifies the LAT-52 choices as a reviewable decision, narrowly corrects the terminology collision around "adapter", and names the one binding rule that is not yet structural (the naming/versioning convention).

Context already decided elsewhere:

- **ADR-0004** — `docs/` is canonical; skills are operational adapters downstream of the docs; `derived_from:` / `derived_at:` frontmatter is mandatory; a skill that disagrees with its source doc is a bug in the skill. ADR-0004 located the original adapter class under `.claude/skills/` because no owned runtime existed yet.
- **ADR-0011** — TypeScript on Node.js for the ICP; `packages/icp/` as the package location; `pnpm` / `npm` workspaces; skills framework ahead of CLI surface.
- **ADR-0012** — nine components; skill contract, registry, runner as the skill framework; Linear adapter, policy evaluator, run recorder, agent invocation adapter, write-back formatter as shared components; thin CLI harness as the first operator surface; `dispatch-ticket@0.1.0` as the first skill; `derived_from:` / `derived_at:` enforced structurally at registry load.
- **LAT-25** — monorepo switched from `pnpm` to `npm` workspaces. Current state: `npm install` at repo root, `npm run check` runs typecheck + build + ADR/PRD validation + policy scan + tests.
- **LAT-52** — landed `packages/icp/src/skills/dispatch-ticket.ts`, `packages/icp/src/runtime/{contract,registry,runner}.ts`, `packages/icp/src/adapters/{linear,policy-evaluator,run-recorder,agent-invocation,write-back-formatter}.ts`, registry provenance enforcement, and the runner approval-gate.

### What LAT-39 must actually decide

Reading the ticket against the code LAT-52 already shipped, five questions are open:

1. **Skill directory.** Where do ICP skills live? LAT-52 put them in `packages/icp/src/skills/`. ADR-0004 suggested `.claude/skills/` at a time when the ICP package did not exist. Both paths have callers.
2. **Representation.** Is a skill a TypeScript module (one file per skill, `SkillDefinition<Inputs, Outputs>` object exported), or a separate `SKILL.md` / JSON schema file plus a TypeScript adapter that loads it?
3. **Provenance binding.** How does a skill's `derived_from:` list relate to the canonical doc? Is repo-relative path enough? Must the doc be an ADR, a PRD, a process doc — or any of those?
4. **Naming and versioning.** What convention does a skill's `name` / `version` follow, and what is the rule when a skill needs a breaking change?
5. **Terminology: "adapter".** Three different things are currently called an adapter:
   - the ADR-0004 sense (a *skill* is an adapter of a canonical doc — "operational adapter");
   - the ADR-0012 sense (a *shared component* like the Linear adapter is a tool adapter — "vendor / tool adapter");
   - an implicit future sense (the mechanism that invokes a skill inside a given execution environment — "execution adapter / harness").

Without a terminology rule, review discussions and later tickets collide on the word.

## Decision Drivers

- **Codify what LAT-52 already built; do not rewrite it.** The first slice is landed and running. LAT-39's job is to make the chosen shape auditable as a decision, not to reopen architecture.
- **Runtime-enforceable before convention.** Anything that can be a load-time check in the registry is worth more than a style rule. ADR-0004's `derived_from:` enforcement is the model.
- **One canonical home per concern.** Skills live in one directory. Shared adapters live in one directory. Contract, registry, and runner live in one directory. Mixing them is a review-time distraction.
- **TypeScript-first matches ADR-0011.** The runtime is TypeScript; `SkillDefinition` already expresses every field the ADR-0012 skill contract requires. Introducing a separate file format adds a parser and a second source of truth without unblocking anything the pilot needs.
- **Provenance must point at canonical docs, not at itself.** `derived_from:` pointing at another skill file would be a loop. Canonical docs are `docs/decisions/` (ADRs), `docs/prds/` (PRDs), and `docs/process/` (process docs). `docs/templates/` is an artefact schema and is a legitimate target too (a skill that produces a template-shaped artefact *is* adapting the template).
- **Naming signals adapter, not verb.** A skill name should read as "what the adapter is", not "what the operator wants to do on the command line". `dispatch-ticket` is already right.
- **Semver, narrowly scoped.** ADR-0012 deferred multi-version coexistence. Until that ADR lands, one live `name@version` per registry is fine; the rule is about when a bump is required.
- **Anti-astronautics (ADR-0008, ADR-0012).** If a proposed rule does not unblock the next slice, prevent a known risk, or codify a decision already relied on, it does not belong in this ADR.

## Considered Options

### (Q1) Skill directory

1. **`packages/icp/src/skills/` (accepted).** One TypeScript module per skill, colocated tests, exported from the package entry point.
2. **`.claude/skills/<name>/SKILL.md` + runtime loader.** Keep ADR-0004's original location; the ICP would discover skills by walking `.claude/skills/`.
3. **`packages/icp/src/skills/` for ICP skills, `.claude/skills/` for harness-local skills**, with a clear rule about which lives where.

### (Q2) Representation

1. **TypeScript-first (accepted).** Each skill is a TypeScript module that exports a `SkillDefinition` object. Frontmatter fields (`derived_from`, `derived_at`, `autonomy_level`, `version`) are plain fields on the definition. The registry introspects the object; no YAML/JSON parser is required.
2. **`SKILL.md` with YAML frontmatter + separate TS procedure file.** Mirrors ADR-0004's `.claude/skills/<name>/SKILL.md` shape; the ICP would load the frontmatter and bind it to a procedure function in a sibling `.ts`.
3. **JSON Schema file (`skill.schema.json`) + TS implementation.** Machine-readable metadata, TS runtime. More ceremony than option 1 without a concrete consumer.

### (Q3) Provenance binding

1. **`derived_from:` is a list of repo-relative paths to canonical docs; registry fails load if any path does not resolve (accepted — already enforced by LAT-52).** Canonical docs are `docs/decisions/`, `docs/prds/`, `docs/process/`, `docs/templates/`. Pointing at another skill, an external URL, or a code file is rejected.
2. **`derived_from:` + semantic-fidelity CI check.** Adds a drift check that diffs the skill against the cited doc. ADR-0004 anticipates this; ADR-0012 explicitly defers it.
3. **Commit-SHA-pinned provenance.** `derived_from:` carries a SHA of the cited doc at the time of last sync. Adds proof of freshness at the cost of churn on every doc edit.

### (Q4) Naming and versioning

1. **Kebab-case `noun-verb` or `verb-noun` describing the adapter's surface; semver `MAJOR.MINOR.PATCH` in the `version` field (accepted).** Examples: `dispatch-ticket`, `post-write-back`, `intake-triage`, `adr-new`. Breaking input/output/policy change → MAJOR. Non-breaking addition → MINOR. Internal fix → PATCH.
2. **Verb-first imperative matching ADR-0004's near-term adapter list names.** Less flexible when the noun is the defining part (`dispatch-ticket` reads more naturally than `ticket-dispatch`).
3. **Free-form name.** Rejected — the registry already enforces `^\d+\.\d+\.\d+$` on version and will reject duplicates, but no convention on name means reviewers spend time bikeshedding per skill.

### (Q5) Terminology (three senses of "adapter")

1. **Use three distinct terms (accepted):**
   - **Skill** (ADR-0004 sense) — a named, versioned, provenance-anchored runtime unit that adapts a canonical doc into an executable procedure. The word "adapter" is *not* used for this role; "skill" is.
   - **Tool adapter** (ADR-0012 sense) — a shared component that is the only path in or out of a specific external system (Linear, GitHub, an agent runner). Synonym: "vendor adapter". Lives in `packages/icp/src/adapters/`.
   - **Harness** (execution sense) — the caller that turns a user/schedule/webhook/MCP-callback trigger into a `SkillRunner.run(...)` invocation. A CLI is one harness; a future Perplexity shell-call wrapper is another. The word "adapter" is *not* used for this role; "harness" is (matching ADR-0012's "CLI as thin harness" framing).
2. **Keep "adapter" as a shared word, disambiguated by prefix** (`skill-adapter`, `tool-adapter`, `execution-adapter`). Rejected: three compound words where three single words already exist and already match the ADRs that introduced them.

## Decision

**Accepted:**

- **Q1 — Skill directory: `packages/icp/src/skills/`.** One file per skill. Colocated `.test.ts` file. Exported from `packages/icp/src/index.ts` so a caller importing `@latentspacelabs/icp` sees it on the package surface. Matches LAT-52.
- **Q2 — Representation: TypeScript-first.** Each skill exports a `SkillDefinition<Inputs, Outputs>` object. `derived_from` / `derived_at` / `autonomy_level` / `version` / `required_tools` / `evidence` are fields on the object; the registry validates by introspection. No `SKILL.md` or JSON schema is introduced.
- **Q3 — Provenance binding: repo-relative paths to canonical docs, enforced at registry load.** Canonical docs are `docs/decisions/`, `docs/prds/`, `docs/process/`, `docs/templates/`. At least one entry is required; empty lists fail load (already enforced by `SkillRegistry.validateProvenance`). Pointing at another skill file, a code file, or an external URL is rejected. Semantic-fidelity drift checking is deferred to a future ADR, as ADR-0012 already notes.
- **Q4 — Naming and versioning:**
  - Skill name is kebab-case, describes the adapter (`dispatch-ticket`, `post-write-back`, `intake-triage`, `adr-new`), not the operator's verb phrase.
  - Skill `version` is semver `MAJOR.MINOR.PATCH`, already regex-validated by the registry.
  - Bump rules: MAJOR on any change that breaks inputs, outputs, required tools, evidence contract, or autonomy/approval semantics; MINOR on additive non-breaking changes (new optional input, new output field, new reason category); PATCH on internal-only fixes (bugfix, reason text, log wording).
  - One live `name@version` per registry; multi-version coexistence is out of scope (ADR-0012 defers).
- **Q5 — Terminology:**
  - **Skill.** The ADR-0004 "operational adapter of a canonical doc." Not to be called "adapter" in prose or in code identifiers; `skill` is the word.
  - **Tool adapter.** The ADR-0012 shared-component class that is the only path to a specific external system. Canonical examples: `linear-adapter`, `agent-invocation-adapter`. Lives in `packages/icp/src/adapters/`. Synonym (when being explicit about which sense is meant): "vendor adapter." The `required_tools` field on a skill names tool adapters.
  - **Harness.** The execution surface that collects caller input and invokes the skill runner. Canonical examples: CLI harness, a future Perplexity shell-call harness, a future service surface, a future scheduler harness. Never called "adapter."

The three senses are orthogonal: a harness invokes the runner, the runner loads a skill from the registry, the skill declares the tool adapters it needs, the runner resolves those adapters and runs the skill's procedure. Each boundary has exactly one word.

## What this ADR does not change

- The nine ADR-0012 components. Still nine, still the same responsibilities, still the same dependency direction.
- The first vertical slice. `dispatch-ticket@0.1.0` is still the first skill; the stubbed Linear and agent adapters are still stubs, swapped out in their own tickets.
- ADR-0004's rule that a skill without `derived_from:` is a bug. That rule is already structurally enforced in the registry.
- The directory shape ADR-0012 already named: `packages/icp/src/skills/`, `packages/icp/src/adapters/`, `packages/icp/src/runtime/`. LAT-39 codifies it; it does not move anything.
- The CLI harness binary name, which ADR-0012 kept illustrative and which a later ticket will settle.

## What this ADR corrects narrowly

- **Terminology.** "Skill adapter" (as a phrase for a runtime unit) is retired in favour of "skill." "Adapter" on its own, without a qualifier, is ambiguous; in code review and in future ADRs, use "tool adapter" (vendor) or "harness" (execution) when the sense is not obvious from immediate context.
- **Provenance scope.** `derived_from:` must point into `docs/decisions/`, `docs/prds/`, `docs/process/`, or `docs/templates/`. Pointing at `.claude/` files, code files, or external URLs is out of scope; if a skill adapts something that does not have a canonical doc, the doc is written first (ADR-0004 rule).
- **Version-bump discipline.** MAJOR/MINOR/PATCH rules are now explicit. The registry enforces the regex; review enforces the semantic categorisation.

## Consequences

Good:

- LAT-52's directory and representation choices are now citable as a decision, not just as "what the first PR happened to do."
- New skills land by (a) adding one TypeScript file under `packages/icp/src/skills/`, (b) naming at least one repo-path in `derived_from:`, (c) picking a semver `version`, (d) declaring `required_tools` against the enum the runtime provides. No scaffolding, no schema file, no generator.
- The three-word terminology rule removes the biggest review-time collision the ICP has had so far: "adapter" meaning three different things in three adjacent ADRs.
- Provenance stays structural (registry load-time), which is the form the ADR-0004 contract asks for.
- Future ADRs can discuss multi-version coexistence, drift-checking, or cross-package skill discovery without re-opening this directory / representation question.

Bad / open:

- `.claude/skills/` (per ADR-0004) and `packages/icp/src/skills/` (per this ADR) now each name a "skills directory". The ICP only loads from the latter. A harness-local skill that belongs to Claude Code and not to the ICP is still a legitimate resident of `.claude/skills/`; the distinction is `.claude/skills/` = harness skills outside the ICP substrate, `packages/icp/src/skills/` = ICP skills loaded by the skill runner. A future ticket may formalise the rule further if a skill needs to live in both places.
- TypeScript-first means a skill cannot be authored by a non-TypeScript tool today. This is acceptable for the pilot — every current and planned caller is TypeScript — and a later ADR can reopen the question if a non-TS author needs to contribute a skill.
- The MAJOR/MINOR/PATCH rules rely on reviewer judgement for the "is this breaking?" call. The registry cannot detect this automatically. Until multi-version coexistence lands, a bad call causes a single sharp break rather than silent drift, which is acceptable.
- Retiring "skill adapter" as a phrase means existing prose that uses it (including inline comments in `packages/icp/src/skills/dispatch-ticket.ts`) will drift from the terminology rule until an editorial pass lands. The drift is cosmetic, not structural.
- `derived_from:` scoped to `docs/` means a skill cannot cite an external standard (e.g. a specification URL) as its source. In practice the pattern is: write the process doc that adapts the external standard, then point the skill at the process doc. This is ADR-0004's intended flow.

## Confirmation

This decision is working if:

- New skills land with a one-file patch under `packages/icp/src/skills/` plus a colocated test, and the PR review does not spend time on "where does this go" or "what format is this file."
- `npm run check` fails load on any skill added without `derived_from:`, with a `derived_from:` path that does not resolve, or with a version that is not semver. This is already true as of LAT-52.
- Tickets and PR reviews use "skill", "tool adapter" (or "vendor adapter"), and "harness" consistently and stop needing to disambiguate "adapter" in-thread.
- When a follow-up ADR picks up multi-version coexistence or drift-checking, it cites this ADR as the point where the directory, representation, and naming stabilised.

Signals to revisit (see `revisit_trigger` in the frontmatter):

- A skill needs to load from outside `packages/icp/src/skills/` (e.g. Claude Code hook skill that must live in `.claude/skills/` but is invoked via the ICP runner).
- A non-TypeScript author or harness needs to register a skill.
- The three terms in Q5 are no longer sufficient to describe a new boundary (e.g. "persistence adapter", "policy adapter").
- The single-live-version rule starts to bite (two skills with the same name and different versions both need to be dispatchable in the same registry).

## Links

- Related Linear issue(s): LAT-39, LAT-52, LAT-25
- Related ADRs: ADR-0004 (docs canonical, skills as adapters), ADR-0006 (run report envelope), ADR-0008 (autonomy levels, four-category placement), ADR-0011 (TypeScript / Node / `packages/icp/`), ADR-0012 (nine components and first slice), ADR-0013 (agent invocation and integration boundaries).
- Related code: `packages/icp/src/skills/dispatch-ticket.ts`, `packages/icp/src/runtime/contract.ts`, `packages/icp/src/runtime/registry.ts`, `packages/icp/src/runtime/runner.ts`, `packages/icp/src/adapters/`.
