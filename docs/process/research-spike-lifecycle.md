# Research spike lifecycle

Bounded research spikes are a first-class workflow in the Agentic Development Flywheel. A spike is a **time- and cost-bounded investigation whose output is structured findings**, not a shipped change. This doc defines how a spike enters from triage, what bounds it must carry, what it must emit, and how its findings graduate into PRDs, ADRs, or planned implementation work — without ever silently turning into shipped code.

This is a **policy doc**, not an automation specification. It defines the contract any research-spike agent or skill must conform to. The companion run-envelope is `agent_type: research` in the agent-run-report schema (ADR-0006); the cost rules are ADR-0009 / `cost-controls.md`; the autonomy rules are ADR-0008 / `approval-gates-and-autonomy-rules.md`. If this doc and any of those disagree, the ADR wins and this doc is updated in the same PR that flagged the conflict.

## Why bounded spikes are first-class

Two failure modes this lifecycle is designed to prevent:

1. **Unbounded research.** A "go look into X" prompt with no timebox, source policy, or stop conditions tends to expand until it consumes the budget cap or stalls in a loop. ADR-0009's runaway-cost interrupt catches the budget tail; this doc catches the rest.
2. **Silent graduation to implementation.** A research finding that quietly turns into a PR, a refactor, or an architectural commitment skips Ben's approval gates. Spikes must terminate with structured findings and an explicit graduation decision; they must not auto-cut tickets that ship code.

The lifecycle is: **triage → spike intake → bounded run → findings → graduation decision → durable artifact (PRD / ADR / `LAT-*` ticket) or archive**, with surface-back checkpoints to Ben at the gates that matter.

## Where a spike comes from

A spike is created by triage when the intake item is classified `Action class: Research task` (see `intake-triage.md` → *Action classes*) **or** when a more specific action class is blocked on an unresolved investigative question — for example, an `ADR candidate` whose decision cannot be made without a comparison of options, or a `PRD candidate` whose scope cannot be bounded without a feasibility check.

Triage does not run the spike. Triage emits a **spike intake packet** (defined below) and routes to a research agent at the autonomy level permitted by ADR-0008. The packet is the contract; if any required field is missing, the dispatcher refuses to start the run, the same way the agent-ready ticket pre-flight refuses under-specified coding work.

## Spike intake contract

Every spike, regardless of origin, must enter with this packet. Fields are required unless marked optional. Triage produces it; the dispatcher validates it; the research agent reads it.

```md
## Spike Intake

Spike ID: <Linear LAT-* key for the spike issue, OR "draft://<slug>" if not yet ticketed>
Origin: <triage source + URL/thread reference; mirror Source from the triage output>
Goal: <one sentence, in the form "decide whether X / quantify Y / characterize Z" — not "look into X">
Decision-this-feeds: <the named decision the findings exist to inform; e.g. "ADR-NNNN candidate: pick stream substrate", "LAT-NN PRD scope", "go/no-go on tool X">
Timebox: <wall-clock cap, e.g. "≤90 min", or step cap if wall-clock is not a meaningful axis>
Budget cap: <numeric cap with units, e.g. "$5", "200k tokens"; required even at pilot scale where no $ is enforced — see cost-controls.md>
Cost class: <normal | elevated-allowed | runaway-stop> (default normal; elevated-allowed only with prior Ben approval)
Sources allowed: <enumerated; e.g. "this repo", "linked Linear issues", "Perplexity search", "vendor docs at <domain>"; default deny anything not listed>
Sources forbidden: <explicit denylist when relevant; e.g. "no production data", "no paid APIs", "no deep recursive crawl">
Stop conditions: <ordered list of conditions that end the spike — see "Stop conditions" below>
Escalation criteria: <conditions that surface back to Ben mid-run rather than continuing — see "Escalation criteria" below>
Out-of-scope: <what the spike must NOT investigate or decide; load-bearing, mirrors PRD non-goals>
Acceptable confidence floor: <low | medium | high; the minimum confidence the recommendation must reach for graduation>
Approval to start: <pilot default per ADR-0008; record explicit Ben approval if cost class is elevated-allowed>
```

Notes:

