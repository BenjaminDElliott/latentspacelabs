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
| Create Linear issues marked for refinement | No — agent-created issues default to `needs-refinement` and are reviewed at the next refinement pass (see *Backlog refinement*, `intake-triage.md`) |
| Create Linear projects | **Yes** (explicit Ben approval; agents may propose but must not auto-create — see ADR-0003) |
| Start coding agents | **Yes, per-dispatch** during pilot (ADR-0008 L3-with-approval; not batched) |
| Start QA / review agents | **Yes, per-dispatch** during pilot |
| Open PRs | No, if the Linear issue key is in the PR title (see PR ↔ Linear linking convention) |
| Merge PRs | **Yes** |
| Deploy | **Yes** |
| Change autonomy rules | **Yes** — requires an ADR (ADR-0008 and ADR-0009 are the canonical locations) |
| Resume a ticket whose last run halted for runaway-cost | **Yes** — requires an explicit Ben unblock comment on the Linear issue (cap raise, re-scope, or cancel). See `cost-controls.md`. |

Runaway-cost risk is always a stop-and-ask event, even when product risk is otherwise low. The three cost bands (`normal`, `elevated`, `runaway_risk`), the concrete triggers, and the interrupt protocol live in `cost-controls.md` (architecture: ADR-0009).

The full category-by-action rule matrix — including Perplexity-direct vs Agent Control Layer routing, autonomy levels L0–L5, and the failure posture by severity — lives in `approval-gates-and-autonomy-rules.md` (architecture: ADR-0008).

### Backlog refinement (cadence)

Ben runs a backlog-refinement pass at least **weekly**, and additionally whenever the `intake` + `needs-refinement` queue crosses ~15 open items. The pass reviews, prunes, and reprioritizes agent-created and intake items, and promotes only those passing the `agent-ready` pre-flight. Full procedure: `intake-triage.md` → *Backlog refinement loop*.

This cadence is load-bearing: L2 permission for agent-created Linear issues (ADR-0008) assumes the refinement pass happens.

### Cost reporting (every run)

Every spend-incurring agent run populates the `cost` object in the run report (`docs/templates/agent-run-report.md`), including a non-null `cost.band`. `elevated` and `runaway_risk` bands must surface in the Linear write-back's `Risks:` line per ADR-0003. A run report missing `cost.band` is grounds for rejection in review. Policy: ADR-0009 + `cost-controls.md`. Absolute dollar/token budgets are **not set yet** — they are a deliberate non-goal until the telemetry substrate can enforce them.

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

## Verification of code-producing runs

Every code-producing agent run (any run that opens a PR) closes out with QA and PR-review evidence before merge is requested. The authoritative policy is [ADR-0007](../decisions/0007-qa-review-evidence-workflow.md); the operational guide is [`qa-review-evidence.md`](qa-review-evidence.md). In summary:

- **Two concerns, two reports.** QA answers "did the change do what the ticket said it should do?" (`docs/templates/qa-report.md`). PR review answers "is the change the right change, done well?" (`docs/templates/pr-review-report.md`). They overlap; that is intentional.
- **Agent shape.** Default is separate QA and PR review agents. A combined QA+review agent is allowed **only** when the ticket is `Risk level: low`, reversible, touches no security-sensitive surface (auth, permissions, secrets, dispatch policy, cost gating, data retention), and makes no ADR-relevant decision. Combined agents still produce both report sections.
- **Severity ladder.** `nit` · `low` · `medium` · `high` · `critical`. `high` and `critical` findings cannot carry an `approve`/`approve-with-nits` recommendation; `critical` always routes to `needs-human` (Ben). Runaway cost risk is `critical` by default.
- **Recommendations.** `approve` · `approve-with-nits` · `request-changes` · `block-merge` · `needs-human`. **No verification recommendation authorizes merge.** Merge and deploy remain Ben-approved per the gates above.
- **Linear write-back.** Same five-element ADR-0003 contract, with two additions: the outcome states the recommendation verbatim, and `Risks:` surfaces every `high`/`critical` finding by severity label even when the recommendation is approval-variant.

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
- ADRs: `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`, `0002-store-process-docs-and-adrs-in-the-monorepo.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0007-qa-review-evidence-workflow.md`.`0008-agent-control-layer-and-perplexity-boundary.md`.
- Process: `qa-review-evidence.md`.
- Linear: `LAT-9` (persistence model), `LAT-10` (operating model), `LAT-12` (low-friction intake UX — see `process/mobile-intake-ux.md`), `LAT-15` (dependency and sequencing model), `LAT-8` (QA / review evidence workflow). `LAT-16` (ACL and Perplexity boundary), `LAT-6` (autonomy dial).
