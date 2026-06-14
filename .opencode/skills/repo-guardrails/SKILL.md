---
name: repo-guardrails
description: The hard rules every opencode run in this repo must respect. Load before any tool call that could write to disk, run a command, or open a PR.
---

# repo-guardrails

These rules are non-negotiable for every run. They derive from ADR-0017 (secrets), ADR-0014 (telemetry), ADR-0019 (runtime), and the operating model docs.

## Language and tooling

- **TypeScript / Node only** for new packages. No Python, no Go, no Rust.
- **npm only.** Do not invoke `pnpm`, `yarn`, `bun`, or `corepack`. Lockfile is `package-lock.json`.
- Node version is governed by `.nvmrc`; do not change it.
- The repo gate is `npm run check`. A run is not done until it passes.

## Files and paths

- Honour `Constraints → Files in scope` from the ticket pack as an exclusive allowlist.
- Never edit, even if "obviously needed":
  - `.github/workflows/**`
  - `docs/decisions/**` (ADRs)
  - `docs/prds/**` (PRDs)
  - `docs/README.md` and other shared Markdown hubs / indexes — unless the ticket pack explicitly names one in the allowlist *and* the planner notes ownership.
  - `package-lock.json` unless `Dependency policy` allows new deps.
- Do not create new top-level directories without the pack listing them.

### Shared README hubs

The following are **shared hubs**. A ticket edits them only if it *explicitly owns that hub*:

- `docs/README.md` (top-level docs index)
- `docs/process/README.md` (process directory index)
- `docs/decisions/README.md` (ADR index — table removed, do not re-add)
- `docs/prds/README.md` (PRD index — table removed, do not re-add)
- `README.md` at any directory root not owned by the ticket

Rule of thumb: **if the change is "add one more bullet to a list I did not write," stop.** Note it as a "follow-up for hub owner" in the PR body.

**Exception:** If the ticket specifically asks for README-only work (e.g., "add the new package to the docs index"), this rule does not apply — make the minimal change.

## Secrets and endpoints

- Never embed, log, or commit the Qwen endpoint URL, any auth token, an MCP `Authorization` header, or any internal hostname. This includes PR bodies, commit messages, transcripts, and code comments (ADR-0014, ADR-0017).
- Never echo `.env*` contents to a tool that persists output.
- If a secret-shaped value appears in your context, redact it before any write.
- Prefer `process.env.FOO` or config objects over inline strings for environment-specific values.

## Git and PRs

- One branch per ticket: `lat-<NN>-<slug>` from the pack.
- One PR per ticket. PR title prefix `LAT-NN:`. PR base `main`.
- Never `--force-push` to shared branches. Force-push to your own ticket branch is only allowed before review.
- **No auto-merge.** Do not enable, request, or simulate merge from inside the run.
- Do not write back to Linear from inside the run; the planner / review path owns Linear writes (ADR-0013).

## Scope discipline

- No drive-by refactors. No "while I'm here" cleanups. No fixing unrelated lint.
- No new dependencies unless `Constraints → Dependency policy` says yes and names them.
- No architecture decisions. If the pack underspecifies, return `needs_clarification`.
- No broad MCP usage. Linear/GitHub MCP scope is whatever the ticket pack authorises and no more.

## Implementation conventions

### TypeScript naming

- Files: kebab-case (`my-handler.ts`)
- Functions: camelCase (`createUser`)
- Types/Interfaces: PascalCase (`UserConfig`)
- Tests: same name as source + `.test.ts` suffix

### Import style

- Prefer named exports over default exports.
- Use workspace aliases for package imports (`@latentspacelabs/<package>`).
- Avoid wildcard imports (`import * as`); prefer explicit named imports.

### Error handling

- Use typed errors with descriptive messages.
- Define custom error classes for domain-specific errors.

## When unsure, **stop** and report `blocked` rather than widening scope.
