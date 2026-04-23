---
id: ADR-0015
title: Context compaction and agent handoff policy
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-54
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) a second coding or research run loses a load-bearing decision across a chat compaction or agent handoff despite this policy being followed, (b) the MVP dispatcher (LAT-18 / LAT-21) lands a durable run registry that can host handoff packets natively, making Markdown run reports no longer the primary persistence surface, (c) a skill framework lands (per ADR-0012) that can enforce the handoff packet mechanically at skill-runner gate time, or (d) run-report / Linear write-back volume makes the "durable source first" rule introduce friction a dispatcher pass cannot absorb.
---

# ADR-0015: Context compaction and agent handoff policy

## Context

The pilot runs long, multi-step ICP work across surfaces that each forget things on their own schedule. Chat contexts compact or roll over. Agent runs end. PR descriptions get overwritten on force-push. Linear threads grow past what a reader will scroll. Perplexity threads are ephemeral by contract (ADR-0001, `docs/README.md` → *Canonical sources*).

The LAT-54 retrospective found that an earlier context-compaction spike was never codified: its findings did not land in an ADR, a process doc, a PRD, a template, or a commit message. The next agent to pick up that area of work had no durable record to resume from, so the spike was effectively lost. This is the failure mode the pilot's four-substrate model (ADR-0001, ADR-0003) is supposed to prevent — but only if there is an explicit rule for what must be persisted, where, at which moment, and with which minimum content.

Existing pieces already cover part of the surface:

- ADR-0003 fixes the Linear persistence boundary and the five-element write-back contract (outcome, evidence, risks, PR, next action / open questions).
- ADR-0006 fixes the agent run report envelope and the visibility questions a reader must be able to answer from it.
- ADR-0010 and `docs/process/retrospective-learning-loop.md` bound how evidence becomes durable change.
- `docs/process/coding-agent-preflight.md` blocks new work that would silently violate those contracts.

What none of them says is: **when a run, chat, or agent hands off — either because it ran out of context, or because the next step belongs to a different agent, or because a spike ended without an implementation PR — what is the minimum durable record the next actor needs to resume?** Every pilot surface assumes the answer lives somewhere else. This ADR names it.

This is a decision ticket, not an implementation ticket. It does not build automation, does not create a new docs platform, does not archive every chat message, and does not ship any ICP runtime code. It names: (1) what a handoff packet is and where it lives, (2) when a compaction event must be recorded in run evidence, (3) which content belongs in durable docs vs Linear comments vs PR bodies vs thread summaries, and (4) what to do with a spike whose findings did not produce a PR.

## Decision Drivers

- **Four substrates, one per job (ADR-0001, ADR-0003).** Any handoff rule must respect that repo = durable truth, Linear = work graph, GitHub PRs = code/change, Perplexity/chat = ephemeral cognition. The rule cannot invent a fifth substrate and cannot move a substrate's job.
- **Anti-astronautics (`docs/decisions/README.md`).** No automation, no new tool, no parallel archive. The policy must be satisfied with files and fields already in the pilot's surfaces.
- **No new shared hotspots (LAT-33, `docs/README.md` → *Index policy*).** A handoff rule that requires editing a shared index or a hand-maintained list re-introduces exactly the merge-conflict surface the index policy removed. The rule must be local to the ticket / PR / run report in flight.
- **Durable source wins (`operating-model.md` → *Source-of-truth rules*).** A reference to "earlier chat" or "Perplexity thread X" is not a durable source. A PR or Linear comment that gestures at prior discussion without pointing to a committed artefact fails the rule.
- **Minimum viable handoff.** The next actor must be able to answer the ADR-0006 visibility questions — *what is the current goal, which tickets/PRs are active, what is blocked and on what, what was decided, what is the next action* — from durable records alone, without replaying a chat.
- **Spikes are not exempt.** A research or design spike that produces no implementation PR is the single most common silent-loss path. The policy must say where its findings land or that they were explicitly archived.
- **Enforceable by preflight, not by new machinery.** The rule must be checkable by the existing coding-agent preflight (`docs/process/coding-agent-preflight.md`) — i.e. a running agent can see at the last safe moment whether its plan violates the policy.

## Considered Options

