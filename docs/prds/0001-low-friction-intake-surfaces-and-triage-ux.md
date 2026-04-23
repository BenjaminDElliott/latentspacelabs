# PRD: Low-Friction Intake Surfaces and Triage UX

- **Owner:** Ben Elliott
- **Status:** draft
- **Related Linear:** LAT-29, LAT-10, LAT-12, LAT-14, LAT-16
- **Related ADRs:** ADR-0001, ADR-0003, ADR-0005, ADR-0008, ADR-0012, ADR-0013, ADR-0014

## 1. Problem Statement

Raw input — brain dumps, mid-day-job one-liners, voice-style fragments, GitHub comments, mixed personal/project notes — must reach the Integration Control Plane (ICP) without losing signal and without burning Ben's attention on reformatting or interrogation. Today the capture contract is split across `intake-triage.md` (policy) and `mobile-intake-ux.md` (UX), and Perplexity is the only real primary surface. As additional surfaces (GitHub PR/issue comments, future voice/note clients) come online, we need a single PRD that fixes *which* intake surfaces are first-class, *how* the agent replies on each, *when* it is allowed to ask, *how* it separates personal from project, and *what* ICP must receive from every intake event — so ICP implementation (LAT-14/16) can build against a stable product contract.

## 2. Goals

1. Enumerate the first-class intake surfaces and declare each one's response modality (terse chat reply, PR comment, etc.).
2. Standardize the **mobile/chat response pattern** so replies fit a phone screen, never demand reformatting, and never paste full triage blocks inline.
3. Codify a **clarification-only-when-useful** policy: zero questions by default; at most one on routine items; more only when irreversibility or cost justifies the round-trip.
4. Make **personal-vs-project separation** enforceable: mixed dumps split, personal items never silently reach Linear, explicit `y/n` confirmation required for any personal content that is to be promoted.
5. Define the routing vocabulary — how raw input maps to one of: **PRD / epic / ticket / ADR / archive / personal task** — and require a single primary destination per intake item.
6. Specify the **intake-event contract** ICP must receive: fields, metadata, source pointers, confidence, risk, and the proposed destination. This is what downstream implementations (LAT-14/16) build against.
7. Preserve the raw input verbatim on any durable artifact created from intake.

## 3. Non-Goals

1. **No custom mobile app.** The intake surface remains any chat-style client that can reach the intake agent. We do not commit to building an app, Slack bot, SMS gateway, or email assistant in this scope.
2. **No replacement of Perplexity as the first intake surface.** Perplexity-first intake (ADR-0001, ADR-0008) stands. Additional surfaces route into the same triage pipeline, not around it.
3. **No full ICP implementation contract.** This PRD defines the *product-side* requirements an intake event must satisfy. The ICP-side execution contract (state, persistence, telemetry, dispatch) is ADR-0012/0013/0014 and LAT-14/16 territory.
4. **No voice stack selection.** "Voice-like" means transcribed-style input. Vendor/pipeline selection is deferred.
5. **No new personal-store decision.** Where personal items durably land is an open question tracked separately. This PRD only commits to the *separation and confirmation* rules, not the destination.
6. **No change to classification taxonomy.** PARA + action classes from `intake-triage.md` are reused as-is.

## 4. Primary Users

1. **Ben (operator, primary).** Captures input in seconds between meetings, one-handed on a phone, sometimes via voice-style dumps. Needs: lowest possible `thought → sent` latency, no interrogation, no accidental Linear leakage of personal content.
2. **The intake agent (first-class non-human user).** Must act on the contract in this doc: produce terse replies on chat surfaces, honor the clarification policy, emit the intake-event contract to ICP.
3. **Downstream agents (triage, dispatch, refinement).** Consume the intake-event contract. They must receive enough metadata to act without re-asking Ben.
4. **Future external reporters (GitHub issues/PR comments).** Not Ben, but their input enters the same pipeline. They do not see terse replies; they see PR/issue comments that preserve their context and cross-link to Linear.

## 5. Operating Model / Workflow

Intake → triage → durable artifact follows the Perplexity/Linear/GitHub control plane (ADR-0001).

- Capture lands on a supported surface.
- The intake agent produces a **terse chat reply** (on Perplexity/chat) or a **PR/issue comment** (on GitHub), never the long-form triage block inline.
- The agent classifies (PARA + action class per `intake-triage.md`) and emits an **intake event** to ICP with the contract in §6.
- Low-risk, reversible, `project`/`area` items may create `needs-refinement` Linear issues at autonomy L2 (ADR-0008).
- `personal` and ambiguous-toward-personal items are gated by an explicit `y/n` confirmation in the same thread before any Linear write.
- Durable promotion to `agent-ready` only happens via the backlog-refinement pass (`intake-triage.md`); intake itself never promotes.

