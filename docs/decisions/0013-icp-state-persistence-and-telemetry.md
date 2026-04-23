---
id: ADR-0013
title: Integration Control Plane state, persistence, and telemetry architecture
status: proposed
date: 2026-04-23
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-18
supersedes:
superseded_by:
revisit_trigger: Revisit when (a) the MVP dispatcher is running end-to-end and Perplexity cannot answer one of the named visibility questions against repo-committed run reports, (b) a second caller (scheduler, second harness, or service surface) needs run-registry reads that Markdown + JSON grep cannot serve, (c) run-report volume makes the conventional `runs/` directory unreadable during review (order of magnitude: hundreds of runs per week), (d) a telemetry backend ADR is opened, or (e) run-report files need to carry secrets or PII that cannot live in the repo.
---

# ADR-0013: Integration Control Plane state, persistence, and telemetry architecture

## Context

ADR-0012 fixed the Integration Control Plane (ICP) software architecture: a skill framework (contract, registry, runner) over a small set of shared components, with a first-slice skill (`dispatch-ticket@0.1.0`) that must produce an ADR-0006 run report and an ADR-0003 five-element Linear write-back. ADR-0012's *run recorder* component names the write interface but not the durable destination: "for the pilot, 'persist' means write a Markdown + JSON run report file into the repo at a conventional path."

ADR-0003 set the Linear persistence boundary and deferred the telemetry substrate. ADR-0006 fixed the run-report schema and deferred the backend. This ADR closes the remaining decision surface that implementation tickets have to re-derive otherwise: **where durable run-registry state lives for the MVP, which query surfaces the ICP must support at that point, and what is deferred to a future telemetry backend versus what must exist now.**

This is a decision ticket, not an implementation ticket. It names the destinations, the query surfaces, and the retention / migration expectations. It does not build a telemetry service, quantify cost bands, or specify a production observability stack — all of those are out of scope per the LAT-18 non-goals.

The underlying tension: the user wants observability "badly, but not prematurely over-engineered." The pilot has one operator, no concurrent runs, no cross-run coordination requirement, and no telemetry substrate. The MVP dispatcher does not yet exist. A database or telemetry service on day one would violate ADR-0008's anti-astronautics guardrail; no persistence story at all would make "what happened in this run?" unanswerable the first time a run goes wrong.

## Decision Drivers

- **Skill-framework-first (ADR-0012).** The run registry is the runtime tail of a skill invocation, not a database schema in search of a skill. Whatever persistence the MVP chooses must keep skills, the evidence contract, and the ADR-0006 envelope as the primary artefacts; any query surface is derived from those.
- **Four substrates, one per job (ADR-0001, ADR-0003).** Linear is the operational work graph, GitHub is the durable source of truth, Perplexity is cognition, and the ICP is the owned operational layer. A new persistence destination must not duplicate any of those; it must name exactly the responsibility the other three cannot own.
- **Explicit destinations per run lifecycle event (acceptance criterion).** When a run starts, finishes, or fails, the destination for that state must be named in one place so implementation does not guess.
- **Visibility question answerability (ADR-0006, LAT-18 acceptance criterion).** Perplexity must be able to answer the five ADR-0006 visibility questions from whatever the MVP persists. If it cannot, the envelope or the persistence destination is wrong — not the question.
- **No production telemetry stack before the MVP dispatcher exists (LAT-18 non-goal).** Whatever is chosen must be trivially removable and replaceable when a telemetry backend ADR lands. It must not lock any other component into a schema it would not otherwise choose.
- **Retention and migration without overbuild.** The MVP must state how long run state lives, where it can be deleted from, and how it will move to a future substrate. "Forever in git" is a legitimate answer; "we will figure it out later" is not.
- **Reversibility.** Whatever is chosen must be replaceable by the run recorder's persist step changing, per ADR-0006's forward-compatibility contract and ADR-0012's component boundary — no skill, no adapter, no harness changes.
- **Deterministic operational state owned by ICP (ADR-0008, ADR-0012).** Linear comments, PR descriptions, and GitHub history are derived projections. The ICP must own at least one durable artefact per run that is not a projection — otherwise the dispatch path is not auditable end-to-end.
- **Perplexity visibility scope clarity (LAT-18 acceptance criterion).** For any visibility question, readers must be able to tell which of Linear, GitHub, ICP persistence, or future telemetry the answer should come from. Ambiguity here is the single most common source of process drift.