1. **Do nothing; trust convention.** Rely on ADR-0003 write-backs, ADR-0006 run reports, and PR bodies to carry enough context. Rejected: that is the pre-LAT-54 state, and the retrospective explicitly found it insufficient — the compaction spike was lost under it.
2. **New "handoff log" directory under `docs/`.** Add `docs/handoffs/NN-...md` committed per-run, holding the full handoff packet. Rejected: creates a third durable surface parallel to run reports and PR bodies, duplicates ADR-0006 fields, and invents a new index that would drift the way the ADR-0010 / LAT-33 indexes did. The pilot does not need a new substrate; it needs the existing surfaces to carry a named minimum.
3. **Automate compaction summaries via a tool or harness hook.** Have the harness detect compaction and write a structured record. Rejected for the MVP per LAT-54 non-goals (no automation). The skill-runner gate in ADR-0012 is the right enforcement point *once it exists*; until then this is a contract, not a pipeline.
4. **Codify a handoff packet as a named section inside existing surfaces, define a compaction-event evidence rule, and name a single canonical home for spike findings.** *Chosen.*

## Decision

The pilot adopts four rules, all enforced by the existing preflight and write-back contracts, requiring no new automation and no new shared index.

### Rule 1 — The minimum handoff packet

Every long-running ICP run, PR, and Linear write-back that will be picked up by another agent, a later run of the same agent type, or a human reader resuming cold must carry a **handoff packet** with the following minimum fields:

| Field | What it says | Where the reader looks for it |
|---|---|---|
| Current goal | One sentence: what this line of work is trying to achieve. Not the ticket title — the *current* goal, which may have narrowed. | Run report `summary`; PR body *Summary*; Linear write-back `Outcome`. |
| Active ticket(s) | `LAT-*` keys in play, including any sub-tickets the run touched. | Run report `linear_issue_id` + `correlation.pr_branch`; PR body `Related: LAT-NN` line. |
| Open PR(s) | URLs, with status (draft/open/merged/closed). | Run report `correlation.pr_url`; Linear write-back `PR`. |
| Blockers | Hard blockers (named `LAT-*` or external) and cost-band state (`normal` / `elevated` / `runaway_risk`). | Run report `next_actions` + `cost.band`; Linear write-back `Risks`. |
| Decisions already taken | ADR IDs, process-doc links, or "no ADR yet — rationale in <PR body or run report>". Not "see chat". | Run report `decisions`; PR body *Decisions* (if any); ADR / process-doc links. |
| Next action | The single next step the next actor should take, concrete enough to dispatch from. | Run report `next_actions[0]`; Linear write-back `Next action`. |
| Open questions | Unresolved questions that block the next action, or "none". | Run report `errors` / narrative; Linear write-back `Open questions`. |

The packet is **not a new file**. It is the union of fields the existing templates already require (ADR-0003 write-back, ADR-0006 envelope, `docs/templates/agent-run-report.md` *Human-readable summary*, and the PR body conventions in `operating-model.md`). The contribution of this rule is that an agent or reviewer can now *name the packet* and check each field is present before the run or PR closes.

A run, PR, or write-back missing one of the packet fields is **not handed-off** in the sense this policy uses. If the next action depends on someone picking up where this run stopped, the author fills the missing field; otherwise the next actor will re-derive from chat, which is precisely the failure LAT-54 exists to prevent.

### Rule 2 — Compaction events must be recorded in run evidence

A **compaction event** is any moment in a run where the chat context the agent was reasoning in is reduced, rolled over, or summarised — whether by the harness, by an explicit `/compact`-style command, by a session restart, or by the agent itself condensing earlier reasoning into a shorter note. It is *not* the normal mid-run summarisation an agent does while working; it is a boundary at which earlier reasoning is no longer directly visible.

A compaction event that occurred *during a run whose result ships (a PR, a merged doc, a `LAT-*` status change)* must be recorded in that run's evidence with at minimum:

- **When** it happened (approximate; `before step N` or `mid-PR-review` is acceptable).
- **What was compacted** (one-line description — "triage draft notes", "spike rationale", "tool-choice comparison").
- **Where the pre-compaction content is durable** — a link to the committed ADR / process-doc / run report / PR body paragraph that preserves it, or an explicit statement that the content was *not* durably preserved and why that was safe.

The record lives in the run report narrative (`docs/templates/agent-run-report.md` → *Narrative* and *Evidence*), and — if the compaction changed a decision the Linear write-back references — as a short `Risks:` line (`compaction event mid-run; see <run report URL>`) on that write-back per ADR-0003.

