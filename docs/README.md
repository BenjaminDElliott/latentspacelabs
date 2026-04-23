# Documentation

This directory is the durable source of truth for process, decisions, and templates supporting the **Agentic Development Flywheel MVP** (Linear team `LAT`).

## Layout

- `process/` — How we work: operating model, intake/triage posture, approval gates. Human-readable policy.
- `decisions/` — Architecture Decision Records (ADRs). File naming: `NNNN-title-with-dashes.md`.
- `prds/` — Product Requirements Documents (PRDs). Root PRD: [`prds/root-agentic-development-flywheel.md`](prds/root-agentic-development-flywheel.md). Feature PRDs are keyed by Linear issue: `LAT-NN-<slug>.md`. See [`prds/README.md`](prds/README.md) for the full naming and frontmatter policy.
- `templates/` — Artifact schemas (PRDs, agent-ready tickets, ADRs, agent run reports) consumed by humans and agents alike.

## Docs vs agent skills and commands

Process docs here are the canonical, human-readable source of truth. Agent-executable procedures (skill files, slash commands under a future `.claude/skills/` and `.claude/commands/`) are treated as operational adapters downstream of these docs. See [ADR-0004](decisions/0004-process-docs-vs-agent-skills.md) for the open decision on whether this split is the right one; until that ADR is accepted or superseded, docs win when they disagree with a skill.

## Canonical sources

| Purpose | Canonical location |
|---|---|
| Process docs and ADRs | This repo (`docs/`) |
| Work graph: projects, issues, status, comments | Linear (team `LAT`) |
| Code, PRs, CI | This repo |
| Drafts, raw reasoning, intake triage | Perplexity threads / workspace scratch files |

Perplexity threads and workspace Markdown files are **working drafts, not sources of truth**. Content promoted to this repo is durable; content left in Perplexity should be assumed ephemeral.

## Conventions

- Every durable doc should link back to the Linear issue(s) that motivated it via its own frontmatter or body — not via a hand-maintained list in this README.
- Linear issues should link forward to the canonical doc URL in this repo.
- Prefer small, frequent edits over large rewrites. Supersede ADRs rather than mutate accepted ones.

## Index policy

This README intentionally does **not** maintain a hand-edited list of sibling docs, PRDs, ADRs, or the Linear issues that motivated them. Prior versions kept such lists and they drifted under parallel PRs — every new doc became a merge conflict on the index. The authoritative metadata for any doc lives in that doc's frontmatter or body.

To discover what exists: `ls docs/prds/`, `ls docs/decisions/`, `ls docs/process/`, and read the frontmatter. To check motivation or status: read the file, not a sibling index.

New PRD, ADR, or process-doc PRs should **not** need to touch `docs/README.md` (or any other shared index/list/table file) unless the ticket explicitly owns that hub. If you find yourself editing a shared index to land an unrelated doc, that is the conflict surface this policy exists to prevent — stop and leave the index alone.