## Considered Options

1. **Linear-only.** Treat the Linear write-back comment as the run record; no ICP-owned artefact. Rejected: contradicts ADR-0003 (Linear is not the trace store), contradicts ADR-0006 (Linear receives a bounded projection of the envelope, not the envelope), and makes the dispatch path non-auditable the moment a run fails before it can post a comment. Also fails the LAT-18 acceptance criterion that a failed run has an explicit durable destination — a run that crashed before write-back has no Linear presence at all.

2. **SQLite-in-repo from day one.** Run recorder writes rows into a committed SQLite file; queries are SQL. Rejected for the MVP. It is more scaffolding than the pilot needs (schema migrations, row-level merge conflicts on a binary file, contributor tooling for a query surface that Perplexity + `grep` already serve at pilot volume). It also pre-commits the envelope to relational shape before we have real cross-run questions — Perplexity can answer the ADR-0006 questions today against Markdown + JSON files, and promoting to SQL before then risks modelling the wrong things. Kept available as a migration target in "intentionally deferred."

3. **SQLite-or-Postgres out of repo.** ICP maintains its own database for run state; repo holds only summaries. Rejected: introduces a deployment surface (a database to run, back up, and connect to) that contradicts ADR-0008's "skills and adapters, not a service" guardrail and LAT-18's explicit non-goal of building a telemetry backend in this ticket. A database decision that does not unblock a pilot slice is premature.

4. **Repo-committed Markdown + JSON run reports under `runs/`, Linear holds the five-element write-back, GitHub holds everything else — ICP persistence is the `runs/` tree and nothing else for the MVP.** Accepted. Each run emits exactly one Markdown + JSON file per `run_id` into a conventional `runs/` directory in this repo. The Markdown is the human-readable face of the ADR-0006 envelope (already defined by `docs/templates/agent-run-report.md`); the JSON sidecar is the same envelope in machine-readable form so Perplexity (and `grep` / `jq`) can answer the ADR-0006 visibility questions across runs without bespoke tooling. The Linear comment is the five-element projection per ADR-0003 / ADR-0006. Nothing else is in the ICP's persistence story for the MVP.

5. **Per-ticket co-located run reports.** Write the run report into the ticket's PR branch or into a directory named after `linear_issue_id`. Rejected: makes cross-run queries (ADR-0006 questions 3, 4, 5) expensive because run reports are scattered across branches or nested trees, and it loses the property that the run report is independently committable before a PR exists (e.g. when a run fails before opening a PR, or for read-only skills that produce no PR at all).

6. **Future telemetry backend now.** Pick Langfuse / Helicone / OpenTelemetry / a custom substrate and wire the run recorder to it. Rejected by LAT-18 non-goals.

## Decision

**Accepted: Option 4 — repo-committed Markdown + JSON run reports under a conventional `runs/` directory as the ICP's sole durable run-registry destination for the MVP.**

The destinations per surface are:

- **Linear** — operational work graph, human review surface. Per ADR-0003, holds the five-element write-back comment linked to the run report URL, plus issue state / labels / native relations. It is *not* the run registry.
- **GitHub (this repo)** — durable source of truth. Holds code, docs, ADRs, PRDs, templates, PR history, *and* the run-registry tree (`runs/` directory of Markdown + JSON per-run files). Each run report is a normal committed artefact, versioned and reviewable in the same way as any other repo file.
- **ICP persistence (deterministic operational state)** — the repo-committed `runs/` tree, produced by the run recorder component (ADR-0012). The ICP does not own any other durable store for the MVP. Ephemeral in-process state (a skill runner's working state during a single invocation) is not persisted and does not need to be.
- **Future telemetry** — deferred to a follow-up ADR. When it lands, only the run recorder's persist step changes: it begins writing the same ADR-0006 envelope into the telemetry substrate instead of (or in addition to) the repo. Everything that currently reads `runs/*.json` will, at migration time, read from the substrate's query surface. No skill, no adapter, no harness, and no envelope field changes.

### The `runs/` tree (MVP run-registry destination)

**Location:** `runs/` at the repo root. One file pair per run, named by `run_id`:

- `runs/<run_id>.md` — the human-readable run report, produced from `docs/templates/agent-run-report.md`.
- `runs/<run_id>.json` — the same ADR-0006 envelope in machine-readable form (strict JSON — not JSON5, not YAML — so `jq` and Perplexity can read it without tolerant parsing).

A run report file is the smallest independently-committable unit of run state. Grouping or indexing is deferred to the telemetry backend; for pilot volume, directory listing plus `grep` / `jq` is enough. The exact `run_id` format is not fixed here — ULID, UUIDv7, or a timestamp-prefixed slug are all acceptable — but it must be lexicographically sortable by creation time so `ls runs/ | tail -n <k>` is equivalent to "the k most recent runs" without a database.

**What the file captures (the run envelope):** exactly ADR-0006's required core fields plus every strongly-recommended field the slice can populate. The Markdown and JSON must be mechanically derivable from the same envelope object. If they disagree, the JSON wins (it is the machine-readable form), and the divergence is a defect the run recorder must fix before returning.

**Who writes it:** the run recorder component (ADR-0012), called by the skill runner on every skill invocation that has side effects. Read-only skills (per ADR-0012) emit a lighter structured log line, not a full run report; when a read-only skill does produce an envelope, it is optional and uses the same `runs/` convention.

**Who reads it:**

- Perplexity, for the ADR-0006 visibility questions (see below).
- The write-back formatter component (ADR-0012), to render the Linear comment.
- A human reviewer inspecting a single run.
- A future telemetry ingester, at migration time.

**What it never contains:** secrets, tokens, prompts or responses containing user-identifying PII, or full raw model traces. Secrets are a release-blocker (the repo is the source of truth — anything committed is effectively published). Prompt/response transcripts belong in the future telemetry substrate; until it exists, the `input_artifacts` and `output_artifacts` fields hold URLs or repo-relative paths rather than inlined content.

### Run lifecycle destinations (LAT-18 acceptance criterion)

For every agent run — regardless of skill, agent type, or autonomy level — the destinations are:

- **On start.** The run recorder writes the initial run report with `status: started`, `run_id`, `agent_type`, `linear_issue_id` (if known), `triggered_by`, `autonomy_level`, `started_at`, and any `correlation` fields resolvable at start (`parent_run_id`, `session_id`). The file exists in `runs/` from the moment the skill runner begins the invocation. No Linear comment is posted on start; the human signal at start is the skill runner's structured return, not a Linear write.
- **On finish (success).** The run recorder updates the same file in place: `status: succeeded`, `ended_at`, `summary`, `output_artifacts`, `correlation.pr_url` and `correlation.commit_sha` (if applicable), and the `decisions`, `next_actions`, and `cost` fields as populated. The skill runner then invokes the write-back formatter, which posts the ADR-0003 five-element comment to Linear; the `Evidence` line of that comment carries the `runs/<run_id>.md` URL.
- **On failure.** The run recorder updates the file to `status: failed`, `ended_at`, `errors`, and whatever `cost` and `correlation` fields were populated before the failure. The write-back formatter still posts to Linear — a failed run gets a five-element comment exactly as a successful run does, with `Outcome` describing the failure, `Risks` carrying any elevated flags, and `Next action` pointing at the intervention required. A run that fails before any Linear context is known (e.g. malformed `linear_issue_id`) still produces a `runs/<run_id>.{md,json}` file; the Linear write-back is skipped only when there is no issue to write to, and that fact is itself recorded in the run report's `errors` field.
- **On `needs_human` / `blocked` / `stop`.** Treated as a finish. The run report carries the structured status, the policy evaluator's reason list goes into `decisions`, and the write-back formatter posts the five-element comment with `Open questions` populated from the reason list.
- **Cancelled.** Same shape as failure but with `status: cancelled`. If the ICP process itself dies mid-run (e.g. SIGKILL), the file is left in its last-written `status: started` state; a follow-up skill run or a manual sweep may close it out. This is an explicit imperfection accepted for the pilot (see "bad / open").

Committing `runs/` files: run reports are committed alongside the work they document. For dispatch-class skills, the convention is that the run report is committed to the skill's own working branch (or `main` for operator-run dry-runs), so the run report URL in the Linear write-back resolves against a real commit. The exact commit cadence — one commit per run, one commit per batch, or folded into the agent's implementation commit — is a follow-up implementation choice, not an architectural one; any choice that satisfies "the URL in the Linear write-back is resolvable at the time the comment is posted" is acceptable.

### Observability query surfaces the ICP must support for the MVP

The `runs/` tree must be sufficient to answer the following without custom code (derived directly from ADR-0006's five visibility questions; LAT-18 acceptance criterion about required query surfaces):

1. **Run status — what is this specific run doing?** Single-file read of `runs/<run_id>.md` (or `.json`). Answerable by: reviewer, Perplexity, the future telemetry UI.
2. **What are agents currently doing?** List recent `runs/*.json` sorted by `run_id` (lexicographic) or `started_at`; project `agent_type`, `linear_issue_id`, `status`, `summary`. Answerable by: `ls runs/ | tail -n 20 | ...`, Perplexity reading the same window.
3. **What is blocked, and on what?** Filter runs with `status ∈ {needs_human, blocked, stopped, failed}`; join with open Linear issues by `linear_issue_id`. Answerable by: Perplexity over the `runs/` tree plus Linear; no ICP-side index required.
4. **Which runs are costly, and why?** Filter runs with `cost_band != normal` or `risk_level = high`; segment by `agent_type` and `agent_metadata.model`; sort by `cost.spent_usd`. Answerable by: `jq` over `runs/*.json` (pilot volume) or Perplexity. If pilot volume outgrows this, the trigger is to promote `runs/` into an indexable store, not to re-derive the schema.
5. **Where are agents failing repeatedly?** Group `status = failed` runs by `agent_type` and by `correlation.pr_branch` or `linear_issue_id`; identify retry loops. Same mechanism as 4.
6. **Evidence lookup.** Given a Linear write-back, resolve the run report URL it cites and follow `correlation.pr_url` to GitHub. Answerable by following the link — the five-element write-back's `Evidence` line carries this.
7. **PR ↔ run linkage.** Given a PR, find the run that produced it by scanning `runs/*.json` for `correlation.pr_url` matches. Pilot volume: one pass is cheap. Post-pilot: indexed by the telemetry substrate.
8. **Failure patterns over time window.** Runs filtered by `started_at` within window, grouped by `status` and `agent_type`. Feeds the retrospective learning loop (ADR-0010). Pilot volume: Perplexity reading the window.

Any visibility question that cannot be answered from the `runs/` tree plus Linear plus GitHub is either:

- A **schema gap** — add a field via ADR-0006's open sub-objects (non-breaking), or open an ADR for a top-level change.
- A **substrate gap** — the trigger to open the telemetry backend ADR. The gap itself becomes a driver for that ADR; it does not get patched by inventing a side-channel in the MVP.

This is the LAT-18 acceptance criterion that "when a Perplexity visibility question is asked, the architecture states where the answer should come from." The routing is: read `runs/*.{md,json}` for anything run-centric; read Linear for work-graph state; read GitHub for code / PR / doc state; raise a schema or substrate gap for anything else.

### What lives where (reference matrix)

| State / question | Linear | GitHub (`docs/`, code, PRs) | ICP (`runs/` tree) | Future telemetry |
|---|---|---|---|---|
| Issue status, labels, native relations | canonical | — | — | — |
| Write-back summary per run (5 elements) | canonical | — | mirrored from envelope | — |
| ADRs, process docs, PRDs, templates | link only | canonical | — | — |
| Code, PRs, commit history | link only | canonical | — | — |
| Run start / finish / failure envelope | — | hosts the `runs/` tree | **canonical for MVP** | canonical post-substrate |
| Cost / risk metadata per run | — | — | **canonical for MVP** (`cost.*`, `risk_level`) | canonical post-substrate |
| Evidence links (PR URL, artifacts) | mirrored in write-back | hosts the PR | **canonical for MVP** (`correlation.*`, `output_artifacts`) | canonical post-substrate |
| Failure patterns, retry loops, cross-run aggregates | — | — | **queryable for MVP** via `jq` / Perplexity over `runs/` | canonical post-substrate |
| Full model/tool traces, prompt/response bodies | — | — | **not captured in MVP** | **canonical when substrate exists** |
| Live run progress (step-by-step) | — | — | **not captured in MVP** (only start/finish states) | **canonical when substrate exists** |
| Dashboards, cross-run segmentation UI | — | — | **not supported in MVP** (grep / Perplexity only) | **canonical when substrate exists** |
| Secrets, credentials | — | never | never | substrate-governed |

The "canonical" column is where the answer is authoritative; other columns may mirror but must never diverge.

### Retention and migration

- **Retention in the MVP: indefinite.** Run reports live in the repo for as long as the repo does. Because the repo is the source of truth, deleting a run report is a destructive ADR-worthy act, not a routine operation. The expected failure mode is "the `runs/` tree gets noisy," not "we run out of space." If noise dominates, the follow-up is to promote to a telemetry substrate, not to prune the tree.
- **PII / secret redaction on write.** The run recorder is the choke point for what enters `runs/`. Its responsibility includes refusing to write known-sensitive fields (raw credentials, prompt bodies containing PII). Any redaction rule is applied at write time; the committed file must be safe to publish. If in doubt, do not write the field — the envelope's open sub-objects tolerate missing keys by contract (ADR-0006).
- **Rotating out: migration to a telemetry substrate.** When the telemetry backend ADR lands, the migration is:
  1. The substrate ingests the existing `runs/*.json` files (bulk import of the historical envelope). Because the envelope is the same object, ingest is schema-preserving.
  2. The run recorder's persist step is edited to write to the substrate. No skill, no adapter, no write-back formatter, no harness, and no envelope field changes. ADR-0012's boundary is what makes this a single-component change.
  3. `runs/` may continue to be written as a mirror, or be frozen, or be garbage-collected by policy — the migration ADR decides. This ADR does not pre-decide; the only invariant is that Linear write-back URLs that pointed at `runs/<run_id>.md` remain resolvable (typically by leaving the tree in place).
- **Renames and schema evolution in the interim.** Adding a field to the envelope is non-breaking (ADR-0006 open sub-object rule). Renaming or removing a field requires a new ADR, exactly as ADR-0006 specifies; this ADR inherits that rule and does not relax it.

### Perplexity visibility scope (LAT-18 acceptance criterion)

For a Perplexity visibility question, the ICP answer is:

- **"Reads from `runs/*.{md,json}`"** — for anything about a specific run, cost, risk, evidence link, PR correlation, failure pattern, or cross-run aggregate over pilot volume. Any of the eight query surfaces above.
- **"Reads from Linear"** — for anything about work-graph state: open issues, sequencing, native relations, write-back comment history.
- **"Reads from GitHub"** — for anything about code, PR state, PR description, doc content, ADR content.
- **"Requires the future telemetry substrate"** — for full model/tool traces, prompt/response bodies, live-progress views, dashboards, and cross-run aggregates at a scale the `runs/` tree cannot serve. Until the substrate lands, the ICP cannot answer these and says so explicitly.

This maps every visibility question to exactly one of Linear, GitHub, ICP persistence, or future telemetry — satisfying LAT-18's requirement that the architecture state where the answer comes from.

### What is intentionally deferred

Listed here so future tickets do not re-discover scope.

- **Telemetry backend selection.** ADR-0003 / ADR-0006 / ADR-0012 defer. This ADR does not pick one. When opened, it inherits the LAT-18 migration plan above.
- **Indexed queries over `runs/`.** An index (SQLite mirror, FTS, a generated `runs/index.json`) is deferred. If pilot volume outgrows grep / jq / Perplexity, the trigger is the telemetry backend ADR or a narrow index ticket — not a schema change.
- **Run-progress events.** The MVP captures start / finish / failure / terminal-status transitions, not step-level events. Full trace capture is a telemetry-substrate concern.
- **Quantitative cost bands.** ADR-0008 open question 3. The envelope carries `cost.band` as a qualitative signal; the MVP does not quantify the bands.
- **Dashboards, alerting, metrics collection, SLOs.** Out of scope for the MVP per LAT-18 non-goals. A telemetry backend ADR is the prerequisite.
- **Secret / credential store.** ADR-0008 open question 4. This ADR specifies only that secrets do not enter `runs/`.
- **Cross-repo run registry.** The MVP registry is scoped to this repo. Cross-repo coordination is out of scope.
- **Run-report garbage collection, archival, or redaction after the fact.** Deferred to the telemetry substrate ADR. Until then, the `runs/` tree grows monotonically and is not trimmed.
- **Indexed `runs/` navigation UI.** Not in the MVP. Perplexity, `grep`, `jq`, and GitHub's file viewer are sufficient.
- **Parent/child or correlated-run views.** The envelope already carries `correlation.parent_run_id`, `correlation.trace_id`, and `correlation.session_id`. The ICP captures them per ADR-0006; rendering them into a hierarchy is a telemetry-substrate concern.

### MVP-in vs MVP-out (acceptance criterion)

In the MVP for state / persistence / telemetry:

- Exactly one durable destination owned by the ICP: `runs/<run_id>.{md,json}`.
- Exactly the ADR-0006 envelope, no fork.
- Exactly the three lifecycle transitions recorded: start, finish, failure (plus terminal statuses `needs_human`, `blocked`, `cancelled`).
- Exactly the query surfaces listed above, served by Perplexity / grep / jq over the `runs/` tree plus Linear plus GitHub.

Out of the MVP:

- Any database, queue, or service for run state.
- Any telemetry backend, dashboard, metric, or alerting surface.
- Any schema change to ADR-0006 beyond open sub-object additions.
- Any persistence surface in the ICP other than `runs/`.
- Any run-registry read path other than "file-on-disk" and "the Linear write-back URL."

Requests to add persistence or observability complexity are answered by pointing here. Changing this requires a new ADR.

## Consequences

Good:

- Every run has an explicit durable destination — one file pair in `runs/` — from the moment the skill runner starts it. A failed run that never reaches Linear still leaves a trace.
- Perplexity can answer the ADR-0006 visibility questions against the `runs/` tree plus Linear plus GitHub, with no custom tooling, at pilot volume.
- No database, queue, or service is introduced. The pilot remains inside ADR-0008's "skills and adapters, not a service" guardrail.
- The envelope and the persistence destination are decoupled: when the telemetry backend ADR lands, only the run recorder's persist step changes. ADR-0012's component boundary is what makes this safe.
- The "where does the answer come from" routing (Linear / GitHub / `runs/` / future telemetry) is short enough that humans and Perplexity both cite it without re-deriving.
- `runs/*.json` as a committed artefact means the evidence chain (Linear comment → run report → PR) is reviewable in the same way any other repo change is reviewable.
- Retention is trivial: indefinite until the substrate lands. No migration is needed for the MVP itself to work; the migration plan is named but does not gate shipping.

Bad / open:

- The `runs/` tree grows monotonically. At some point it becomes noisy (the revisit trigger notes "order of magnitude: hundreds of runs per week"). That is the signal to open the telemetry backend ADR, not to add pruning.
- Committing run reports produces PR noise on every run. Pilot volume absorbs this; if it bites, the follow-up is to fold run-report commits into the agent's implementation commit for dispatch-class runs, which is an implementation convention, not an architectural change.
- A run killed mid-flight (SIGKILL, crash) leaves a `status: started` file until a sweep closes it. The MVP accepts this imperfection; a telemetry substrate would close it with a heartbeat.
- `grep` / `jq` over JSON files is not a query engine. Filter-join-aggregate over many runs at once will be awkward before it is impossible. The visibility questions were chosen so pilot volume is fine; the substrate is the answer when it is not.
- Two artefacts per run (`.md` + `.json`) risks divergence if the run recorder is buggy. This ADR states the JSON is authoritative; the run recorder must round-trip-generate the Markdown from the same object.
- The five-element Linear write-back is the only place a human sees a run without opening the repo. If the write-back fails to post (Linear outage, malformed issue ID), the run is visible in `runs/` but invisible in the work graph until a human sweep. Acceptable for pilot; a retry-or-queue behaviour is a telemetry-substrate concern.
- This ADR does not address how `runs/` interacts with branch protection or required reviewers. An implementation ticket for the run recorder must confirm that the branch into which run reports are committed does not require human review for each agent-committed file.

## Open Questions

1. Exact commit cadence for `runs/` files during dispatch-class skill runs (per-run commit, per-batch commit, folded into the agent's implementation commit). Leaning "folded into the agent's work when a PR is opened; separate commit when no PR exists." Resolved by the run recorder implementation ticket.
2. `run_id` format (ULID vs UUIDv7 vs timestamp-prefixed slug). Any of these satisfies the "lexicographically sortable by creation time" requirement; pilot preference is ULID for human-skimmability. Resolved by the run recorder implementation ticket.
3. Whether the JSON sidecar lives next to the Markdown (`runs/<run_id>.json`) or in a parallel tree (`runs/json/<run_id>.json`). Leaning co-located; revisit if GitHub's Markdown rendering of a directory with mixed file types becomes noisy.
4. Whether read-only skills (per ADR-0012) emit a `runs/` file at all, or only a structured log line. Pilot preference: no file unless the read-only skill has evidence to record (e.g. a dry-run dispatch); otherwise the CLI's structured output is sufficient and avoids growing the tree with empty artefacts.
5. How the run recorder handles concurrent writes to the same `run_id` (nominally impossible, but a crash-recovery sweep could retry). Pilot: last-writer-wins on the file; the envelope's `ended_at` and `status` should make divergence detectable in review.
6. Whether the future telemetry substrate mirrors `runs/` or supersedes it. This ADR keeps the mirror option open (the `runs/` URL in a historical Linear write-back must remain resolvable); the substrate ADR chooses when it lands.
7. Whether cost-band and risk-level signals should also be mirrored into Linear labels (for triage filtering in the Linear UI). Not decided here; ADR-0008's cost-band follow-up is the right home.
8. Whether a generated index (`runs/index.json`, regenerated on commit) is worth adding before the telemetry substrate, to speed Perplexity's "recent runs" reads. Deferred; the `ls | tail` path is good enough until it demonstrably is not.

## Confirmation

Working if, after the first-slice dispatch skill (ADR-0012) has run end-to-end a handful of times:

- Every dispatched run has exactly one `runs/<run_id>.md` and one `runs/<run_id>.json` file, and each Linear write-back's `Evidence` line resolves to that Markdown URL.
- A run that fails before posting to Linear still has a `runs/<run_id>.{md,json}` pair with `status: failed` and a populated `errors` field.
- Perplexity can answer each of the eight query surfaces above by reading `runs/*.{md,json}` plus Linear plus GitHub, without any new ICP tooling.
- No skill, adapter, harness, or envelope field has moved to accommodate persistence; only the run recorder writes into `runs/`.
- No database, queue, or service has been introduced into the ICP for the MVP.
- When a visibility question is asked that the `runs/` tree cannot answer, the response is either "add a field via ADR-0006's open sub-objects" or "this is the trigger for the telemetry backend ADR," not an ad-hoc side-channel.
- `runs/` contains no secrets, no raw credentials, and no inlined prompt/response bodies.

Revisit if any of those stops being true, or if the revisit trigger in the frontmatter fires.

## Links

- Linear: `LAT-18` (this ADR). Related context: `LAT-5` (run-visibility schema), `LAT-6` (cost controls), `LAT-8`, `LAT-9` (Linear persistence), `LAT-16` (ICP / Perplexity boundary), `LAT-19` (ICP software architecture), `LAT-20` (ICP language/runtime), `LAT-22` (ICP terminology propagation).
- Related ADRs: `0001-use-perplexity-linear-and-github-as-control-plane.md`, `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-run-visibility-schema.md`, `0007-qa-review-evidence-workflow.md`, `0008-agent-control-layer-and-perplexity-boundary.md`, `0010-retrospective-learning-loop.md`, `0011-integration-control-plane-language-and-runtime.md`, `0012-integration-control-plane-software-architecture.md`.
- Template: `docs/templates/agent-run-report.md` (canonical envelope form; this ADR locates the written form in `runs/`).
- Deferred to follow-ups: telemetry backend ADR (tracked under ADR-0003 open question 1 and ADR-0006's revisit trigger); quantitative cost bands (ADR-0008 open question 3); credential management (ADR-0008 open question 4).
