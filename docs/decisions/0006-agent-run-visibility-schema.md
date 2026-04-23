---
id: ADR-0006
title: Agent run visibility schema (pilot)
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-5
supersedes:
superseded_by:
revisit_trigger: Revisit when the telemetry substrate ADR lands, when Perplexity cannot answer the visibility questions listed below against the data we are producing, or when we add an agent type that does not fit the current envelope.
---

# ADR-0006: Agent run visibility schema (pilot)

## Context

The pilot will dispatch a mix of coding, QA, review, SRE, PM, research, and observability agents. Without a common shape for what each run emits, we cannot answer basic questions across runs — what are agents doing, what is blocked, which runs are costly, where are agents failing repeatedly — and we cannot give Linear a bounded, scannable write-back that remains consistent as the agent mix grows.

ADR-0003 already set the Linear persistence boundary and deferred the choice of telemetry substrate. What was still missing: the exact *fields* that a run must carry, across all agent types, so the Linear write-back, the run report, and any future substrate all agree on the same envelope. That is what this ADR fixes — the **schema**, not the storage.

Backend selection (JSONL-in-repo, SQLite, Postgres, Langfuse/Helicone, OpenTelemetry-compatible store, …) is **still deferred** to a follow-up ADR. This ADR is usable without that choice because the envelope is transport-agnostic Markdown + JSON.

## Decision Drivers

- One envelope shape must work for every agent type in the pilot; specialization lives in open sub-objects, not in forked templates.
- A human reading a Linear comment during triage must see outcome, risks, and next action in under ~30 seconds (ADR-0003 comment-shape guideline).
- Perplexity must be able to answer a small, fixed set of operational questions by reading across run reports without custom tooling.
- Runaway-cost and repeated-failure signals must be first-class, not buried in prose.
- The schema must be forward-compatible: adding a field is non-breaking; removing or renaming a field is ADR-worthy.
- The schema must not commit us to a telemetry backend.

## Considered Options

1. **Per-agent-type templates** — one envelope per agent type (coding, QA, review, SRE, PM, research, observability). Rejected: duplicates common fields, makes cross-run questions expensive, and fragments the Linear write-back.
2. **One envelope with required core fields and open sub-objects** (this decision) — `run_id`, `agent_type`, `status`, `started_at`, `ended_at` are required; everything else is optional and forward-compatible; agent-type-specific detail goes into `agent_metadata`, `cost`, `correlation`, and the narrative sections.
3. **Defer until the telemetry substrate is chosen** — rejected: blocks the pilot; we need a common shape now, and the substrate decision benefits from having real run reports to query against.
4. **Freeform Markdown per run** — rejected: makes the Perplexity-facing visibility questions impossible to answer without re-reading every run.

## Decision

**Accepted: Option 2.** The canonical schema is defined in `docs/templates/agent-run-report.md`. This ADR is the governing decision; the template is the machine- and human-readable form. If they disagree, the ADR wins until the template is updated in the same PR that changes the schema.

### Required core fields (all agent types)

Every run report must populate at least:

- `run_id` — stable, unique per run.
- `agent_type` — one of `coding | qa | review | sre | pm | research | observability`.
- `status` — one of `started | succeeded | failed | cancelled | needs_human`.
- `started_at`, `ended_at` — ISO-8601 timestamps (UTC).

### Strongly-recommended fields (populate when known)

- `triggered_by` — `user | linear_status | schedule | webhook | agent | github_comment`.
- `linear_issue_id`, `project_id` — so runs can be grouped by issue or project.
- `input_artifacts`, `output_artifacts` — list of URLs or repo-relative paths.
- `summary` — one or two sentences, same content as the Linear write-back's `Outcome:` line.
- `decisions`, `tests_run`, `errors`, `next_actions` — short lists; long detail belongs in the narrative or an external artifact.
- `risk_level`, `cost_band`, `approval_required`, `autonomy_level` — operational signals.
- `agent_metadata.model`, `agent_metadata.model_provider`, `agent_metadata.reasoning_effort` — so cost and quality analyses can segment by model.
- `cost.spent_usd`, `cost.input_tokens`, `cost.output_tokens`, `cost.cached_tokens`, `cost.band` — runaway-cost detection.
- `correlation.parent_run_id`, `correlation.trace_id`, `correlation.session_id`, `correlation.pr_url`, `correlation.pr_branch`, `correlation.commit_sha`, `correlation.github_comment_url` — so sub-runs and their artifacts can be stitched together without bespoke joins.

