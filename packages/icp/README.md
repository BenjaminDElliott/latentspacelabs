# @latentspacelabs/icp

Integration Control Plane (ICP) — skills framework plus a thin CLI harness.

Current state (LAT-52): skill contract, registry, runner, and the
`dispatch-ticket@0.1.0` skill are in place. Linear and coding-agent adapters
ship as stubs — production Linear GraphQL and real agent-runner invocation
land in their own tickets (see ADR-0008 open question 4 and ADR-0013). The
CLI harness is also deferred; for now the skill runner is invoked directly
(see `src/skills/dispatch-ticket.test.ts` for the end-to-end shape).

## Design references

- [ADR-0004](../../docs/decisions/0004-process-docs-vs-agent-skills.md) — `docs/` is canonical; skills are operational adapters downstream of the docs; `derived_from:` provenance header is mandatory.
- [ADR-0011](../../docs/decisions/0011-integration-control-plane-language-and-runtime.md) — TypeScript on Node.js, this package location, skills-first runtime shape.
- [ADR-0012](../../docs/decisions/0012-integration-control-plane-software-architecture.md) — skill contract, skill registry, skill runner, plus shared components (Linear adapter, policy evaluator, run recorder, agent invocation adapter, write-back formatter) and the thin CLI harness.
- [ADR-0016](../../docs/decisions/0016-icp-skill-directory-and-adapter-layering.md) — skill directory, TypeScript-first representation, provenance binding, naming/versioning, and the three senses of "adapter" (skill vs tool adapter vs harness).

## Layout

The directory shape is fixed by ADR-0016. Each slot has a single responsibility.

```
src/
  skills/      # one TypeScript module per skill (ADR-0016 §Q1, §Q2)
  adapters/    # tool adapters: one external-system boundary each (ADR-0012)
  runtime/     # skill contract, registry, runner (ADR-0012)
  index.ts     # public package surface
```

- **`src/skills/`** — ICP skills loaded by the skill registry. One file per skill, colocated `.test.ts`. Every skill file exports a `SkillDefinition` and must declare `derived_from:` paths into `docs/decisions/`, `docs/prds/`, `docs/process/`, or `docs/templates/`. Paths are validated at registry load (`SkillRegistry.validateProvenance`).
- **`src/adapters/`** — Tool adapters (ADR-0012 shared components). Each adapter is the only path in/out of a specific external system (Linear, agent runner, run-report filesystem, Linear comment formatter, policy rules). A skill declares the tool adapters it needs via `required_tools`; the runner resolves them. Tool adapter is sometimes called "vendor adapter" when contrasting with the skill sense of "adapter."
- **`src/runtime/`** — Skill contract (types only, no I/O), registry (load-time validation), runner (approval gate, tool resolution, evidence enforcement).

## Terminology (from ADR-0016)

- **Skill** — a named, versioned, provenance-anchored runtime unit that adapts a canonical doc into an executable procedure (ADR-0004 sense). Lives in `src/skills/`. Do not call a skill an "adapter" in prose — the word is reserved for tool adapters below.
- **Tool adapter** — a shared component that is the only path to a specific external system. Lives in `src/adapters/`. Named in `required_tools`. Synonym: "vendor adapter."
- **Harness** — the execution surface that invokes `SkillRunner.run(...)` (CLI today; Perplexity shell-call wrapper, service surface, scheduler, webhook receiver later). Never called an adapter.

Example invocation path: a *harness* collects arguments and calls the runner, the runner loads a *skill* from the registry, the skill declares the *tool adapters* it needs, the runner resolves those adapters and executes the skill.

## Adding a skill

1. Add `src/skills/<name>.ts` exporting a `SkillDefinition<Inputs, Outputs>`.
2. Pick a kebab-case `name` that describes the adapter's surface (e.g. `dispatch-ticket`, `post-write-back`, `adr-new`).
3. Pick a semver `version`. Bump MAJOR on breaking input/output/policy changes, MINOR on additive non-breaking changes, PATCH on internal-only fixes (ADR-0016 §Q4).
4. Set `derived_from:` to at least one repo-relative path into `docs/{decisions,prds,process,templates}/`. Set `derived_at:` to the ISO date of the last sync.
5. Declare `required_tools` from the `ToolName` enum in `runtime/contract.ts`.
6. Export the skill from `src/index.ts`.
7. Write a colocated `<name>.test.ts` that exercises the skill end-to-end via the runner.

