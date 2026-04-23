---
prd_id: LAT-28-icp-observability-cockpit
title: ICP observability cockpit
status: draft
owner: Ben Elliott
date: 2026-04-23
related_linear:
  - LAT-28
  - LAT-5
  - LAT-6
  - LAT-11
  - LAT-18
related_adrs:
  - ADR-0001
  - ADR-0003
  - ADR-0006
  - ADR-0007
  - ADR-0008
  - ADR-0009
  - ADR-0010
  - ADR-0012
  - ADR-0014
derived_from:
  - root-agentic-development-flywheel
supersedes:
superseded_by:
---

# PRD: ICP observability cockpit

## 1. Problem Statement

The pilot runs agents across intake, dispatch, QA, and review surfaces, but the operator (Ben) has no single place to ask "what is the system doing right now, what is stuck, what is expensive, and where are we failing repeatedly?" Today each answer requires opening Linear, opening GitHub PRs, reading individual `runs/<run_id>.md` files, and re-deriving the join by hand. Without a cockpit surface that aggregates the ADR-0006 envelope fields the ICP already emits, the operator either misses signals (a runaway-cost halt, a recurring failure class, a PR waiting on review) or over-reads raw artefacts to stay oriented. We need the product requirements for that cockpit now — before the first dispatch skill is shipped — so that visibility grows with the ICP rather than being retrofitted against a messy tree of runs.

## 2. Goals

1. Define the fixed, named set of **visibility questions** the cockpit must answer at a glance, grounded in ADR-0006's five questions and extended with the product-level views the operator actually reaches for during a pilot cycle.
2. Specify the MVP **views**: active runs, blocked work, recent completions, failed runs, cost-and-risk flags, PR review queue, and retrospective learning candidates. For each view, name the shape of the answer and the source of record.
3. Fix **data sources per view** so every cockpit answer routes to exactly one of Linear, GitHub, ICP `runs/` tree, or "requires future telemetry" — preserving ADR-0014's routing discipline.
4. Define **notification rules**: what must page the operator synchronously (runaway-cost halts, `needs_human` halts, failed PR review gate), what surfaces as an ambient queue item, and what stays silent until queried.
5. Define the **Perplexity summary surface**: how a narrative "state of the flywheel" briefing is rendered from the same envelope fields, without adding a new substrate and without becoming a second source of truth.
6. Preserve MVP-in / MVP-out boundaries from ADR-0014: the cockpit reads repo-committed run records plus Linear and GitHub; it does not introduce a telemetry backend, a database, a dashboard build, or a replacement for Linear/GitHub.

## 3. Non-Goals

1. No final **telemetry backend** choice. ADR-0003 / ADR-0006 / ADR-0014 defer this and so does this PRD.
2. No **dashboard build**. Selecting or building a visual dashboarding tool (Grafana, Metabase, custom web UI) is explicitly deferred; the MVP cockpit is Perplexity + Linear + GitHub reading the same `runs/` tree ADR-0014 defined.
3. No **replacement** for Linear or GitHub. Linear remains the work graph; GitHub remains the code and PR surface. The cockpit is a read-through *projection*, not a new system of record.
4. No **new persistence surface** in the ICP beyond `runs/`. Any cockpit need that cannot be served from `runs/ + Linear + GitHub` is a *gap signal* for the telemetry backend ADR, not a patch to the MVP.
5. No **step-level trace capture**. Start / finish / failure / terminal-status transitions only, per ADR-0014. Live run progress is deferred to the telemetry substrate.
6. No **autonomy-rule changes**. The cockpit surfaces data; escalation rules remain governed by ADR-0008 / ADR-0009 and `approval-gates-and-autonomy-rules.md`.
7. No **cross-repo** aggregation. The cockpit scopes to this repo's `runs/` tree and the Linear `LAT` team.
8. No **historical backfill** beyond what already lives in `runs/` and Linear.

## 4. Primary Users

