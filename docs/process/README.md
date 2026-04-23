# Process

This directory holds durable process documentation for the Agentic Development Flywheel MVP. Process docs describe *how work moves through the system* — intake, triage, approval, execution, and retro — independent of any single tool implementation.

## What lives here

- `operating-model.md` — Roles of Perplexity, Linear, GitHub, and humans; approval boundaries.
- `intake-triage.md` — How raw input becomes structured work, with a ruthless chief-of-staff posture.

## What does not live here

- Architectural decisions with long-term consequences → `docs/decisions/` (ADRs).
- Code, CI, and deployment logic → repo root and future `apps/` or `services/` directories.
- In-flight work state, assignees, due dates → Linear.
- Raw brainstorms, research threads → Perplexity; promote to this repo only when durable.

## How these docs evolve

1. A proposed change starts as a Perplexity thread or workspace Markdown draft.
2. When the change is ready to govern behavior, open a PR that edits the relevant file here.
3. If the change represents an architecturally significant decision (autonomy, persistence, observability, security, cost, or integration boundary), also add or update an ADR in `docs/decisions/`.
4. Link the PR to the relevant Linear issue (`LAT-*`). Link the Linear issue forward to the merged doc.
5. Keep process docs concise. Link out to ADRs, PRDs, and Linear issues rather than inlining long context.

## Review posture

Process docs are living documents. Prefer frequent small edits over accumulating a huge diff. Breaking changes to the operating model should be ADR-backed so the rationale survives.