## 6. Requirements

### 6.1 Supported intake surfaces (must)

Each surface is first-class if it is listed here and routes into the same triage pipeline with the same intake-event contract.

| Surface | Primary? | Reply modality | Notes |
|---|---|---|---|
| Perplexity threads / workspace scratch | **Yes (primary)** | Terse chat reply | Conversational clarification allowed when it unblocks routing. |
| Chat clients reaching the intake agent (Claude chat, future connectors) | Yes | Terse chat reply | Surface-agnostic; UX contract must not assume a specific client. |
| Mobile text (forwarded into a chat thread) | Yes | Terse chat reply | One-handed, ≤10s-to-send assumption. |
| Voice-style dumps (transcribed into a chat thread) | Yes | Terse chat reply, read-aloud-friendly | No markdown-dependent rendering. |
| GitHub PR comments (top-level and inline review) | Yes | PR comment reply + cross-link | Must preserve repo/PR/file/line/author. |
| GitHub issue comments and newly opened issues | Yes | Issue comment reply + cross-link | Future external reporters enter here. |
| Linear comments on `intake` / `needs-refinement` items | Yes | Linear comment reply | Refinement-facing, not mobile-facing. |
| Future voice/note surfaces (device-native notes, voice assistants) | **Anticipated, not built** | Terse, read-aloud-friendly | Contract here must survive their arrival unchanged. |

Out of scope as intake surfaces in this PRD: custom mobile app, Slack, email, SMS (see §3).

### 6.2 Mobile / chat response pattern (must)

- Reply is **at most four short lines**: `heard` / `route` / `confidence + risk` / optional single `question` or `confirm`.
- Reply must fit a phone screen without horizontal scroll and be readable aloud.
- The full triage block is **never** pasted into chat; it lives on the durable artifact (Linear issue body, triage log, run report) and is linked.
- The agent must never respond with "please reformat" or a generic PM interview opener.
- For GitHub-sourced intake, the reply is a **single comment** that echoes the heard item, states the route, and links to any created Linear item; it does not paste the full triage block.

### 6.3 Clarification policy (must)

- **0 questions** when routing, risk, and destination are all clear.
- **1 question** when exactly one of { routing, risk, destination } is ambiguous and resolving it unblocks the item. Common case for "ask."
- **Up to 3 questions** only when the item is high-risk, irreversible, or would create a Linear Project / dispatch an agent.
- **Never ask a question whose answer does not change the next action** (e.g. priority, due-date-for-flavor).
- Any clarifying question must be answerable in ≤10 seconds, one-handed, speech-friendly (yes/no, a/b, short phrase).
- If Ben does not answer in-session, the agent proceeds at reduced confidence, writes `needs-refinement`, and moves on — never blocks indefinitely.

### 6.4 Personal vs project capture (must)

- Every item (or each half of a split mixed dump) is classified `project` / `area` / `personal` / `archive` before any persistence.
- `personal` items are **never** written to Linear without an explicit in-thread `y/n` confirmation. Default answer on timeout is **no**.
- Mixed dumps are **split** into separate triage items; each half is routed independently; the split is echoed in the terse reply.
- Ambiguous items **default to personal and ask** a single yes/no to promote.
- No personal content — not even as "context" — enters a Linear item, ADR, PRD, or GitHub artifact without explicit confirmation.
- Confirmation is **per-item**, not per-session, until an ADR says otherwise (open question).

### 6.5 Raw input → destination routing vocabulary (must)

Every intake item has **exactly one primary destination** drawn from:

- **PRD candidate** — outcome large enough to warrant a product requirements doc before any ticket. Durable artifact: a new PRD draft (directory/location TBD; template at `docs/templates/prd.md`).
- **Epic / parent issue** — a multi-ticket outcome in Linear that is not yet at PRD scale. Durable artifact: a Linear parent issue labeled `intake` / `needs-refinement`.
- **Ticket** — discrete unit of work, agent-ready or human-ready. Durable artifact: a Linear issue. Intake-created tickets are **never** dispatched; they always pass through refinement first (ADR-0005).
- **ADR candidate** — architecturally significant decision. Durable artifact: an ADR draft under `docs/decisions/`.
- **Archive** — duplicate, stale, rejected, superseded, or non-actionable. A first-class, often-correct outcome.
- **Personal task** — routes to Ben's personal destination (TBD). Never in Linear without explicit confirmation.

Mixed inputs are split before routing. No "routes to two destinations" — if two destinations are needed, there are two intake items.

### 6.6 Intake-event contract to ICP (must)

Every intake event ICP receives must carry, at minimum:

- **Raw input (verbatim).** The original message text as received, untrimmed.
- **Source.** Surface type (`perplexity` | `chat` | `github-pr-comment` | `github-issue` | `linear-comment` | `voice-note` | …), author identity, timestamp, and a stable URL or thread pointer.
- **GitHub-specific metadata** (when source is GitHub): repo, PR/issue number, PR branch + base branch, file path and line range (inline review comments), linked Linear key if inferable, commenter identity, comment URL.
- **Classification.** PARA class + primary action class + any secondary action classes.
- **Confidence.** `low` | `medium` | `high`, with a one-line justification.
- **Risk.** `low` | `medium` | `high` | `runaway-cost`, with reversibility flag.
- **Proposed destination.** One of the §6.5 values.
- **Actionability.** `agent-ready` | `needs-refinement` | `research-only` | `not-actionable`. Intake events are effectively never `agent-ready` — see §6.5.
- **Split-of pointer (optional).** If this event resulted from splitting a mixed dump, a pointer to the sibling event(s).
- **Confirmation status (optional).** For personal-adjacent items: whether the user confirmed persistence and when.

This is the **product-side contract**. The ICP-side schema, storage, and telemetry are ADR-0014 / LAT-14 territory; they must cover every field here.

### 6.7 Preservation and evidence (must)

- Raw input is preserved verbatim on any durable artifact created from intake (`## Raw input` section on Linear issues, equivalent on PRD/ADR drafts).
- Source metadata (URL, author, timestamp, PR/file/line where applicable) is never dropped.
- When an intake item matches an existing active Linear item, the agent **comments on the existing item** rather than creating a new one, and says so in the terse reply (`route: comment on LAT-NN`).

### 6.8 Failure-mode prohibitions (must)

Explicitly forbidden behaviors — any of these is a bug, not a style preference:

- Interrogation (more than the clarification policy allows).
- Reformatting demands.
- Silent personal → Linear leakage.
- Pasting the full triage block into the chat reply.
- Dropping source metadata.
- Auto-promoting intake items to `agent-ready`.

### 6.9 Nice-to-haves

- Short per-surface style guides (GitHub vs chat vs Linear comment) as follow-ups.
- A lightweight "intake log" view (chronological, filterable by source) as a refinement aid.

## 7. Acceptance Criteria

- [ ] Supported intake surfaces are enumerated and each has a declared reply modality.
- [ ] Terse response pattern (≤4 lines, no inline full triage) is specified and exemplified.
- [ ] Clarification policy (0 / 1 / up to 3 questions) is codified with the cost-of-wrong test.
- [ ] Personal-vs-project separation requires explicit `y/n` confirmation before any Linear write of personal content, with per-item default.
- [ ] Routing vocabulary (PRD / epic / ticket / ADR / archive / personal) is fixed; single primary destination per item.
- [ ] Intake-event contract to ICP is specified with the field list in §6.6.
- [ ] Raw input preservation and source-metadata preservation are mandated.
- [ ] Explicit failure-mode prohibitions are listed.
- [ ] Non-goals explicitly exclude: custom mobile app, replacement of Perplexity as first intake surface, full ICP implementation contract.
- [ ] Cross-links to `intake-triage.md`, `mobile-intake-ux.md`, ADR-0001 / 0003 / 0005 / 0008 / 0012 / 0013 / 0014, and relevant Linear keys are present.

## 8. Success Metrics

**Product metrics** (user-visible outcome)

- `thought → sent` latency for intake stays within a few seconds on chat/mobile (self-reported; no instrumentation required for this PRD).
- Zero personal-content leaks into Linear per quarter (hard gate; any leak is a P0 incident).
- ≥95% of intake items produce a reply within the 4-line terse pattern on chat surfaces.
- GitHub-sourced intake items that become durable artifacts retain 100% of required source metadata (repo, PR/issue, file/line, author, URL) — measured by spot audit during refinement.

**Workflow metrics** (cost / process)

- Median clarification questions per intake item ≤ 0 for routine items; ≤ 1 across all non-high-risk items.
- Rework rate: <10% of intake-created Linear items are reclassified or deleted during refinement in the first month after ICP lands (baseline to be established during pilot).
- No intake-created Linear issue is dispatched as `agent-ready` without a refinement pass (hard gate, not a metric — any breach is a policy violation).

Metric instrumentation is deferred to ICP (LAT-14 / LAT-16) per ADR-0014; this PRD does not require instrumentation to ship, only requires the contract that makes future instrumentation feasible.

## 9. Open Questions