### Open sub-objects (extensibility contract)

`agent_metadata`, `cost`, and `correlation` are **open objects**. Adding a key is a minor, non-breaking change. Renaming or removing a key is a breaking change and requires a new ADR. Consumers (Linear formatter, future telemetry substrate, Perplexity queries) must tolerate unknown keys.

Agent-type-specific fields live inside these sub-objects or in the narrative sections — not as new top-level keys. For example, a coding agent's PR URL lives in `correlation.pr_url`; a research agent's source URLs live in `output_artifacts`; an SRE agent's paged alert ID lives in `correlation` under an agreed key.

### Linear write-back format (reaffirming ADR-0003)

The write-back comment on a Linear issue is the *bounded projection* of the run envelope. It contains exactly five elements, in this order:

```md
**Outcome:** <one or two sentences on what happened>
**Evidence:** <PR URL> · <run report URL> · <other artifacts>
**Risks:** <risk flags, including cost band if elevated; "none" is fine>
**PR:** <PR URL, or "n/a">
**Next action:** <single recommended next step>
**Open questions:** <blocking questions, or "none">
```

Mapping from envelope to comment:

- `Outcome` ← `summary`.
- `Evidence` ← `correlation.pr_url` + run-report URL + selected `output_artifacts`.
- `Risks` ← `risk_level`, and `cost_band` if not `normal`, and any flagged `errors`.
- `PR` ← `correlation.pr_url`.
- `Next action` ← first entry in `next_actions`.
- `Open questions` ← unresolved items from `next_actions` or `errors` that require human input.

Do not paste `decisions`, `tests_run`, raw traces, or `agent_metadata` into the Linear comment. Link them via the run report URL.

## Perplexity-facing visibility questions

The envelope is considered sufficient if Perplexity, reading across run reports (plus Linear and GitHub), can answer each of the following without custom code:

1. **What are agents currently doing?** — list recent runs with `agent_type`, `linear_issue_id`, `status`, `started_at`, and `summary`.
2. **What is blocked, and on what?** — runs with `status = needs_human`, plus open `next_actions` and `Open questions` from Linear write-backs, grouped by `linear_issue_id`.
3. **Which runs are costly, and why?** — runs with `cost_band != normal` or `risk_level = high`, segmented by `agent_type` and `agent_metadata.model`, sorted by `cost.spent_usd`.
4. **Where are agents failing repeatedly?** — runs with `status = failed` grouped by `agent_type` and by `linear_issue_id` / `correlation.pr_branch`, to surface retry loops and chronically-failing workstreams.
5. **What changed in the last <window>?** — runs filtered by `started_at`, grouped by `agent_type` and `status`, to produce a weekly or daily operating review.

If a new visibility question cannot be answered from the envelope, that is the trigger to extend the schema (via an open sub-object when possible, via an ADR when a top-level change is needed).

## Consequences

Good:

- One envelope, one Linear write-back format, one set of Perplexity questions — consistent across all seven agent types.
- Cost and failure signals are first-class, so runaway cost and retry loops become visible before they become expensive.
- Adding a field is a minor change; the schema can evolve without an ADR for every addition.
- No backend lock-in: the envelope is JSON-in-Markdown today and can be replayed into any future telemetry store.

Bad / open:

- Until the telemetry substrate exists, answering the visibility questions means Perplexity reading Markdown run reports — workable at pilot volume, not at production volume.
- The mapping from envelope to Linear write-back is defined in prose here and in the template, not enforced by code. Drift is possible until a formatter skill exists.
- "Strongly recommended" fields are not enforced; an agent that skips `cost.band` hides itself from question 3. We accept this for the pilot and will tighten in a follow-up if it bites.

## Confirmation

Working if, six to eight weeks in:

- Every agent run in the pilot produces a run report that conforms to the required core fields.
- Linear comments are uniformly in the five-element write-back format and stay within the ADR-0003 comment-shape guideline.
- Perplexity can answer the five visibility questions above without new tooling.
- No agent type has forked the envelope or introduced a parallel template.
- Cost-band and repeated-failure signals have triggered at least one human intervention that would otherwise have been missed.

## Links

- Linear: `LAT-5`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0013-icp-state-persistence-and-telemetry.md` (locates the envelope in the `runs/` tree for the MVP and names the visibility query surfaces).
- Template: `docs/templates/agent-run-report.md` (canonical schema form).
- Process: `docs/process/operating-model.md` (Linear write-back contract).
- Deferred: telemetry substrate ADR (tracked under ADR-0003 open questions).