A run that both (a) crossed a compaction event and (b) shipped a change whose rationale was in the pre-compaction context, with **no** durable reference to where that rationale now lives, fails the handoff packet check at Rule 1.

Runs that cross a compaction event without shipping anything (e.g. exploration that ended at the compaction boundary) are not required to record it — the point of this rule is that decisions and findings that *cross* the boundary survive it, not that every compaction produces paperwork.

### Rule 3 — Durable placement: what belongs where

To avoid the "see chat" failure mode, the policy fixes which surface each kind of content lives in. A PR or write-back whose content is in the wrong column is a Rule 1 failure when a handoff is expected.

| Content | Goes in | Not in |
|---|---|---|
| Architecturally significant decision (autonomy, persistence, observability, security, cost, integration boundary) | ADR under `docs/decisions/` (new or superseding), per `docs/decisions/README.md`. | Buried in a PR body or a Linear comment. |
| Cross-cutting policy or process change | Process doc under `docs/process/` (new or edited), per `docs/process/README.md`. | PR body or chat summary. |
| Feature-level requirement / scope / acceptance | PRD under `docs/prds/`, per `docs/prds/README.md`. | Linear comment or PR body alone. |
| Artefact schema (template) | `docs/templates/` file. | Inlined into a prose doc. |
| Per-run outcome, risks, open questions | Linear write-back (five-element ADR-0003 contract). | Run report only — Linear must also carry the bounded summary. |
| Per-PR changelog, tests run, affected hubs | PR body. | Linear comment only. |
| Full raw agent trace, long rationale, tool logs | Run report (committed or linked), per ADR-0006; future telemetry substrate when it lands (ADR-0003 open question). | Linear or PR body. |
| Draft / exploratory reasoning that has not been promoted | Perplexity / workspace scratch — explicitly ephemeral per `docs/README.md`. | Treated as durable by a later run. |

If a PR or Linear reference points at an earlier *discussion* for rationale, that reference must resolve to one of the top four rows (ADR / process doc / PRD / template) or to a named paragraph in a committed run report. A reference that resolves only to chat — "per our earlier Perplexity thread", "as we discussed in the retro session" — is a Rule 3 violation. The fix is to promote the load-bearing part of the discussion into the appropriate durable surface before merging the PR that depends on it; the rest can stay ephemeral.

### Rule 4 — Spike findings without an implementation PR

A **spike** is any bounded research or design run that does not end in an implementation PR — typical outcomes are a written recommendation, a set of trade-offs, or an explicit "do nothing yet" decision. LAT-54 was motivated by a spike whose findings vanished at compaction time.

Every spike run has exactly one of two terminal states:

1. **Findings promoted.** The spike's load-bearing output is written to one of: a new or edited ADR, a new or edited process doc, a new or edited PRD, a new template, or a named paragraph in a committed run report that subsequent work links to. The promoting PR title uses the spike's `LAT-*` key (or the follow-up ticket's key when the spike is sub-work of a larger issue).
2. **Explicitly archived.** The spike's Linear write-back states `Outcome: spike complete — no promotion; archived` and the `Next action:` is either `none` or names the follow-up condition under which the findings would be revisited. The run report's narrative records the rationale for not promoting. This matches the retro loop's *archived note* path in `docs/process/retrospective-learning-loop.md`.

A spike that ends with neither of those — findings exist in chat only, no promotion PR, no explicit archived write-back — is the failure LAT-54 exists to prevent. When the next retro (ADR-0010) detects such a spike in its window, it creates a backlog item to either promote or archive the findings retroactively, or records a failure pattern per `docs/process/retrospective-learning-loop.md` → *Repeated failure detection*.

Spikes never default to "keep exploring"; the terminal-state rule applies at the end of the spike's agent run, not later.

### Enforcement seam

None of these rules are new automation. They are checked by the existing coding-agent preflight (`docs/process/coding-agent-preflight.md`): a run about to ship a PR whose body, run report, or write-back references "earlier discussion" without resolving to a durable surface fails the preflight's `docs/process/coding-agent-preflight.md` § C ("run-report content") + § B (conflict-surface, when a shared hub edit is the hidden fix) checks. A run that crosses a compaction event without a narrative record fails § C's run-report field check. A spike agent that would close its Linear issue without either promotion or explicit archival fails the same contract.

When the skill framework (ADR-0012) lands, these checks become skill-runner gates on the `dispatch-ticket` and any future `run-spike` skills. Until then they are manual, and the preflight is the enforcement point.

## Consequences

Good:

- The next agent picking up a long-running line of work has a named, bounded set of fields to read from durable records before starting. It does not need to replay chat or trust a compaction summary.
- Spike findings either land somewhere a future reader can find them or are explicitly marked absent — the silent-loss failure that motivated LAT-54 is eliminated in steady state, not by new tooling but by an enforceable contract.
- The four substrates (Perplexity, Linear, GitHub, ICP-future) keep their jobs; nothing new is invented. Enforcement rides on the preflight that already exists.
- A human reading cold six months later — the test case `operating-model.md` invokes — can answer the ADR-0006 visibility questions from the handoff packet without asking.

Bad / open:

- The handoff packet is a *union* of existing fields, not a new single artefact. A reader cross-referencing run report + PR body + Linear write-back still has to look in three places. The pilot accepts that cost in exchange for not creating a new substrate; once the telemetry substrate ADR lands (ADR-0003 open question), the packet should collapse into one record queryable from that substrate.
- Compaction-event detection depends on the agent being honest about when a compaction happened. The harness does not yet emit a structured compaction signal. Until it does (future ADR, when / if the harness gains that capability), this rule leans on agent self-report. The preflight can catch *missing* records but cannot detect compactions that the agent simply did not notice.
- Rule 3's "not in chat" is checkable only when a PR or write-back makes the reference explicit. A PR whose rationale secretly lives in chat but does not mention it cannot be caught by preflight; it can only be caught downstream by QA / review (ADR-0007) or the retro loop (ADR-0010). That downstream catch is the backstop this ADR relies on.
- The policy does not specify maximum age for "durable source" references. A PR referencing an ADR from six months ago that has since been superseded still passes Rule 3 mechanically, even though the reference may now be misleading. The ADR supersession rule in `docs/decisions/README.md` and the retro loop's evidence review are the existing defences; this ADR does not duplicate them.

## Confirmation

The decision is working if:

- A resumption run on any `LAT-*` issue that has at least one prior completed run can identify — from repo + Linear + committed run reports alone — the current goal, active tickets, open PRs, blockers, prior decisions, and next action, without the prior run's author in the loop. This is the LAT-54 acceptance criterion; it is also the test a retro should run on any long-running ticket it reviews.
- Spike runs in a retro window all show one of the two terminal states — promoted or explicitly archived. A retro finding of "spike findings exist only in chat" on a run *after* this ADR lands is a failure pattern per ADR-0010 and should produce improvement work.
- Preflight refusals that cite this ADR are taken as a first-class refuse under `coding-agent-preflight.md` § *Refusal and warn behaviour*, not waived informally.

It is not working — revisit per the `revisit_trigger` above — if any of those signals degrades, or if the handoff packet's distributed shape proves unworkable once a second caller or a persistence backend appears.

## Links

- Related Linear issue: `LAT-54`.
- Related predecessors: `LAT-35` (coding-agent preflight), `LAT-46` (operating-model handoff / retro surface), `LAT-24` (ADR numbering and frontmatter validation — the enforcement substrate this ADR builds on), `LAT-33` (removed hand-maintained index hotspots — the constraint Rule 1 honours).
- Related ADRs: `ADR-0001` (four-substrate control plane), `ADR-0003` (Linear persistence boundary and write-back contract), `ADR-0004` (docs vs agent skills), `ADR-0006` (agent run visibility schema — the envelope Rule 1 references), `ADR-0007` (QA / review evidence — downstream backstop for Rule 3), `ADR-0010` (retrospective learning loop — the retro that will detect silent-loss failures), `ADR-0012` (ICP software architecture — future mechanical enforcement point).
- Related process docs: `docs/process/coding-agent-preflight.md` (enforcement seam), `docs/process/operating-model.md` (PR ↔ Linear linking and source-of-truth rules), `docs/process/retrospective-learning-loop.md` (promotion paths for retroactive fixes), `docs/process/context-compaction-and-handoff.md` (working manual for this ADR).
- Related templates: `docs/templates/agent-run-report.md`, `docs/templates/retro-report.md`.