1. **Ben (operator / approver).** Primary user. Needs a 30-second read of "is anything on fire" and a 5-minute read of "what should I approve, unblock, or kill next?" Works from mobile and desktop. Does not want to open seven browser tabs to get oriented.
2. **Perplexity (as cognition surface).** Renders the summary and answers ad-hoc visibility questions against the same source data. Must be able to cite the specific `runs/<run_id>.md`, Linear issue, or PR that grounds each statement it makes.
3. **Agents (ICP skills, QA, review).** Read the cockpit's underlying signals (cost band, risk level, recent failure patterns for the same `agent_type`) to make their own dispatch and halting decisions. They do not read a rendered cockpit UI; they read the envelope fields the cockpit is built on.
4. **Future human collaborators** (post-pilot). The cockpit must be legible to someone who did not build the pilot — which means naming conventions, field meanings, and routing rules are documented, not implicit.

## 5. Operating Model / Workflow

The cockpit lives downstream of the ICP and upstream of operator judgement. It does not change the Perplexity → Linear → repo flow defined in `docs/process/operating-model.md`; it *reads* from every surface in that flow.

- **Intake and dispatch** are unchanged. Perplexity triages; Linear holds the work graph; ICP dispatches; run records land in `runs/`.
- **Reading** the cockpit is a read-only action at any autonomy level — no approval gate.
- **Acting on** what the cockpit surfaces (approving a halt, raising a budget cap, killing a run, merging a PR) routes back through the existing approval gates in `operating-model.md`. The cockpit does not introduce new gates; it makes existing gate events more visible.
- **Escalation paths** are inherited: runaway-cost halts follow ADR-0009 / `cost-controls.md`; `needs_human` halts follow ADR-0008 / `approval-gates-and-autonomy-rules.md`; retrospective candidates follow ADR-0010 / `retrospective-learning-loop.md`.

## 6. Requirements

### 6.1 Visibility questions (must)

The cockpit must answer each of the following from `runs/ + Linear + GitHub` without custom tooling beyond Perplexity / `grep` / `jq`. Each maps back to ADR-0014's eight query surfaces; gaps here are gap signals for the telemetry ADR, not patches to the MVP.

1. **What are agents doing right now?** — active runs with `status = started` that have not timed out.
2. **What is blocked, and on what?** — runs in `needs_human`, `blocked`, `stopped`, or `failed` joined to their Linear issue.
3. **What finished recently, and how?** — last N `status ∈ {succeeded, failed, cancelled, needs_human}` runs with outcome, evidence URL, and cost band.
4. **Which runs failed, and is there a pattern?** — failed runs grouped by `agent_type`, `linear_issue_id`, `correlation.pr_branch`.
5. **Which runs are expensive or risky, and why?** — runs with `cost.band ∈ {elevated, runaway_risk}` or `risk_level ∈ {high, critical}`, segmented by `agent_type` and `agent_metadata.model`.
6. **Which PRs are waiting on review or merge approval?** — open PRs from dispatched runs joined to their run report's status and risk signals.
7. **Which findings are candidates for the retrospective loop?** — clusters of repeated failure classes, recurring QA/PR-review `medium+` findings, or cost-band regressions (ADR-0010 scope).
8. **Where must the answer come from if it is not in these seven?** — an explicit "this is a telemetry gap" answer, per ADR-0014's routing rule.

### 6.2 MVP views (must)

Each view is a named, bounded projection of the visibility questions above. Views are formatted as short tables or lists that fit a Perplexity answer or a Linear/README block, not as a web UI. For each view, the cockpit must specify: **what it shows**, **sort order**, **source of record**, and **what it never includes** (to keep scope honest).

