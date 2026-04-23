# Context compaction and agent handoff

> Working manual for how long-running ICP work is compacted, handed off, and resumed without silent loss. Authoritative policy lives in [ADR-0015](../decisions/0015-context-compaction-and-agent-handoff-policy.md); this document is the operational guide an agent or human reads at runtime. If the two disagree, the ADR wins until superseded (`operating-model.md` → *Source-of-truth rules*).

## Why this exists

A coding, research, or review run that crosses a chat compaction — or hands off to the next agent because its scope ended — cannot rely on "earlier context" being still visible to the next actor. Chat is ephemeral (`docs/README.md` → *Canonical sources*). Linear threads and PR bodies can be overwritten. A spike that produced no implementation PR disappears when the tab closes.

The LAT-54 retrospective found an earlier context-compaction spike whose findings were never codified in a durable surface, so the next agent in that area had nothing to resume from. This doc exists so that does not happen again — and so the rule is checkable by the coding-agent preflight (`coding-agent-preflight.md`) without new automation.

## What a handoff is, in this pilot

A **handoff** occurs whenever any of the following is true:

- A run ends with open follow-up that another agent or the same agent in a later run must pick up.
- A chat / agent context compacts mid-run and the post-compaction agent must reason from a summarised form of the earlier session.
- A spike run ends without producing an implementation PR — its findings must still reach the next actor somehow.
- A PR is opened, paused, and resumed later (potentially by a different agent).
- A Linear issue moves status in a way that implies the next action belongs to a different actor (e.g. `In Review`, `Blocked`, `Needs human`).

A handoff is **not** a normal mid-run transition inside a single agent's working context — a coding agent finishing step 3 and moving to step 4 does not produce a handoff packet. The packet is for transitions *across* run / agent / context boundaries.

## The minimum handoff packet

Per ADR-0015 Rule 1, every handoff carries these fields. They are not a new file — they live in surfaces the pilot already uses.

| Field | Meaning | Lives in |
|---|---|---|
| Current goal | One sentence — the goal *right now*, narrowed from the original ticket if scope tightened. | Run report `summary`; PR body *Summary*; Linear write-back `Outcome`. |
| Active ticket(s) | Primary and secondary `LAT-*` keys in play. | Run report `linear_issue_id` + PR title prefix (`operating-model.md` → *PR ↔ Linear linking*). |
| Open PR(s) | URLs with status (draft / open / merged / closed). | Run report `correlation.pr_url`; Linear write-back `PR`. |
| Blockers | Hard blockers and cost-band state. | Run report `next_actions` + `cost.band`; Linear write-back `Risks`. |
| Decisions already taken | ADR IDs, process-doc links, or a named paragraph in a committed run report. Never "see chat". | Run report `decisions`; PR body *Decisions* (if any); ADR / process-doc links. |
| Next action | The single next step, concrete enough to dispatch from. | Run report `next_actions[0]`; Linear write-back `Next action`. |
| Open questions | Unresolved blockers to the next action, or "none". | Run report narrative; Linear write-back `Open questions`. |

A run that expects a handoff and leaves one of those fields empty is unfinished in the sense this doc uses. Fill the field before closing the run, or the next actor will re-derive from chat — which is the failure LAT-54 exists to prevent.

## When a compaction event must be recorded

Per ADR-0015 Rule 2, a compaction event crossed *during a run whose result ships* must leave a record in the run's evidence. Record:

- **When** — e.g. `before step 5`, `after the first PR review pass`, `mid-retro after question 3`.
- **What was compacted** — one-line description: `triage notes for LAT-54 scope`, `tool-choice comparison table`, `spike rationale for compaction policy`.
- **Where the pre-compaction content is durable** — a link to the ADR / process doc / PRD / template / committed run report / PR body paragraph that preserves the load-bearing content, *or* an explicit statement that the content was not durably preserved because it was not load-bearing.

The record goes in the run report narrative (`docs/templates/agent-run-report.md` → *Narrative* + *Evidence*). If the compaction changed something the Linear write-back references, add a short `Risks:` line: `compaction event mid-run; see <run report URL>`.

Skippable compaction events — ones that do not need to be recorded:

- A compaction during a run that shipped *nothing* (pure exploration that ended at the boundary). The next actor has nothing to resume.
- A compaction that only dropped working-memory artefacts the agent had already promoted (i.e. the durable copy already exists; nothing was lost).

## What content belongs where

Per ADR-0015 Rule 3. When in doubt, prefer the more durable surface — Linear and PR bodies can be edited without history by humans or tools outside the repo.

| Content | Goes in | Not in |
|---|---|---|
| Architecturally significant decision (autonomy, persistence, observability, security, cost, integration boundary) | `docs/decisions/` ADR (new or superseding). | Buried in a PR body or Linear comment. |
| Cross-cutting process / policy change | `docs/process/` doc (new or edited). | PR body or chat summary alone. |
| Feature-level scope / requirement / acceptance | `docs/prds/` PRD. | Linear comment or PR body alone. |
| Artefact schema | `docs/templates/` file. | Inline in a prose doc. |
| Per-run outcome, risks, open questions | Linear write-back (five-element ADR-0003 contract). | Run report alone — Linear must carry the bounded summary too. |
| Per-PR changelog, tests run, affected hubs | PR body. | Linear comment alone. |
| Full raw agent trace, long rationale, tool logs | Run report (committed or linked); future telemetry substrate when it lands. | Linear or PR body. |
| Draft / exploratory reasoning not yet promoted | Perplexity / workspace scratch (explicitly ephemeral). | Treated as durable by a later run. |

