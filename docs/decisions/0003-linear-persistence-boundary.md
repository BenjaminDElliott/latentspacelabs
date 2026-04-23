---
id: ADR-0003
title: Linear persistence boundary
status: accepted
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-9
  - LAT-12
supersedes:
superseded_by:
revisit_trigger: Revisit when the telemetry substrate ADR lands, or when Linear comment volume becomes unreadable during backlog refinement — whichever comes first.
---

# ADR-0003: Linear persistence boundary

## Context

Linear is the durable work graph (see ADR-0001), but it is not the right home for full raw agent traces, long-form architectural rationale, or high-volume telemetry. Without a defined boundary, Linear comments risk becoming a dumping ground that is slow to read, expensive to query, and brittle as the volume of agent runs grows. At the same time, too little Linear content makes the work invisible to the humans who use Linear as their primary operational surface.

This ADR was previously blocked on the choice of telemetry substrate and on whether PRDs live in the repo. We now accept a **minimal pilot boundary** that does not require the telemetry substrate to exist yet, and treats the repo as canonical for PRDs and ADRs. The substrate question is explicitly deferred to a follow-up ADR.

## Decision Drivers

- Linear should remain human-readable and useful during backlog refinement.
- Agents need a durable, predictable place to write status and evidence tied to a specific issue.
- High-fidelity traces should live in a dedicated telemetry substrate, to be chosen later.
- Avoid split-brain: for each artifact type, there must be exactly one canonical home.
- Minimize custom tooling during the pilot; do not block on systems that do not yet exist.
- Project creation, merge, and deploy must remain human approval gates (see `operating-model.md`).

## Considered Options

1. Store everything in Linear (comments, project updates, attachments).
2. Store only summaries and links in Linear; put rationale in this repo and traces in a future telemetry substrate.
3. Store summaries in Linear and rationale inline in Linear issue descriptions; no repo docs.
4. Defer entirely and let the boundary emerge organically from agent runs.

## Decision

**Accepted: Option 2, as a minimal pilot boundary.**

Each surface has one job:

- **Linear** — operational work graph and human review surface. Holds issues, comments, status, labels, approvals, and short write-back summaries from agent runs. It is *not* the canonical long-form doc store and *not* the high-volume trace/log store.
- **GitHub (this repo)** — canonical for durable docs, ADRs, PRDs, templates, code, and PR history. Anything promoted from a draft lands here via PR.
- **Perplexity** — active intake, reasoning, and workbench. Artifacts are drafts until promoted via PR.
- **Telemetry substrate (future)** — canonical for high-fidelity agent traces, model/tool/runtime metadata, cost bands, observations, test logs, and event streams. The substrate itself is deferred to a follow-up ADR. Until it exists, agent runs write a compact Markdown run report (see `docs/templates/agent-run-report.md`) either in the PR body / a PR comment, or committed to the repo, and link that from Linear.

### What Linear receives from an agent run

For each completed agent run, the write-back to the associated Linear issue must contain:

1. A concise outcome summary (what the agent set out to do and what happened).
2. Evidence links (PR URL, run report URL, relevant artifacts).
3. Risk flags, if any (including cost-band if elevated).
4. The PR link, when a PR was opened.
5. The recommended next action and any open questions that block progress.

These five elements are the Linear write-back contract. Anything beyond them belongs in the run report, PR description, or telemetry substrate — not in the Linear comment.

### What Linear does not receive

- Full raw agent traces, prompt/response logs, tool-call transcripts, or per-step timings. These belong in the telemetry substrate (or, in the interim, in a committed run report file linked from Linear).
- Long-form architectural rationale. Promote to an ADR in this repo and link the ADR URL from Linear.
- Final PRDs. Linear issue descriptions can hold requirements and acceptance criteria, but once a PRD is promoted to the repo, the repo file is canonical and the Linear description should link to it rather than duplicate it.
- Bulk log/event dumps, screenshots of entire runs, or serialized JSON of the full agent envelope.

### Comment size and shape guideline

Linear comments from agents should be scannable in under ~30 seconds during backlog refinement. As a rule of thumb, aim for something a human can read on a phone without scrolling more than once — roughly the size of a PR description's *Summary* section. If a comment is trending toward the length of an ADR or a full run report, that content belongs in the repo or the telemetry substrate, linked from Linear. We are deliberately not setting an exact character count; the test is "can a human scan this during triage," not "does it fit under N bytes."

### Linear issue descriptions

Issue descriptions may hold task requirements and acceptance criteria and are a reasonable home for the agent-ready ticket template. They are **not** the final resting place for PRDs or ADRs — once the PRD or ADR is promoted to this repo, the Linear description should link to the repo file rather than mirror its content.

### Approval gates touched by this ADR

- **Creating a new Linear Project** requires explicit approval from Ben. Agents must not auto-create projects; they may propose one and wait.
- **Creating or updating Linear issues** (including write-back summaries, backlog refinement edits, and intake-generated tickets) is allowed without per-action approval, within the rules above.
- **Merge and deploy** remain human-approved, per `operating-model.md`. Nothing in this ADR relaxes those gates.

### GitHub-sourced intake

GitHub issue comments and PR review comments are first-class intake events and may create or update Linear issues (see `intake-triage.md`). This does not make Linear the trace store — the intake result is still a bounded summary linked back to the GitHub URL.

## Consequences

Good:

- Linear stays readable during backlog refinement.
- Agents have a predictable write target per artifact type, including a defined write-back contract.
- Rationale is diff-able and reviewable in this repo.
- The pilot can start now without waiting on the telemetry substrate ADR.

Bad / open:

- Until the telemetry substrate exists, the run-report link points to a file in the repo or a PR comment, not a queryable store. This is acceptable for pilot volume but will not scale.
- Requires discipline: agents and humans must resist pasting long rationale or raw traces into Linear comments. This ADR leans on review rather than tooling to enforce that.
- The comment-size guideline is deliberately qualitative. If it fails in practice, we tighten it in a follow-up.

## Open Questions

1. What is the minimum viable telemetry substrate for agent run reports (JSONL in repo, SQLite, Postgres, Langfuse/Helicone, or other)? Deferred to a follow-up ADR — this ADR does not block on it. (Partially narrowed by [ADR-0013](0013-icp-state-persistence-and-telemetry.md), which pins the MVP run registry to repo-committed Markdown + JSON under `runs/` and explicitly defers the backend selection itself.)
2. Cadence and mechanism to keep Linear links and repo URLs in sync as docs move — likely solved by a CI check, tracked under the ADR-0004 automation follow-up.
3. For personal or cross-cutting notes not tied to a single `LAT-*` issue: out of scope here; `intake-triage.md` handles the personal-vs-project split.

## Confirmation

Working if, three months in:

- Linear comments are predominantly short summaries with links, following the five-element write-back contract.
- PRDs and ADRs are found via repo URLs, not Linear attachments.
- No durable rationale exists only inside a Linear comment or Perplexity thread.
- No full agent trace is pasted into Linear; traces live in run reports or the telemetry substrate.
- New Linear Projects are only created after explicit approval from Ben.

## Links

- Linear: `LAT-9`, `LAT-12`.
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0004-process-docs-vs-agent-skills.md`, `0013-icp-state-persistence-and-telemetry.md` (MVP run-registry destination and visibility query surfaces).
- Template: `docs/templates/agent-run-report.md`.
- Process: `docs/process/operating-model.md`, `docs/process/intake-triage.md`.