1. **Active runs.** All runs with `status = started` and `started_at` within the last 24h (default window configurable later). Columns: `run_id`, `agent_type`, `linear_issue_id`, `autonomy_level`, `cost.band`, `started_at`. Sort: `started_at` descending. Source: `runs/*.json`. Never includes: step-level progress (not in envelope).
2. **Blocked work.** Runs with `status ∈ {needs_human, blocked, stopped}` joined to the Linear issue's open state. Columns: `run_id`, `agent_type`, `linear_issue_id`, `status`, one-line reason from `decisions[]` or `errors[]`, `next_actions[0]`. Sort: most-recent halt first. Source: `runs/*.json` + Linear issue state.
3. **Recent completions.** Last 20 runs with a terminal status. Columns: `run_id`, `agent_type`, `linear_issue_id`, `status`, `summary`, `correlation.pr_url`. Sort: `ended_at` descending. Source: `runs/*.json` + GitHub for PR state.
4. **Failed runs.** Terminal-status `failed` runs in the last 7 days, grouped twice: by `agent_type` and by `linear_issue_id`. For each group show count, most recent `errors[0]`, and whether a retrospective candidate applies (≥2 failures on the same `linear_issue_id` or same top-line `errors[0]` class). Source: `runs/*.json`.
5. **Cost and risk flags.** Runs with `cost.band ∈ {elevated, runaway_risk}` **or** `risk_level ∈ {high, critical}`, in the last 7 days. Columns: `run_id`, `agent_type`, `linear_issue_id`, `cost.band`, `risk_level`, one-line reason from `decisions[]`, `cost.spent_usd` (if populated), `agent_metadata.model`. Sort: `runaway_risk` then `critical` first, then by `ended_at` descending. Source: `runs/*.json`. Never includes: a quantitative dollar cap (deferred, ADR-0008 open question 3).
6. **PR review queue.** Open PRs whose title carries a `LAT-*` key, joined to the run report that produced them. Columns: PR number, title, `LAT-*` key, author (agent or human), QA/PR-review finding counts by severity (from ADR-0007 reports if present), run's `risk_level`, `cost.band`. Sort: `critical` or `high` severity first, then oldest open. Source: GitHub (PR state), `runs/*.json` (risk/cost), QA/PR-review reports in the repo where present.
7. **Learning candidates.** The subset of failed runs and `medium+` QA/PR-review findings that recur — same `errors[0]` class across ≥2 runs, same `agent_type` on ≥2 consecutive failed runs, or same PR-review finding class on ≥2 PRs. One-line per cluster with count, span, and pointer into ADR-0010's retrospective intake. Source: `runs/*.json` + QA/PR-review reports.

### 6.3 Data sources per view (must)

For every cockpit answer, the response must name its source of record (Linear, GitHub, `runs/`, or "requires future telemetry"). This is the LAT-18 / ADR-0014 routing rule promoted into a product requirement. The routing matrix below is authoritative for the cockpit; if a view's answer cannot cite a single authoritative source, the view is malformed.

| View | Source of record |
|---|---|
| Active runs | `runs/*.json` |
| Blocked work | `runs/*.json` + Linear issue state |
| Recent completions | `runs/*.json` + GitHub PR state |
| Failed runs | `runs/*.json` |
| Cost and risk flags | `runs/*.json` |
| PR review queue | GitHub (PR list + ADR-0007 review reports in repo) + `runs/*.json` |
| Learning candidates | `runs/*.json` + ADR-0007 reports |
| Step-level / live progress | **requires future telemetry** — cockpit must say so explicitly |
| Full prompt/response traces | **requires future telemetry** — cockpit must say so explicitly |
| Cross-run aggregates beyond pilot volume | **requires future telemetry** — cockpit must say so explicitly |

### 6.4 Notification rules (must)

The cockpit distinguishes three notification tiers. Any event not explicitly tiered is silent-until-queried.

1. **Synchronous page.** The operator is interrupted as soon as the event is detectable from a write into `runs/` or Linear. Triggers:
   - A run writes `cost.band = runaway_risk` (ADR-0009 halt event).
   - A run writes `status = failed` with `risk_level = critical`.
   - A run writes `status = needs_human` where `approval_required = true` per ADR-0008 / `approval-gates-and-autonomy-rules.md`.
   - A PR in the review queue accumulates a `critical` QA/PR-review finding (ADR-0007 severity ladder).
   - The `runs/` tree acquires a `runs/<run_id>.md` with `status: started` that has not transitioned within the session's timeout budget (stale-run suspicion).
2. **Ambient queue.** The event appears in the relevant MVP view next time the operator opens the cockpit, but does not interrupt. Triggers:
   - A failed run at non-critical risk.
   - An `elevated` cost band on a run that ultimately succeeded.
   - A new PR-review finding at `high` severity.
   - A new recurrence in the Learning Candidates view (count transitions from 1 → 2 or 2 → 3).