- **Goal must name a decision.** "Investigate streaming options" is not a goal; "Decide whether the run report stream substrate should be Postgres LISTEN, Redis Streams, or NATS" is. A spike with no named downstream decision is not a spike — it is browsing, and triage should have classified it `Archive`.
- **Decision-this-feeds is load-bearing.** It is the link between the spike and the artifact the findings will eventually graduate into. If unset, the spike cannot graduate cleanly because there is nowhere for it to go.
- **Sources allowed is allow-list, not advisory.** Default-deny on sources keeps spikes auditable and cost-bounded. New sources discovered mid-run require an explicit amendment comment on the spike's Linear issue, not a silent expansion.

## Required bounds

A spike without all five bounds is unbounded research, not a spike. The dispatcher must refuse to start a run if any are missing.

1. **Goal** — a single, decision-shaped sentence (see above).
2. **Timebox** — wall-clock or step-count cap. Wall-clock is preferred when the agent runs on a host that meaningfully tracks it; step count is acceptable when wall-clock is fuzzy.
3. **Cost / usage band** — `Budget cap` plus `Cost class`. Feeds directly into the runaway-cost interrupt: a spike that crosses its `Budget cap` halts under ADR-0009, same as any other run.
4. **Sources allowed** — explicit list. Anything not listed is denied unless the agent stops and asks.
5. **Stop conditions** — ordered, agent-readable, evaluated at every loop boundary. See below.

These bounds are mirrored into the spike's `LAT-*` issue's `## Sequencing` block where applicable, and into the `cost.budget_cap_usd` field of the run report.

### Stop conditions

A spike must enumerate, in order, the conditions that end the run successfully or unsuccessfully. The agent evaluates these at each loop boundary; the first matching condition wins. At minimum the list must cover:

- **Goal-met** — the named decision can now be made at or above the `Acceptable confidence floor`.
- **Inconclusive-with-evidence** — the timebox or budget cap is reached and the agent has structured findings but cannot reach the confidence floor. This is a valid terminal state; it is not a failure.
- **Blocked-on-input** — the spike cannot proceed without information only Ben (or another human) can provide. Halt and surface; do not guess.
- **Out-of-bounds** — the spike's next useful step would require a source not on the allow-list, a budget raise, or a goal change. Halt and surface; do not silently widen scope.
- **Runaway-cost** — any ADR-0009 trigger fires. Halt under the runaway-cost interrupt protocol; this overrides every other stop condition.

Ad-hoc spike-specific stop conditions are allowed (e.g. "stop after 5 candidate options compared"); they layer on top of the minimum.

### Escalation criteria

Independent of stop conditions, the spike must surface mid-run to Ben when any of:

- A finding contradicts an active ADR, an approved PRD, or a recent dispatch decision.
- A finding implies an architecturally significant decision was already silently made elsewhere in the work graph.
- The cheapest path to the goal requires a paid external service not on the allow-list.
- The agent's confidence in the goal-feeding decision drops below `low` after material evidence is gathered (i.e. the question itself is wrong).

Mid-run escalation is **stop-and-ask**, not "note in the writeup". The spike halts, posts a Linear comment, and waits.

## Spike outputs

Every spike emits a **spike findings report** as its primary artifact, in addition to the standard `agent_type: research` run report (ADR-0006). The findings report is the durable input to the graduation decision.

```md
## Spike Findings

Spike ID: <mirror from intake>
Goal: <mirror from intake>
Decision-this-feeds: <mirror from intake>
Status: <goal-met | inconclusive-with-evidence | blocked-on-input | out-of-bounds | halted-runaway-cost>
Confidence: <low | medium | high; required>
Confidence rationale: <one or two sentences; what evidence justifies this level>

Findings: <ordered list; each item is a single observation supported by at least one citation>
  1. <finding> — <citation reference, e.g. "[S1]", "[S2]">
  2. ...

Sources / citations: <numbered list; URLs, file paths, or Linear/PR references; one per source actually consulted>
  [S1] <ref>
  [S2] <ref>
  ...

Options considered: <each option = label, one-line summary, key trade-offs, and a "graduation hint": PRD | ADR | ticket | none>
  - Option A — ...
  - Option B — ...

Recommendation: <single named option, OR "no recommendation; see Open questions"; required>
Recommendation-rationale: <≤3 sentences; why this option, citing findings>

Open questions: <unresolved items that block higher confidence; one per line>
Risks: <product, cost, security, reversibility; mirror the severity ladder in operating-model.md>
Graduation proposal: <PRD-needed | ADR-needed | direct-backlog-refinement | blocked-on-human | no-action-archive; see "Graduation rules">
```