The registry will refuse to load a skill whose `derived_from:` is empty, whose referenced paths do not resolve, whose version is not semver, or whose `required_tools` names a tool the runtime does not provide.

## Local commands

From the repo root:

```sh
npm install
npm run build --workspace @latentspacelabs/icp
npm run typecheck --workspace @latentspacelabs/icp
npm run test --workspace @latentspacelabs/icp
```

`npm run check` at the repo root runs typecheck, build, ADR validation, PRD validation, the policy scanner, and all workspace tests.

## LAT-129 polling dispatcher (MVP)

`icp-dispatch-next` (also wired as `npm run dispatch:next` from the repo root) is the first ICP-owned harness that closes the loop from "agent-ready Linear ticket" to "control-loop run with sanitised evidence back on the Linear issue."

Per invocation it does exactly one thing:

1. Reads `LINEAR_API_KEY` from env (never logged).
2. Selects one issue identified by `LAT_DISPATCH_ISSUE=LAT-NN`. (Label-driven polling is a documented follow-up; the explicit override is the only safe way to opt in for now.)
3. Refuses if the issue is risky (deploy / merge / secret-rotation keywords, vague "investigate" titles, missing Acceptance Criteria, too-short body).
4. Generates a bounded ticket pack into a temp directory (never the repo tree).
5. Invokes the existing control-loop CLI once with `--mode <mock|plan|live>` and `--format json`.
6. Captures stdout/stderr, scrubs token-shaped values + non-Linear URLs + RunPod pod ids + literal env-supplied secret values, and posts the result as a Linear comment.
7. Promotes the issue to `In Review` only when the control-loop JSON summary reports `state: "ready_for_review"`. Refused or failed runs leave the issue unpromoted, with the reason in the comment.

### Required env

| Variable | Purpose |
| --- | --- |
| `LINEAR_API_KEY` | Personal API key (`lin_api_*`). Never logged or forwarded to child processes. |
| `LAT_DISPATCH_ISSUE` | Explicit `LAT-NN` to dispatch. Without it the dispatcher exits cleanly with `no_eligible_issue`. |

### Optional env

| Variable | Default | Purpose |
| --- | --- | --- |
| `LAT_DISPATCH_MODE` | `mock` | `mock` / `plan` / `live`. Forwarded to the control-loop CLI. |
| `LAT_LINEAR_IN_REVIEW_STATE_ID` | LAT team In Review UUID (current value) | Override when targeting a different workspace/team. |

`live` mode also requires the env the control loop itself documents (`CONTROL_LOOP_LIVE_ENABLED`, `CONTROL_LOOP_PROVIDER`, `CONTROL_LOOP_WORKDIR`, `RUNPOD_API_KEY`, `RUNPOD_POD_ID`, optionally `RUNPOD_VLLM_API_KEY`). The dispatcher forwards those into the child, but never `LINEAR_API_KEY`.

### Local usage

```sh
# 1. Build everything (the dispatcher refuses if the control-loop dist is missing).
npm run build

# 2. Resolve config without making any network calls.
LINEAR_API_KEY=lin_api_... LAT_DISPATCH_ISSUE=LAT-126 \
  npm run dispatch:next -- --dry-run

# 3. One-shot mock dispatch (no real provider, no cost).
LINEAR_API_KEY=lin_api_... LAT_DISPATCH_ISSUE=LAT-126 \
  npm run dispatch:next -- --mode mock
```

### Guardrails

- No auto-merge, no deploy, no daemon, no concurrency. One invocation = one ticket = one run.
- Linear API key is never forwarded to the child process or echoed in any output.
- All captured subprocess output passes through `redactOutput` before being written back to Linear.
- The dispatcher never modifies the repo tree; the generated pack lives in a `tmpdir()` directory.
- If config is missing, the dispatcher reports `config_error` and exits 2; it never silently falls back to a different cost class or provider.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | `ready_for_review` — Linear comment posted and issue promoted. |
| 2 | `no_eligible_issue` / `refused` / `planned` / `config_error` (recoverable). |
| 3 | `failed` / `checks_failed`. |
| 64 | Bad CLI arguments. |
