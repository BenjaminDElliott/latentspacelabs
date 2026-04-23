# Process

This directory holds durable process documentation for the Agentic Development Flywheel MVP. Process docs describe *how work moves through the system* — intake, triage, approval, execution, and retro — independent of any single tool implementation.

## Policy vs executable procedure

Process docs here are **human-readable policy and reference**. They describe what we do and why. They are not the thing an agent reads at runtime to execute a procedure.

The working assumption — to be ratified or rejected in [ADR-0004](../decisions/0004-process-docs-vs-agent-skills.md) — is a three-layer split:

1. **Docs (this directory and `docs/decisions/`)** — canonical policy, rationale, and reference. Source of truth.
2. **Agent skills and slash commands** (future, likely `.claude/skills/` and `.claude/commands/`) — operational adapters that *execute* the policy. Generated from, or kept in sync with, the docs. Not yet present in this repo.
3. **Templates (`docs/templates/`)** — artifact schemas (PRD, ADR, agent-ready ticket, agent run report) that both humans and skills consume.

Until ADR-0004 decides otherwise, docs are canonical and skills/commands are treated as downstream operational adapters. A skill that disagrees with a doc is a skill bug.

## What lives here

- `operating-model.md` — Roles of Perplexity, Linear, GitHub, and humans; approval boundaries.
- `intake-triage.md` — How raw input becomes structured work, with a ruthless chief-of-staff posture.

## What does not live here

- Architectural decisions with long-term consequences → `docs/decisions/` (ADRs).
- Executable agent procedures → future `.claude/skills/` or `.claude/commands/` (see ADR-0004).
- Code, CI, and deployment logic → repo root and future `apps/` or `services/` directories.
- In-flight work state, assignees, due dates → Linear.
- Raw brainstorms, research threads → Perplexity; promote to this repo only when durable.

## How these docs evolve

1. A proposed change starts as a Perplexity thread or workspace Markdown draft.
2. When the change is ready to govern behavior, open a PR that edits the relevant file here.
3. If the change represents an architecturally significant decision (autonomy, persistence, observability, security, cost, or integration boundary), also add or update an ADR in `docs/decisions/`.
4. If a corresponding skill or slash command exists, flag that it may need to be regenerated. Until automation lands, this is a manual call-out in the PR description.
5. Link the PR to the relevant Linear issue (`LAT-*`) by prefixing the PR title with the issue key (e.g. `LAT-13: short imperative title`) and referencing it in the PR body. See `operating-model.md` → *PR ↔ Linear linking convention* for the full rule, including multi-issue and no-issue cases. Link the Linear issue forward to the merged doc.
6. Keep process docs concise. Link out to ADRs, PRDs, and Linear issues rather than inlining long context.

## Review posture

Process docs are living documents. Prefer frequent small edits over accumulating a huge diff. Breaking changes to the operating model should be ADR-backed so the rationale survives. Changes that alter agent behavior should note the impacted skills/commands even if those don't exist yet, so the mapping is explicit when they are built.
