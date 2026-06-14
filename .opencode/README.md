---
name: opencode project-local assets
purpose: Project-local opencode configuration for bounded ticket implementation per ADR-0019.
---

# `.opencode/` — project-local assets

These assets configure the opencode + local-Qwen implementation runtime for this repo, per ADR-0019. They are project-local: opencode discovers them when run from the repo root.

**Orientation entry point:** Open [`../README.md`](../README.md) first — it links to every canonical doc (root PRD, ADR policy, PRD governance, approval gates, cost controls, preflight rules, secret guardrails).

## Layout

- `skills/` — reusable instruction modules the agents load. One directory per skill, each with a `SKILL.md`.
- `agents/` — agent definitions with role, scope, and permission posture (`ticket-implementer`, `ticket-qa`, `ticket-planner`).
- `commands/` — short slash-style entry points (`lat-implement`, `lat-qa`, `lat-fix-review`).

## Source of truth

The single contract these assets consume is:

- `docs/templates/opencode-ticket-pack.md` — the **ticket pack** shape produced upstream by the planner. The implementer never queries Linear or GitHub for ticket context; it reads only the pack.

If the ticket pack is missing or malformed, agents must refuse rather than guess.

## What is **not** here

- No endpoint URL, no model name, no provider key, no token. Endpoint and credentials are injected out-of-repo (ADR-0017, ADR-0019).
- No live MCP server configuration that broadens Linear/GitHub reach beyond ticket-pack scope.
- No auto-merge, no Linear write-back. Both are out of band per ADR-0013 and ADR-0019.

## How LAT-105 uses this

LAT-105 will exercise these assets in a dry-run harness (no live Qwen, no live PR). The harness loads the agents, hands them a ticket pack, and validates that refusal / readiness statuses round-trip correctly. Adding or renaming files here changes that surface — keep it small.