The "durable source" test: a PR or Linear reference to "earlier discussion" must resolve to an ADR, process doc, PRD, template, or a named paragraph in a committed run report. "Per our earlier chat" / "as we discussed in Perplexity" fails the test.

## Spike terminal states

Per ADR-0015 Rule 4, every spike run ends in exactly one of two states:

1. **Findings promoted.** Load-bearing output is written into a new or edited ADR, process doc, PRD, template, or a named paragraph in a committed run report. Promote via a PR whose title uses the spike's `LAT-*` key (or the follow-up ticket's key when the spike is sub-work).
2. **Explicitly archived.** Linear write-back: `Outcome: spike complete — no promotion; archived`. `Next action:` is `none` or names a revisit condition. Run-report narrative records why the findings were not promoted.

A spike that ends with neither state is the LAT-54 failure case. If a retro (ADR-0010) detects one in its window, it promotes or archives retroactively per `retrospective-learning-loop.md` → *Findings and promotions*.

## Preflight checklist for agents about to close out a run

Before opening a PR, closing a Linear issue, or ending a spike, the agent confirms each of the following. Any `no` is a refuse / warn per `coding-agent-preflight.md` → *Refusal and warn behaviour*.

- [ ] Run report carries the handoff packet fields (goal, active tickets, open PRs, blockers, decisions, next action, open questions).
- [ ] Linear write-back follows the ADR-0003 five-element contract and restates the packet's *Outcome*, *Evidence*, *Risks*, *PR*, *Next action*, *Open questions*.
- [ ] PR body carries Summary, Testing, and affected-hubs line (per `operating-model.md` / `coding-agent-preflight.md`).
- [ ] If the run crossed a compaction event and shipped something, the event is recorded in the run report's narrative with *when / what / where durable*.
- [ ] Every reference to prior rationale resolves to a durable source (ADR, process doc, PRD, template, committed run report paragraph). No "see chat" / "per our Perplexity thread" references.
- [ ] If this is a spike: findings are either promoted via PR or the Linear write-back explicitly says `archived` with rationale.
- [ ] No hand-maintained shared-hub index was edited to land the handoff (`docs/README.md`, `docs/decisions/README.md`, `docs/prds/README.md`, `docs/process/README.md`, rule-matrix tables). If a link was needed in one of those, it is a follow-up for the hub owner, not an opportunistic edit on this PR.

## Preflight checklist for agents picking up a handed-off run

Before the first file edit on a resumption run, the agent confirms each:

- [ ] Located the prior handoff packet (run report + Linear write-back + PR body). If any of the three is missing, refuse and route the ticket to `needs-human`; do not reconstruct from chat.
- [ ] Current goal, active tickets, open PRs, blockers, prior decisions, and next action are answerable from those durable records alone. If any is not, refuse with a cite to ADR-0015 Rule 1.
- [ ] Prior decisions named in the packet resolve to ADR / process-doc / PRD / template / committed run-report paragraphs. "See chat" references trigger refuse-and-escalate; the fix is to promote the load-bearing part into a durable surface before resuming.
- [ ] If the prior run recorded a compaction event, read the linked durable content *before* acting on any decision that pre-dates the compaction.
- [ ] If the prior run was a spike and neither terminal state (promoted / archived) is present, refuse and route for retroactive promotion or archival per ADR-0015 Rule 4.

## Scope boundary with other process docs

- **`coding-agent-preflight.md`** — the enforcement seam for this policy. Its § A / § B / § C checks are where a missing handoff packet, an un-promoted spike, or a "see chat" reference becomes a hard refuse.
- **`operating-model.md`** — defines the four-substrate model and the PR ↔ Linear linking convention this doc relies on. This doc does not restate the linking rule; it assumes it.
- **`retrospective-learning-loop.md`** — the downstream backstop. A silent-loss failure slipping past preflight (e.g. a PR whose chat-only rationale was not flagged) gets caught here and routed per the retro's four promotion paths.
- **`qa-review-evidence.md`** — QA / review is the other downstream backstop. A PR that references a non-durable source for a load-bearing claim is a `medium`+ finding.
- **`cost-controls.md`** — compaction events sometimes correlate with cost-band escalation (very long sessions). The cost-band `Risks:` line and the compaction-event `Risks:` line are separate; both may apply.

## Related

- ADR-0015 (authoritative policy): `docs/decisions/0015-context-compaction-and-agent-handoff-policy.md`
- ADR-0003 (Linear persistence boundary and write-back contract)
- ADR-0006 (agent run visibility schema)
- ADR-0010 (retrospective learning loop — retroactive fix path for silent losses)
- Process: `coding-agent-preflight.md`, `operating-model.md`, `retrospective-learning-loop.md`, `qa-review-evidence.md`
- Templates: `docs/templates/agent-run-report.md`, `docs/templates/retro-report.md`
- Linear: `LAT-54` (this policy), `LAT-35` (preflight companion), `LAT-46` (operating-model handoff surface), `LAT-33` (index-hotspot constraint)