3. **Silent-until-queried.** Everything else (normal-band succeeded runs, closed issues without findings, cancelled runs).

The cockpit must cite, per notification, the `run_id` or Linear issue that triggered it and the source view where the operator can act on it. A notification with no resolvable citation is a defect. Delivery channel (Linear comment, email, Perplexity thread, mobile push) is an implementation decision — not pre-committed here — but the tiering and triggers are product requirements.

### 6.5 Perplexity summary surface (must)

Perplexity renders the cockpit as a narrative briefing. The briefing must:

1. **Cover the same seven views** in 6.2, in the same order, in a single response. Length budget: a briefing a human can read in under two minutes on mobile. If the state of the flywheel cannot be summarised in two minutes of reading, the summary is over-specified.
2. **Cite every claim** with a `run_id`, Linear issue key, or PR number. Uncited claims are defects. The goal is: every statement in the summary is traceable to an artefact that lives in `runs/`, Linear, or GitHub.
3. **Mark uncertainty** when a view would require the telemetry substrate to answer. The correct form is "this view cannot be answered from current sources — [telemetry substrate ADR trigger]," not a fabricated answer.
4. **Not duplicate** Linear or GitHub. The summary points *into* those surfaces; it does not re-render their state.
5. **Not hold state.** Per `operating-model.md`, Perplexity threads are working drafts. The cockpit summary is re-rendered on demand from `runs/ + Linear + GitHub`; it is never itself a source of truth.
6. **Compose with notifications.** When a synchronous-page trigger fires, the summary's top section must surface it first; ambient-queue items appear in their respective views.

### 6.6 Non-functional (should)

1. **Freshness.** Active-runs and blocked-work views should reflect any `runs/*.json` write within one read cycle (i.e., the operator opening the cockpit again).
2. **Latency.** Rendering the full summary should complete in the same order of magnitude as a Perplexity read over the current `runs/` tree at pilot volume (tens to low hundreds of files).
3. **Legibility.** Every field shown in a view must resolve to an ADR-0006 field name; no view-local invented fields.
4. **Reversibility.** If the telemetry substrate ADR lands, views should migrate by repointing the source (not by re-specifying the view). ADR-0014's "only the run recorder's persist step changes" invariant applies here too: only the cockpit's read step changes.
5. **Safe for publication.** The cockpit inherits ADR-0014's rule that `runs/` contains no secrets or PII. Any view that renders `runs/*.json` fields is safe to publish; views that would expose unredacted tool traces are *not* in the MVP and belong to the telemetry substrate.

## 7. Acceptance Criteria

- [ ] **Status answer shape and source.** For each of the seven MVP views, the PRD (and the eventual implementation) names the shape of the answer (what columns / fields) and the single source of record (Linear, GitHub, `runs/`, or future-telemetry gap). A review that cannot point to the source column for a given answer fails this criterion.
- [ ] **Failed-pattern surfacing.** The Failed Runs view and the Learning Candidates view together surface any `errors[0]` class that recurs across ≥2 failed runs within a 7-day window, without the operator writing custom queries. Surfacing must include the count, the span, and a link into the underlying run reports.
- [ ] **Cost / risk escalation highlighting.** Any run with `cost.band = runaway_risk` or `risk_level = critical` is highlighted above all other views in the summary and is tied to a synchronous-page notification trigger. Any run with `cost.band = elevated` or `risk_level = high` appears in the Cost and Risk Flags view but does not page synchronously.
- [ ] **Routing discipline.** Every cockpit view cites its source of record. No view invents a source. Views that would need a source beyond `runs/ + Linear + GitHub` are explicitly labelled "requires future telemetry."
- [ ] **Perplexity summary renders cleanly.** A Perplexity-rendered summary of the cockpit fits a two-minute mobile read, covers the seven views, cites every claim, and marks telemetry gaps explicitly.
- [ ] **Notification tiering is respected.** No event outside the synchronous-page trigger set pages the operator. No event inside the synchronous-page trigger set is silent.
- [ ] **MVP-in / MVP-out respected.** The PRD names only `runs/ + Linear + GitHub` as sources; it does not introduce a new persistence surface, a dashboard, or a replacement for Linear/GitHub.

