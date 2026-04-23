---
id: ADR-0003
title: Linear persistence boundary
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-12
supersedes:
superseded_by:
revisit_trigger: Decide before the first coding-agent run writes a summary to Linear.
---

# ADR-0003: Linear persistence boundary

## Context

Linear is the durable work graph (see ADR-0001), but it is not the right home for full raw agent traces, long-form architectural rationale, or high-volume telemetry. Without a defined boundary, Linear comments risk becoming a dumping ground that is slow to read, expensive to query, and brittle as the volume of agent runs grows. At the same time, too little Linear content makes the work invisible to the humans who use Linear as their primary operational surface.

## Decision Drivers

- Linear should remain human-readable and useful during backlog refinement.
- Agents need a durable place to write status and evidence tied to a specific issue.
- High-fidelity traces should live in a dedicated telemetry substrate, to be chosen later.
- Avoid split-brain: for each artifact type, there must be exactly one canonical home.
- Minimize custom tooling during the pilot.

## Considered Options

1. Store everything in Linear (comments, project updates, attachments).
2. Store only summaries and links in Linear; put rationale in this repo and traces in a future telemetry substrate.
3. Store summaries in Linear and rationale inline in Linear issue descriptions; no repo docs.
4. Defer entirely and let the boundary emerge organically from agent runs.

## Decision

*Proposed:* **Option 2.** Linear holds structured summaries, status, decisions, and links. Long-form rationale (PRDs, ADRs) lives in this repo. Full agent traces live in a telemetry substrate to be chosen in a later ADR. Under this proposal, each Linear issue that relates to an agent run carries: a one-paragraph summary, a link to the PR (if any), a link to the agent run report in the telemetry substrate, and a status label.

Not yet accepted — see open questions.

## Consequences (if accepted)

Good:

- Linear stays readable during backlog refinement.
- Agents have a predictable write target per artifact type.
- Rationale is diff-able and reviewable in this repo.

Bad / open:

- Requires a telemetry substrate before coding agents generate meaningful run volume. Until then, summaries point to this repo or workspace Markdown as an interim sink.
- Requires discipline: agents and humans must resist the temptation to paste long rationale into Linear comments.

## Open Questions

1. What is the minimum viable telemetry substrate for agent run reports (JSONL file in repo, SQLite, Postgres, Langfuse/Helicone, or other)? To be resolved in a follow-up ADR.
2. What is the maximum acceptable size of a Linear comment before content must be moved to this repo or the telemetry substrate?
3. Should PRDs live in this repo, in Linear project content, or both (repo canonical, Linear linked)? Leaning: repo canonical.
4. For personal or cross-cutting notes not tied to a single `LAT-*` issue, where do they land? Likely out of scope for this ADR, but the boundary must not silently eat them.
5. What cadence and mechanism keeps Linear links and repo URLs in sync as docs move?

## Confirmation (draft)

Working if, three months in, Linear comments are predominantly short summaries with links; PRDs and ADRs are found via repo URLs not Linear attachments; and no durable rationale exists only inside a Linear comment or Perplexity thread.

## Links

- Linear: `LAT-12`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`.
- Template: `docs/templates/agent-run-report.md`.
