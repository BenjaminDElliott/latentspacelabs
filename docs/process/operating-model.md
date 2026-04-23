# Operating Model

The Agentic Development Flywheel MVP is organized around four clearly separated surfaces. Each has one job. None tries to be the whole system.

## Surfaces and responsibilities

### Perplexity — intake, reasoning, and control interface

- Accepts low-friction raw input (text, voice, mobile brain dumps).
- Runs the ruthless chief-of-staff triage posture (see `intake-triage.md`).
- Drafts PRDs, ADRs, tickets, and retros.
- Reads across connected tools (Linear, GitHub, future telemetry) to answer Ben's questions.
- **Does not** hold durable state. Threads are working drafts.

### Linear — durable work graph and human review surface

- Holds projects, epics (parent issues), agent-ready tickets, comments, labels, and project updates.
- Tracks who owns what and the current status of work.
- Links to the canonical doc in this repo for each PRD, ADR, or policy.
- Receives bounded agent-run write-backs following the Linear write-back contract (see ADR-0003): outcome summary, evidence links, risk flags, PR link, and next action / open questions.
- **Does not** store full raw agent traces, long-form rationale, final architecture, or final PRDs. Those live in this repo or, later, in a dedicated telemetry substrate.

### GitHub (this repo) — durable source of truth

- Canonical location for process docs, ADRs, PRDs, templates, code, PRs, and CI.
- ADR file naming: `docs/decisions/NNNN-title-with-dashes.md` (MADR convention).
- Process doc changes flow through PRs, not direct edits in Linear or Perplexity.

### Telemetry substrate (future) — high-fidelity trace store

- Canonical home for full agent run traces, model/tool/runtime metadata, cost bands, test logs, and event streams.
- Substrate choice is deferred to a follow-up ADR (see ADR-0003 open questions).
- Until it exists, agent runs produce a compact Markdown run report (`docs/templates/agent-run-report.md`) in the PR body, a PR comment, or a committed file, and link it from Linear.

### Human (Ben) — approver and product judgment

- Approves high-impact actions.
- Reviews backlog and ADR proposals.
- Sets the autonomy dial for agents as evidence accumulates.

## Approval gates (pilot defaults)

| Action | Approval required |
|---|---|
| Triage raw input | No |
| Draft PRD, ticket, or ADR | No |
| Create Linear issues marked for refinement | No |
| Create Linear projects | **Yes** (explicit Ben approval; agents may propose but must not auto-create — see ADR-0003) |
| Start coding agents | **Yes** during pilot |
| Open PRs | No, if the Linear issue key is in the PR title (see PR ↔ Linear linking convention) |
| Merge PRs | **Yes** |
| Deploy | **Yes** |
| Change autonomy rules | **Yes** |

Runaway cost risk is always a stop-and-ask event, even when product risk is otherwise low.

## PR ↔ Linear linking convention

All PRs for Linear-tracked work must be discoverable from Linear without manual search. This is an **agent execution rule**, not just human advice — agents that open PRs must follow it.

- **PR title must prefix the primary Linear issue key**, e.g. `LAT-13: short imperative title`. Linear's GitHub integration uses this to link the PR to the issue automatically.
- **PR body must reference the related Linear issue(s)** with the key (e.g. `LAT-13`) or a full URL in a `Related:` or `Linear:` line.
- **Multiple issues:** put the primary key in the title; list secondary keys in the PR body (e.g. `Also: LAT-10, LAT-12`).
- **No Linear issue yet?** Stop and create/triage the issue first via the intake flow, unless the human has explicitly instructed you to open a PR without one. Do not invent a ticket number.

## Dispatch readiness and dependency model

Before any agent is dispatched to a `LAT-*` issue, the dispatcher must check the issue's dependency state using the model defined in ADR-0005. In summary:

- **Hard blockers** must be `Done`, `Cancelled`, or `Superseded` before dispatch. A hard blocker is an entry on the `Hard blockers:` line of the issue's `## Sequencing` block — not a parent/child relation and not a comment.
- **Recommended predecessors** are preferences, not gates. Dispatch may proceed with soft predecessors unresolved only if the work is low-risk and reversible (per `intake-triage.md`) and the budget cap is intact. Unresolved soft predecessors must be flagged in the run report and the Linear write-back.
- **Related context** never blocks dispatch.
- **Parent/child hierarchy (sub-issues)** signals decomposition, not dependency. Sub-issues are fine for grouped backlog work — e.g. a "Decision backlog" parent with child ADR tickets — but an agent dispatching any child still reads that child's `## Sequencing` block. A sub-issue is not a blocker unless the relationship is explicitly listed there or encoded as a Linear native `blocks` relation.
- **Labels** classify issue *kind* or *coarse state* (e.g. `decision`, `policy`, `template`, `executable-adapter`, `blocked`, `caution`, `ready`) and are useful for human filtering. Labels cannot encode an ordered `LAT-*` dependency list and must not be used alone to resolve blockers.
- **Comments** are breadcrumbs, not contracts. Agents must not infer dependencies from comments when deciding whether to dispatch.
- **Architecture/ADR tickets** missing a `## Sequencing` block fail safely to `caution`, not `ready`. The dispatcher should flag for refinement rather than proceed.

Full format, defaults, and the step-by-step dispatch algorithm live in ADR-0005. The `## Sequencing` block is the source of truth agents read; Linear's native `blocks` / `blocked by` relation remains the canonical human/UI representation when available.

The `## Sequencing` block is a **transitional pilot bridge**, not the long-term architecture. Once the Agent Control Layer (or an equivalent canonical dependency graph) can read/write native Linear relations, the block is expected to be deprecated as the authoritative dispatch source per a follow-up ADR — possibly becoming a generated mirror or being removed from issue descriptions entirely. Until that follow-up ADR lands, agents must continue to treat the block as authoritative; it is the only connector-readable pilot mechanism today. See ADR-0005 "Deprecation and migration".

## Linear write-back contract

Every agent run that touches a `LAT-*` issue must leave a single, bounded write-back comment on that issue. The comment contains, at minimum:

1. Outcome summary — what the agent set out to do and what happened.
2. Evidence links — PR URL, run report URL, and any other relevant artifacts.
3. Risk flags — including cost band if elevated.
4. PR link — when a PR was opened.
5. Next action and any open questions blocking progress.

Anything beyond that — raw traces, long rationale, large diffs, log dumps — goes into the run report, PR description, repo docs, or the future telemetry substrate, and is *linked* from Linear rather than pasted into it. See ADR-0003 for the full policy and the comment size/shape guideline.

## Source-of-truth rules

- If process and ADRs disagree, the ADR wins until superseded.
- If Linear and this repo disagree on a policy, this repo wins; update Linear to match.
- If Perplexity and this repo disagree, this repo wins; Perplexity output is a draft until merged here.

## Related

- PRD: *Agentic Flywheel Observability and Control Plane* (workspace draft; to be promoted).
- ADRs: `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`.
- Linear: `LAT-9` (persistence model), `LAT-10` (operating model), `LAT-12` (persistence boundaries), `LAT-15` (dependency and sequencing model).