## 8. Success Metrics

**Product metrics** (outcome-visible):

- **Time to orient.** Operator can answer "is anything on fire, and what should I do next?" from the cockpit in under 60 seconds from a cold start. Proxy: self-report across ≥5 pilot cycles.
- **Unassisted visibility rate.** Share of operator visibility questions answered from the cockpit (vs. by opening Linear, GitHub PRs, or raw `runs/` files directly). Target: ≥80% of questions resolved inside the cockpit's seven views during a pilot cycle.
- **Missed-signal rate.** Number of runaway-cost halts, `needs_human` halts, or `critical` findings the operator learns about through a channel other than the cockpit. Target: 0 over a pilot cycle.

**Workflow metrics** (process-visible):

- **Cost band drift.** Share of runs reaching `elevated` or `runaway_risk` without appearing in the Cost and Risk Flags view. Target: 0.
- **Rework rate on unsurfaced failures.** Count of retrospective findings (ADR-0010) whose triggering failures were *not* surfaced by the Learning Candidates view in real time. Target: trend to 0 over successive pilot cycles.
- **Human-intervention lead time.** Median time from a `needs_human` run write to operator action. Target: faster than the pre-cockpit baseline (measured once the cockpit is in use for two cycles).

## 9. Open Questions

1. **Delivery channel for synchronous pages.** Linear mention, email, mobile push, or a combination? Depends on whether the mobile intake UX work (`docs/process/mobile-intake-ux.md`) provides a push target. Candidate ADR only if a new channel is introduced.
2. **Stale-run detection threshold.** How long a `status: started` file may sit before the cockpit treats it as stale. ADR-0014 accepts stale-`started` files for the MVP. Pilot-volume default likely 1–4 hours; resolve with the first implementation ticket.
3. **PR review queue composition.** Whether to include PRs not tied to a `LAT-*` key. Leaning no — the cockpit's scope is dispatch-backed work — but confirm with one pilot cycle.
4. **Learning candidate thresholds.** The "≥2 recurrences" trigger is a starting heuristic. Revise from ADR-0010 retrospective experience; no ADR needed unless the trigger becomes a governance rule.
5. **Whether the summary itself is persisted.** The PRD says no (working draft per `operating-model.md`). If an archival pattern emerges (e.g., weekly cockpit snapshots committed to `docs/snapshots/`), revisit — likely a separate small ADR, not a change to this PRD.
6. **When Cost and Risk Flags need quantitative bands.** ADR-0008 open question 3. The cockpit surfaces qualitative bands today; quantification is a telemetry-substrate concern.
7. **Cross-repo scope.** Out of scope here; if a second repo joins the pilot, a sibling PRD or a revision is the right vehicle.

## 10. Risks

**Product risk:**

- **Over-scoped cockpit becomes a dashboard.** Mitigation: the MVP views are bounded to seven; new views require a PRD revision, not an implementation PR.
- **Summary hallucination.** Perplexity renders a plausible-sounding briefing that is not grounded in `runs/`. Mitigation: every claim cites a `run_id`, issue, or PR; uncited claims are defects per 6.5.
- **Operator adopts cockpit in place of Linear/GitHub.** Mitigation: the cockpit points *into* those surfaces and never edits them; the operating model's surface-per-job discipline (ADR-0001) is reinforced.

**Process / cost risk:**

- **Notification fatigue.** Too-broad synchronous-page triggers cause alert blindness. Mitigation: the trigger set in 6.4 is closed; additions are a PRD revision.
- **Telemetry substrate pressure.** Operator asks a visibility question the cockpit cannot answer, and the pressure is to widen `runs/` or invent a side-channel. Mitigation: routing rule — unanswerable questions are telemetry-ADR triggers, not patches.
- **Drift from `runs/` schema.** View definitions tie to ADR-0006 field names. Mitigation: 6.6.3 forbids view-local invented fields; breaking schema changes remain ADR-worthy per ADR-0006.
- **Reversibility erosion.** If the cockpit grows implementation that only works against `runs/`, it cannot cheaply migrate when the telemetry substrate lands. Mitigation: 6.6.4 keeps the cockpit's read step the only thing that changes at migration time.