- **Personal store destination.** Where do `personal`-classified items durably land? Candidate: private Linear team, personal notes store, or ephemeral-in-thread. Likely a follow-up ADR.
- **Confirmation scope.** Does a single `y` in a session grant blanket permission for personal → Linear in that session, or per-item? Default assumed per-item. ADR candidate.
- **GitHub external reporter UX.** When the commenter is not Ben, does the intake agent still reply in-thread? Assumed yes with a lighter touch; needs confirmation.
- **Canonical intake surface.** The surface-agnostic posture is a deliberate deferral (per `mobile-intake-ux.md`). A follow-up ADR may select a canonical surface once pilot evidence accumulates.
- **Voice stack selection.** Deferred until the canonical intake surface question is revisited.
- **ICP ownership of intake-event schema.** §6.6 defines the product-side contract; the ICP-side schema (LAT-14 / LAT-16) must cover every field here. Confirm ownership boundary with the ICP PRD when it lands.

## 10. Risks

**Product risk**

- **Over-tersing loses accuracy.** A 4-line reply may drop signal a new user would expect. Mitigation: terse reply is the default on mobile/chat only; Linear/PR comments may be slightly longer when context requires; full triage block is always on the durable artifact.
- **Personal leak into Linear.** Any silent personal → Linear write breaks trust in the work graph. Mitigation: explicit `y/n` gate, default to `personal`, per-item confirmation, hard gate in success metrics.
- **Surface sprawl.** Adding surfaces (Slack, SMS, …) without keeping the contract stable fragments the UX. Mitigation: §6.1 table is the allowed list; additions go through a PRD update.
- **Voice-style noise triggers false personal/project classification.** Transcription artifacts may flip classification. Mitigation: ambiguous defaults to `personal` + ask.

**Process / cost risk**

- **Runaway clarification loops.** Agent ignoring the 0/1/3 policy costs Ben more than it saves. Mitigation: hard policy + failure-mode list in §6.8.
- **Refinement backlog overload.** Too many `needs-refinement` items dilute the backlog. Mitigation: `intake-triage.md` refinement cadence; archive aggressively.
- **Fragmented intake-event schemas downstream.** If ICP and this PRD drift on field names, agents lose context. Mitigation: ICP schema (ADR-0014) must cover §6.6 exactly.

**Reversibility**

- All intake-produced artifacts (Linear issues labeled `needs-refinement`, ADR drafts, PRD drafts) are reversible by archive/close/delete. No infra, billing, or prod touch from intake itself. `agent-ready` promotion is the line; it is gated to the refinement pass.

## 11. Dependencies

**Hard blockers**

- None for drafting this PRD.

**Recommended predecessors**

- `intake-triage.md` (LAT-10) — base classification and triage output shape.
- `mobile-intake-ux.md` (LAT-12) — capture-surface interaction contract this PRD generalizes.
- ADR-0008 (agent control layer / Perplexity boundary) — autonomy level for agent-created Linear issues.
- ADR-0005 (dependency and sequencing) — why intake items are never `agent-ready`.
- ADR-0012 / 0013 / 0014 — ICP architecture and the state/telemetry substrate that will host the intake-event contract.

**External**

- Perplexity (primary intake surface).
- Linear (work graph, intake-labeled issues).
- GitHub (PR/issue comments).
- Future voice / note surfaces — anticipated, not yet selected.

Tickets implementing this PRD must mirror the hard blockers (none today) into their own `## Sequencing` blocks per ADR-0005.

## 12. Approval & Autonomy

- **Agent creates `needs-refinement` Linear issues from intake** — allowed at L2 per ADR-0008.
- **Agent creates Linear Projects from intake** — requires human approval (L1).
- **Agent dispatches `agent-ready` work from intake** — forbidden. Dispatch requires the refinement pass.
- **Agent writes personal content to Linear** — forbidden without explicit in-thread `y/n`.
- **Agent creates ADR/PRD drafts in-repo from intake** — allowed as drafts only; merge requires human approval per the operating model.
- **Default posture** — pilot-level autonomy; intake is the surface where wrong-classification is cheap to reverse, so proceed-and-flag beats stop-and-ask for low-risk reversible items.

## 13. Definition of Done

- [ ] Goals met and acceptance criteria checked.
- [ ] Success metrics instrumented (or explicitly deferred to ICP instrumentation in LAT-14 / LAT-16).
- [ ] Open questions either resolved in-PRD, promoted to ADR candidates, or logged as follow-up Linear tickets.
- [ ] Linear (LAT-29) and this file cross-linked.
- [ ] `intake-triage.md` and `mobile-intake-ux.md` cross-reference this PRD.

## 14. Links

- Linear issues: LAT-29 (this PRD), LAT-10 (intake policy), LAT-12 (mobile intake UX), LAT-14 / LAT-16 (ICP).
- Related ADRs: ADR-0001, ADR-0003, ADR-0005, ADR-0008, ADR-0012, ADR-0013, ADR-0014.
- Process docs: `docs/process/intake-triage.md`, `docs/process/mobile-intake-ux.md`, `docs/process/operating-model.md`, `docs/process/approval-gates-and-autonomy-rules.md`.
- Template: `docs/templates/prd.md`.
