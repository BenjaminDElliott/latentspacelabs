# Documentation

This directory is the durable source of truth for process, decisions, and templates supporting the **Agentic Development Flywheel MVP** (Linear team `LAT`).

## Layout

- `process/` — How we work: operating model, intake/triage posture, approval gates.
- `decisions/` — Architecture Decision Records (ADRs). File naming: `NNNN-title-with-dashes.md`.
- `templates/` — Reusable document templates (PRDs, agent-ready tickets, ADRs, agent run reports).

## Canonical sources

| Purpose | Canonical location |
|---|---|
| Process docs and ADRs | This repo (`docs/`) |
| Work graph: projects, issues, status, comments | Linear (team `LAT`) |
| Code, PRs, CI | This repo |
| Drafts, raw reasoning, intake triage | Perplexity threads / workspace scratch files |

Perplexity threads and workspace Markdown files are **working drafts, not sources of truth**. Content promoted to this repo is durable; content left in Perplexity should be assumed ephemeral.

## Conventions

- Every durable doc should link back to the Linear issue(s) that motivated it.
- Linear issues should link forward to the canonical doc URL in this repo.
- Prefer small, frequent edits over large rewrites. Supersede ADRs rather than mutate accepted ones.

## Related Linear issues

- `LAT-10` — Operating model / Perplexity-first intake scaffolding.
- `LAT-12` — Persistence boundaries across Perplexity, Linear, and Git.
- `LAT-13` — Architecture decision process and ADR structure.