## 11. Dependencies

**Hard blockers (must land first):**

- `LAT-18` / ADR-0014 — state, persistence, and telemetry architecture. Merged. Defines the `runs/` tree the cockpit reads from.
- `LAT-5` / ADR-0006 — run-visibility schema. Merged. Defines the envelope the views project.
- `LAT-8` / ADR-0003 — Linear persistence boundary / five-element write-back. Merged. Defines how Linear mirrors the envelope.

**Recommended predecessors (preferred order, not gates):**

- A first-slice dispatch skill (the implementation of ADR-0012's `dispatch-ticket@0.1.0`) producing `runs/*.json` files in anger. Until this exists, cockpit views render empty; the PRD can still be approved.
- `LAT-11` / ADR-0010 retrospective learning loop in active use, so the Learning Candidates view has something to route into.

**External:**

- Perplexity access to the repo and to Linear (already in place per ADR-0001).
- GitHub API access for PR state (available via standard repo tooling).
- No third-party telemetry service is required or implied.

## 12. Approval & Autonomy

- **Reading** the cockpit is read-only and requires no approval at any autonomy level.
- **Acting on** cockpit signals routes through existing gates:
  - Runaway-cost unblock → Ben, per `cost-controls.md`.
  - `needs_human` run → Ben or designated agent per `approval-gates-and-autonomy-rules.md`.
  - Merging a PR from the review queue → Ben, per `operating-model.md`.
- **Changing** view definitions, notification tiers, or source-of-record routing requires a PRD revision or a new ADR (for cross-PRD concerns like telemetry).
- Agents may **draft** cockpit improvements (new views, tightened triggers) but must not unilaterally change routing rules or notification tiers — those are governance surfaces inherited from ADR-0008 / ADR-0014.

## 13. Definition of Done

- [ ] Goals met and acceptance criteria checked.
- [ ] Every view in 6.2 has a named source of record in the 6.3 matrix.
- [ ] Notification tiering in 6.4 has exhaustive synchronous-page triggers; no silent events in the trigger set.
- [ ] Perplexity summary surface in 6.5 cites every claim and marks telemetry gaps explicitly.
- [ ] Open questions resolved or deferred to named ADRs / Linear issues.
- [ ] Linear `LAT-28` and this PRD cross-linked.
- [ ] No implementation details leaked into the PRD (tooling, libraries, UI choices, schemas beyond the ADR-0006 field names already in use).

## 14. Links

- Linear issues: `LAT-28` (this PRD), `LAT-5`, `LAT-6`, `LAT-8`, `LAT-11`, `LAT-18`, `LAT-22`.
- Related ADRs:
  - `docs/decisions/0001-use-perplexity-linear-and-github-as-control-plane.md`
  - `docs/decisions/0003-linear-persistence-boundary.md`
  - `docs/decisions/0006-agent-run-visibility-schema.md`
  - `docs/decisions/0007-qa-review-evidence-workflow.md`
  - `docs/decisions/0008-agent-control-layer-and-perplexity-boundary.md`
  - `docs/decisions/0009-cost-controls-and-runaway-cost-interrupts.md`
  - `docs/decisions/0010-retrospective-learning-loop.md`
  - `docs/decisions/0012-integration-control-plane-software-architecture.md`
  - `docs/decisions/0014-icp-state-persistence-and-telemetry.md`
- Process docs:
  - `docs/process/operating-model.md`
  - `docs/process/approval-gates-and-autonomy-rules.md`
  - `docs/process/cost-controls.md`
  - `docs/process/qa-review-evidence.md`
  - `docs/process/retrospective-learning-loop.md`
- Templates:
  - `docs/templates/prd.md`
  - `docs/templates/agent-run-report.md`
- Prior art / research: none beyond the ADRs above.
