---
id: ADR-0002
title: Store process docs and ADRs in the monorepo
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-13
supersedes:
superseded_by:
revisit_trigger: Revisit if the monorepo is split or if a dedicated docs platform (e.g., a knowledge store) is adopted.
---

# ADR-0002: Store process docs and ADRs in the monorepo

## Context

Process docs and architectural decisions have been accumulating as Perplexity threads and loose workspace Markdown. Without a canonical home, it is impossible to know which version is authoritative, to review changes through PRs, or to supersede old decisions cleanly. The `latentspacelabs` repo already exists and is intended as the durable control plane for code, docs, and ADRs.

## Decision Drivers

- Need a single source of truth that survives Perplexity sessions.
- Need PR-based review for changes to process and decisions.
- Need a naming convention that supports a growing decision log.
- Avoid introducing a new tool (Notion, dedicated wiki) before the workflow is validated.
- Keep docs close to the code that implements them.

## Considered Options

1. Keep docs in Perplexity threads and shared workspace Markdown.
2. Store docs and ADRs in this monorepo under `docs/`.
3. Use Linear project content and documents.
4. Use an external docs platform (Notion, Confluence, dedicated knowledge store).

## Decision

**Chosen: Option 2.** Process docs live under `docs/process/`. ADRs live under `docs/decisions/` with MADR-style naming: `NNNN-title-with-dashes.md`. Linear references the repo URL for each canonical doc; Perplexity threads are working drafts that get promoted via PR.

## Consequences

Good:

- Single canonical home for process and decisions.
- Changes flow through PR review, with diffs and history.
- Supersede-don't-mutate lifecycle for accepted ADRs is natural in Git.
- No new tool to adopt.

Bad / open:

- Discoverability depends on Linear/Perplexity linking back to repo URLs consistently.
- Non-technical collaborators must work through PRs for durable changes (acceptable given current team size of one).

## Confirmation

Working if every accepted ADR and active process doc can be found in this repo, every Linear issue that references a doc uses the repo URL, and no durable policy is being decided inside a Perplexity thread without a corresponding merged file here.

## Links

- `docs/README.md`, `docs/process/README.md`, `docs/decisions/README.md`.
- Linear: `LAT-13`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`.