Rules:

- **Every finding cites a source.** Uncited claims are not findings; they are guesses. A spike that produces no citations is `inconclusive-with-evidence` at best, regardless of how confident the prose feels.
- **`Confidence` is required.** A missing confidence is a contract violation, the same way a missing `cost.band` is on a run report.
- **`Recommendation` may be "no recommendation".** Triage and downstream readers handle that case explicitly. A vague "more work needed" is not a recommendation.
- **The findings report is durable.** It is committed to the spike's PR (when one exists for traceability), linked from the Linear write-back, and survives the run. Threads and chat transcripts are not the artifact.

## Graduation rules

When the spike terminates, triage (or the spike's review pass) chooses exactly one graduation path. Paths are mutually exclusive at the spike level; a spike does not graduate to two destinations at once. If two destinations seem warranted, the spike has produced two findings packets and should be split.

| Path | When to use | Surface-back to Ben | Resulting artifact |
|---|---|---|---|
| **PRD-needed** | Findings reveal an outcome large enough that a Linear ticket cannot scope it without losing coherence. The downstream decision is "what should we build". | **Yes** — Ben approves the PRD-creation step before any feature PRD file is opened in `docs/prds/`. Agents may draft in-thread; durable creation requires approval. | New feature PRD `LAT-NN-<slug>.md` per `docs/prds/README.md`, derived from the root PRD. |
| **ADR-needed** | Findings imply an architecturally significant decision per `docs/decisions/README.md` → *When to write an ADR*. The downstream decision is "what should we commit to architecturally". | **Yes** — ADR drafts are at agent autonomy level per ADR-0008, but acceptance requires Ben. The graduation step opens an ADR draft (`status: proposed`) at the next free `NNNN-`. | New ADR `NNNN-<slug>.md` in `docs/decisions/`, status `proposed`. |
| **Direct backlog refinement** | The decision is small, reversible, and ticket-scoped. The findings can be folded into an existing or new `LAT-*` issue's description and `## Sequencing` block, and the ticket can pass the agent-ready pre-flight. | **No** by default — agent-created Linear issues are L2-permitted (ADR-0008) and reviewed at the next backlog-refinement pass. **Yes** if the finding raises priority, cost band, or risk level meaningfully. | Updated or new `LAT-*` issue with `needs-refinement` label unless the agent-ready pre-flight already passes. |
| **Blocked on human input** | Spike status is `blocked-on-input` or `out-of-bounds`. The findings cannot graduate without information or an approval only Ben can provide. | **Yes — always.** Halt, surface, do not auto-create downstream artifacts. | None until unblocked. The spike's Linear issue stays `Blocked` with the unblock criteria spelled out. |
| **No action / archive** | Spike status is goal-met but the recommendation is "do nothing", **or** the inconclusive evidence does not justify further investment, **or** the question itself was answered as "no" (e.g. "should we adopt X?" → "no"). | **No** by default — archive notes are valid output and don't burn Ben's time. **Yes** when the spike was Ben-initiated; he sees the decision he asked for, even if it's "no". | Spike's Linear issue closed with the findings report linked. No PRD, ADR, or new ticket. |

A spike whose graduation path is **not chosen** at termination is itself unfinished work. The dispatcher (or the next refinement pass) treats an un-graduated spike as a refusal target until a path is named, the same way it refuses an under-specified `agent-ready` ticket.

### Anti-pattern: silent graduation to implementation

A spike must **never** open an implementation PR as part of its graduation. The graduation step produces a durable artifact (PRD, ADR, ticket, or archive note) and stops. The implementation PR comes from a separate coding agent run dispatched against the resulting `LAT-*` ticket, with the ordinary agent-ready pre-flight and approval gates.

If a spike agent finds itself wanting to "just fix it while we're here", that is the escalation criterion firing — surface the finding, propose a ticket, and exit. Coding work outside the spike's stated goal is out-of-bounds.

## Surface-back to Ben — when, and what

Spikes are a high-leverage place to either over-page Ben (every finding becomes a notification) or silently absorb decisions (nothing surfaces until something has already shipped). Both fail. The lifecycle pages Ben at three specific moments and not otherwise:

1. **At spike creation, when cost class is `elevated-allowed`.** A spike that intends to spend at the elevated band requires explicit approval before the run starts. `normal`-class spikes start at agent autonomy under ADR-0008.
2. **At any escalation criterion (mid-run).** Stop-and-ask events. The Linear write-back uses the ADR-0003 five-element contract; `Risks:` line names which criterion fired.
3. **At graduation, when the path requires it.** PRD-needed and ADR-needed always surface; direct-backlog-refinement surfaces only when priority/cost/risk shifts; blocked-on-human always surfaces; no-action defaults to silent.

Routine spike progress (loop boundaries, source consumption, intermediate findings) does **not** surface. It lives in the run report and the eventual findings report. Quiet successful spikes are a feature, not a gap.

## Linear state and relationship model

Spikes are tracked as Linear `LAT-*` issues so they participate in the work graph the same way every other unit of work does. The model:

- **Issue type / label.** A spike issue carries a `research-spike` label (in addition to whatever area labels apply). The label is what dispatch and refinement passes use to find spikes.
- **State machine.** The issue's Linear state mirrors the spike status:
  - `Triage` while the intake packet is being assembled.
  - `In Progress` while the bounded run is executing.
  - `Blocked` if a stop-and-ask event halts it mid-run.
  - `Done` when graduation completes (any of the five paths, including `no-action-archive`).
  - `Cancelled` if the spike is abandoned before graduation; the cancellation comment names why.
- **Hard blockers.** A spike's `## Sequencing` block lists hard blockers per ADR-0005. A PRD or ADR cannot list a spike as a hard blocker that has been silently absorbed; it must point at the spike's `LAT-*` key.
- **Outbound relations.** When the spike graduates:
  - **PRD-needed** → the new PRD ticket lists the spike under `Hard blockers:` (the spike is `Done`) and `derived_from:` in the PRD frontmatter is unaffected (still the root PRD); the PRD body's `Prior art / research:` link points at the spike's findings report.
  - **ADR-needed** → the new ADR draft's `Context` section cites the spike findings; the ADR's frontmatter `decision_makers` includes Ben; the spike's Linear issue is referenced in the ADR's `Linear:` cross-link.
  - **Direct backlog refinement** → the resulting `LAT-*` issue lists the spike as `Recommended predecessors:` (not a hard blocker — the spike is already done by the time the ticket exists), and the ticket description links the findings report.
  - **Blocked-on-human** → no outbound relation until unblocked.
  - **No-action / archive** → no outbound relation; the spike issue is closed with findings linked.
- **Inbound relations.** A PRD, ADR, or ticket that was *generated by* a spike must link back to the spike's `LAT-*` key in its body. This is the audit trail that lets a future reader (or retro pass) trace any architectural commitment back to the bounded investigation that produced it.

## Observability fields for research runs

Every spike run populates the standard `agent_type: research` run-report envelope (ADR-0006) plus the following spike-specific fields. These live inside `agent_metadata` (where they describe the run) or `output_artifacts` (where they describe what was produced) — not as new top-level keys, per ADR-0006's forward-compatibility rule.

| Field | Where | Meaning |
|---|---|---|
| `status` | top-level `status` | `started` / `succeeded` (goal-met) / `failed` (out-of-bounds, blocked, halted) / `needs_human` (escalation fired) / `cancelled`. |
| `cost.band` | top-level `cost` | Mirrors the spike's cost-class outcome. `elevated` and `runaway_risk` surface in the Linear write-back per ADR-0003. |
| `agent_metadata.spike` | sub-object | `{ "goal": ..., "decision_feeds": ..., "timebox": ..., "cost_class": ..., "sources_allowed": [...], "stop_conditions": [...], "escalation_criteria": [...] }` — the intake packet, captured for audit. |
| `output_artifacts` | array | Each consulted source becomes an entry (URL or repo path), plus the findings report's URL/path, plus any draft PRD/ADR/ticket links produced at graduation. |
| `decisions` | array | Each finding-driven decision the spike either made (within its allowed scope) or surfaced. The graduation choice is one of these. |
| `next_actions` | array | The graduation path plus any follow-up dispatcher actions (e.g. "open ADR draft", "create LAT-NN refinement ticket"). |
| `errors` | array | Source-fetch failures, denial-of-source events, escalation triggers. Empty is fine; missing the field when an escalation fired is a contract violation. |

The observability fields are what let a retro pass (per ADR-0010) answer questions like *did spikes graduate proportionally to the work they unlocked*, *were stop conditions firing too early or too late*, and *which sources are most expensive per useful finding* — without re-deriving them from prose.

## Cost-class routing and the control loop

Spikes are dispatched at the autonomy level defined for `agent_type: research` in `approval-gates-and-autonomy-rules.md`. The cost class on the intake packet is the steering signal:

- **`normal`** — runs unattended at agent autonomy. Routes through the standard control loop. No surface-back unless an escalation criterion or stop condition fires.
- **`elevated-allowed`** — requires explicit Ben approval at spike creation. Once approved, runs unattended; a mid-run band rise to `elevated` is permitted without re-asking. A rise to `runaway_risk` halts under ADR-0009 regardless of the class.
- **`runaway-stop`** — reserved for spikes that explicitly must abort on the first cost-band rise. Useful when the question itself is "is this even cheap enough to run". Behaves like `normal` but treats `elevated` as a stop condition.

The control loop's responsibilities for spikes are:

- Validate the intake packet before dispatch; refuse if a required bound is missing.
- Enforce `Sources allowed` at the tool/connector layer where possible; emit `errors` when a denied source is requested.
- Evaluate stop conditions at every loop boundary; honor the first match.
- Halt under ADR-0009 on any runaway trigger, regardless of which spike state is active.
- Capture the spike-specific observability fields in the run report; do not require the agent to remember.

These are obligations, not implementations. The exact routing layer (today: dispatcher; tomorrow: ICP per ADR-0012) is not this doc's scope.

## What this doc is not

- **Not an automation specification.** It does not describe the research-spike skill, the dispatcher code, or the connector wiring. Those are downstream adapters per ADR-0004 and must cite this doc as their contract.
- **Not a research-quality rubric.** "Was this finding well-reasoned" is a review concern, not a lifecycle concern. The lifecycle ensures the finding is bounded, cited, and graduates explicitly; whether it is *correct* is judged by whoever consumes it (PRD reviewer, ADR decision-maker, or the next refinement pass).
- **Not a replacement for ADR / PRD process.** A spike's graduation produces a *draft* ADR or PRD; acceptance still flows through the ADR / PRD lifecycle in `docs/decisions/README.md` and `docs/prds/README.md`.
- **Not a place to spec autonomous research execution.** Tooling for web crawl, source ranking, citation validation, and spend automation is explicitly out of scope; LAT-119 lands the lifecycle only.

## Related

- `intake-triage.md` — where spikes originate (`Action class: Research task`, plus blocked PRD/ADR candidates).
- `operating-model.md` — surfaces and approval gates the spike lifecycle plugs into.
- `cost-controls.md` — cost bands, runaway-cost interrupt, budget-cap obligations.
- `approval-gates-and-autonomy-rules.md` — autonomy levels for `agent_type: research`.
- `retrospective-learning-loop.md` — how spike outcomes feed retros (graduation rates, stop-condition tuning).
- `docs/prds/README.md` — feature-PRD naming, frontmatter, and lifecycle (graduation target for `PRD-needed`).
- `docs/decisions/README.md` — ADR conventions and lifecycle (graduation target for `ADR-needed`).
- `docs/templates/agent-run-report.md` — `agent_type: research` envelope; spike-specific observability fields layer in here.
- ADRs: `0003-linear-persistence-boundary.md`, `0005-linear-dependency-and-sequencing-model.md`, `0006-agent-run-visibility-schema.md`, `0008-agent-control-layer-and-perplexity-boundary.md`, `0009-cost-controls-and-runaway-cost-interrupts.md`, `0010-retrospective-learning-loop.md`, `0012-integration-control-plane-software-architecture.md`.
- Linear: `LAT-119` (this lifecycle).
