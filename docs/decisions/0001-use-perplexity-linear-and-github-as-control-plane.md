---
id: ADR-0001
title: Use Perplexity, Linear, and GitHub as the control plane
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-10
  - LAT-12
  - LAT-13
supersedes:
superseded_by:
revisit_trigger: Revisit after the first end-to-end pilot from raw intake through agent-ready ticket and retro.
---

# ADR-0001: Use Perplexity, Linear, and GitHub as the control plane

## Context

The Agentic Development Flywheel MVP needs an intake, reasoning, and control surface that tolerates low-friction raw input; a durable work graph that humans can read and act on; and a source-of-truth home for code, PRs, and durable docs. Building a custom orchestrator or UI before the workflow is validated risks opaque, expensive automation that produces work without enough product judgment or quality gates.

## Decision Drivers

- Intake must be low-friction enough to use during a normal workday (mobile, voice, messy notes).
- The system must push back on ambiguity rather than silently creating work.
- Linear should not become the coding-agent orchestrator during the pilot.
- Durable state must survive beyond any single Perplexity thread.
- No premature custom UI, orchestrator, or telemetry stack.

## Considered Options

1. Use Linear as both intake and persistence.
2. Use Perplexity as intake/control and Linear as durable work graph, with GitHub as code and docs source of truth.
3. Build a custom intake UI and orchestrator immediately.
4. Use a generic notes app as intake and sync later.

## Decision

**Chosen: Option 2.** Perplexity is the intake and control interface. Linear is the durable work graph. GitHub (this repo) is the source of truth for durable docs, ADRs, code, and PRs. Human approval gates sit at project creation, agent dispatch, merge, and deploy.

## Consequences

Good:

- Raw input stays conversational and mobile-friendly.
- Linear receives structured artifacts, not messy dumps.
- No premature custom UI or orchestrator.
- Perplexity provides the ruthless chief-of-staff layer without new infrastructure.

Bad / open:

- Until a durable intake service exists, the flow is partly manual and thread-dependent.
- Some state lives in Perplexity context until explicitly written to Linear or this repo.
- Observability still needs a real event store outside both Perplexity and Linear — deferred to a later ADR.

## Confirmation

This decision is working if Ben can dump raw input into Perplexity, receive useful triage, and have the right structured artifacts land in Linear and this repo — with clear approval boundaries and without runaway cost.

## Links

- Linear: `LAT-10`, `LAT-12`, `LAT-13`.
- PRD: *Agentic Flywheel Observability and Control Plane* (workspace draft; to be promoted to this repo).
- Related ADRs: `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0003-linear-persistence-boundary.md`.
