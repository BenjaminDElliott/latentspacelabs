# Multi-intent intake escalation rules

> Derived from the Overmind experiment audit in [LAT-123](https://linear.app/latentspacelabs/issue/LAT-123/define-multi-intent-intake-escalation-rules-from-overmind-lessons). The Overmind lesson showed that naive `LLM → one label` routing breaks when a single brain dump contains PRD, ticket, ADR, and retro intents. This doc adds split, repair, and escalate rules on top of [`intake-triage.md`](intake-triage.md) and [`LAT-29 PRD`](../prds/LAT-29-low-friction-intake.md) without building a generic planner/router engine.

## Why this exists

Overmind's audit found that the existing intake rules assumed **one intent per input** and routed to a single classification + destination. Real-world inputs — especially messy brain dumps, mid-day-job voice notes, and GitHub comment chains — routinely contain multiple intents. Naive routing picks one intent and either drops the others or misclassifies the whole input.

This doc adds three behaviors to the existing pipeline:

1. **Multi-intent detection and splitting** — recognize when one dump maps to ≥2 destinations and produce ≥2 triage items.
2. **Repair / introspection handling** — detect when prior routing was wrong and either repair the existing item or fork a new one.
3. **Escalation rules** — explicit criteria for when to escalate to PRD, ADR, research spike, or backlog refinement.

All three are policy rules the intake agent checks during triage. They do not require a separate planner/router module — the agent applies them as part of the standard triage run.

## Multi-intent detection

### Signal heuristics

Triage scans the input for these multi-intent signals. Any one signal triggers a multi-intent review; two or more signals trigger a split (unless the intents are tightly coupled, see *Tightly coupled vs independent intents* below).

| Signal | Example | What it means |
|---|---|---|
| **Multiple action-class keywords** | "let's add observability, write an ADR for X, and also create a ticket for Y" | ≥2 distinct action classes (PRD candidate, ticket, ADR, research task, retro) in one dump. |
| **Scope shift mid-dump** | "first, I want to fix the login flow. Actually, also — while we're at it, let's think about our caching strategy" | The dump contains a tactical ticket request + a strategic ADR/PRD request. |
| **Self-referential routing feedback** | "this ticket was supposed to be about X, but it turned into Y" | The input references a prior routing decision and proposes a new one (repair signal). |
| **Explicit multi-part intent** | "three things: A, B, and C" or "on a separate note" | The user explicitly enumerates multiple intents. |
| **Contradiction with existing item** | "LAT-NN was supposed to cover X, but I've changed my mind about Y" | The input both references and modifies a prior item. |

### Tightly coupled vs independent intents

Not all multi-intent inputs need splitting. Use this test:

- **Tightly coupled** — the intents share the same decision context and one cannot be scoped without the other. Example: "we need an ADR to pick the streaming substrate, and once we pick it we need a ticket to implement it." → One triage item with dual action classes (`ADR candidate` primary, `ticket candidate` secondary), with the ticket deferred until ADR acceptance.
- **Independent** — the intents address different concerns or different surfaces. Example: "fix the login timeout" + "we should add a cost-tracking ADR." → Split into two triage items.

When in doubt, split. A single triage item with two independent intents risks one being silently dropped during refinement.

### Splitting rules

When multi-intent detection fires, triage produces one triage item per intent. The rules:

1. **Each split item gets its own classification** — PARA class, action class, confidence, risk, destination.
2. **Cross-reference sibling items** — each triage result includes a `Split-of:` pointer (matching the optional `Split-of pointer` field in the LAT-29 intake-event contract, §6.6).
3. **Echo the split in the terse reply** — "heard: fix login timeout (ticket) + cost-tracking ADR (ADR). Splitting into two items."
4. **Split at the highest-risk intent's level** — if one intent is `high` risk and the other is `low`, both items inherit the `high` risk posture until refinement.
5. **Personal/project splits come first** — before splitting into multiple action classes, separate personal from project content. Personal halves are confirmed independently.

### When to split vs when to merge

| Condition | Action |
|---|---|
| ≥2 action classes, different surfaces (e.g., ticket + ADR) | **Split** — different destination artifacts. |
| ≥2 action classes, same surface (e.g., two ticket requests for different sub-areas) | **Split** — one ticket per sub-area; avoids scope creep. |
| Action class + research question on the same topic (e.g., "should we do X? If yes, ticket for X") | **Merge** — create as a research-spike intake with a graduation hint toward the ticket. |
| Explicit "on a separate note" or "also, unrelated" | **Split** — independent items. |
| One clear primary intent with minor secondary context (e.g., a ticket request that mentions a related ADR as background) | **Don't split** — note the related ADR in the `Related active work` field. |

## Repair and introspection handling

Overmind also revealed that inputs often reference prior routing decisions and propose corrections. This section defines how to handle **repair** (correcting a wrong routing) and **introspection** (the input critiques the process itself).

### Repair detection

A repair signal is present when the input contains any of:

- References a prior `LAT-*` key and proposes a different classification or destination than what was assigned.
- Uses phrases like "this was supposed to be X, but it's really Y" or "I meant Z, not X."
- Links to a prior item and says "the scope has changed" or "this should have been an ADR, not a ticket."
- References a prior spike/ADR/PRD and proposes a different graduation path.

### Repair rules

| Repair signal | Rule |
|---|---|
| Prior routing was wrong but the content is still actionable | **Repair in place.** Update the existing item's classification, confidence, and destination. Leave a triage comment on the existing item with the repair rationale and the original classification. |
| Prior routing was wrong and the content needs new scoping | **Repair + fork.** Update the existing item and create a new item for the new intent. Reference both in the terse reply. |
| Prior routing was wrong and the content is no longer actionable | **Repair to archive.** Change the existing item to `Archive` with a triage comment explaining why. Do not create a replacement item. |
| Repair changes the risk level from low to medium/high | **Surface to Ben.** The repair comment on the existing item includes a `⚠️ Risk escalated: low → medium/high. Review needed.` flag. |
| Repair contradicts an accepted ADR or approved PRD | **Repair + ADR candidate.** The existing item is updated and a new ADR candidate triage item is created to resolve the contradiction. |
| Repair involves a personal↔project flip | **Apply personal confirmation gate.** If the repair changes from `personal` to `project` (or vice versa), check confirmation status. If unconfirmed, ask Ben for `y/n` before writing to Linear. |

### Introspection handling

An introspection signal is present when the input critiques the triage or routing process itself:

- "intake classified this as a ticket but it should have been an ADR"
- "we're creating too many needs-refinement items"
- "the clarification policy is too aggressive on this surface"

**Introspection rules:**

1. Route to **Retro learning** action class. Create a triage item with `Classification: Area` and `Suggested destination: process doc update`.
2. If the introspection implies a specific process change (e.g., "we should add a multi-intent split rule"), reference this doc as the target.
3. If the introspection is vague ("intake is being too aggressive"), route to the backlog-refinement pass for evaluation.
4. Introspection items **do not** trigger a split — each introspection comment is one item.

## Escalation rules

Not every multi-intent or repair input stays at the ticket level. This section defines when to escalate.

### Escalation ladder

| Escalation target | When to use | Surface-back to Ben? | Result |
|---|---|---|---|
| **Research spike** | The input contains a question too complex to classify (e.g., "which streaming substrate should we use?") OR a ticket/ADR candidate is blocked on an investigation. | Yes — only when cost class is `elevated-allowed` or an escalation criterion fires mid-run. | Spike intake packet per [`research-spike-lifecycle.md`](research-spike-lifecycle.md), `research-spike` label. |
| **PRD** | Two or more tickets/epics share a common outcome and can be scoped more coherently as a single PRD. OR the input's scope exceeds what a single ticket can hold without losing coherence. | Yes — Ben approves PRD creation before any file is opened in `docs/prds/`. | New feature PRD draft. |
| **ADR** | The input implies an architecturally significant decision (cross-cutting, irreversible, or affecting multiple surfaces). OR a repair contradicts an existing ADR and the contradiction must be resolved. | Yes — ADR draft at `proposed` status, accepted by Ben per ADR lifecycle. | New ADR draft in `docs/decisions/`. |
| **Backlog refinement** | The input is actionable but the agent cannot determine the optimal priority, sequencing, or pre-flight completeness. OR the input contains mixed risk levels that refinement should resolve. | No — agent creates `needs-refinement` item; Ben reviews at the next refinement pass. | Updated or new `LAT-*` issue with `needs-refinement` label. |
| **Archive** | All intents in the input are stale, duplicative, or superseded. OR the multi-intent split results in items that are all low-value. | No — archive notes are valid output. | Existing items closed; archive reason stated in comments. |

### Escalation trigger matrix

Use this matrix when a multi-intent or repair input crosses one or more of these thresholds:

| Condition | Escalation |
|---|---|
| ≥3 independent intents in one dump | **Backlog refinement** — split into individual items and flag for refinement review. |
| Any intent is `high` risk + irreversible (infra, billing, production data touch) | **Surface to Ben** — stop-and-ask posture. Do not auto-create durable artifacts. |
| Any intent requires an architectural decision (not just an implementation choice) | **ADR candidate** — create ADR triage item alongside or instead of the ticket. |
| Any intent is a research question with no clear answer in the existing docs | **Research spike** — create spike intake packet with bounded scope. |
| Repair changes classification from `project` to `personal` (or vice versa) without confirmation | **Personal confirmation gate** — ask `y/n` before writing to Linear. |
| Repair changes `Confidence` from `high` to `low` | **Backlog refinement** — the item needs re-scoping with lower confidence. |
| Multiple intents with conflicting risk levels (one `low`, one `high`) | **Highest-risk posture** — all split items inherit the highest risk until refinement. |
| Introspection cites a specific process doc for improvement | **Retro learning** → route to that doc. Create a triage item with the proposed change. |

### Low-risk reversible vs high-risk

The risk posture from [`intake-triage.md`](intake-triage.md) → *Severity, risk, and failure posture* applies to multi-intent splits:

- **Low + reversible** — proceed-and-flag. Create the split items as `needs-refinement`. Flag in `Risks` that a multi-intent split occurred.
- **Medium + reversible** — proceed with a draft (PRD draft, ADR draft, or `needs-refinement` ticket). Flag prominently.
- **Medium + non-reversible** — stop and ask. Do not create durable artifacts.
- **High** (either) — stop and ask. Surface to Ben explicitly.
- **Runaway cost** (either) — always stop and ask.

An ambiguous input where the highest intent is `medium` risk should be treated as `medium` for all split items — err on the side of caution.

## Research spike integration

Multi-intent inputs frequently contain a research question embedded alongside a ticket or ADR request. The [`research-spike-lifecycle.md`](research-spike-lifecycle.md) defines the bounded spike workflow. This section specifies when intake creates spikes from multi-intent inputs.

### When intake creates a spike from multi-intent input

| Scenario | Spike intent | Graduation hint |
|---|---|---|
| Input asks "should we do X?" while also requesting a ticket for Y that depends on X | Investigate X; ticket Y is gated on the spike | `PRD-needed` if X is large; `ticket` if small; `ADR-needed` if architectural |
| Input requests an ADR but the decision requires comparing options not in existing docs | Compare options and recommend | `ticket` if decision is clear; `ADR-needed` if structural change |
| Input requests a ticket but the scope is unclear | Determine scope boundaries | `PRD-needed` if scope is large; `ticket` if scoping resolves cleanly |
| Input contains contradictory statements about what was decided | Verify against existing ADRs/PRDs | `ADR-needed` if contradiction is structural; `ticket` if just a clarification |

### Spike split rule

When a multi-intent input contains both a spike intent and a ticket intent:

1. Create the spike intake packet with `Decision-this-feeds` pointing to the ticket.
2. Create the ticket as `needs-refinement` with a `Recommended predecessors:` reference to the spike.
3. The ticket's `## Sequencing` block lists the spike as a hard blocker if the ticket scope depends on the spike's findings; otherwise as a recommended predecessor.
4. When the spike graduates to `Direct backlog refinement`, the ticket is updated and the predecessor link is resolved.

## No generic planner/router

This doc adds rules, not an engine. The intake agent applies multi-intent detection, repair, and escalation as **conditional checks during triage** — not as a separate planning phase. The agent does:

1. Run the standard triage classification (PARA + action class) on the full input.
2. Check for multi-intent signals. If found, split into ≥2 triage items.
3. Check for repair/introspection signals. If found, apply repair rules.
4. Check escalation triggers against the split items. If any trigger fires, escalate.
5. Produce the triage output shape for each resulting item.

The agent never builds a DAG, never plans ahead beyond the next action, and never defers a decision to a separate planning step. If the agent finds itself wanting to "plan three steps ahead," it surfaces that as a research spike instead.

## Quick-reference decision flow

```
Input received
├─ Contains personal + project content?
│   ├─ Yes → Split at personal/project boundary (confirm each independently)
│   └─ No → Continue
├─ Contains ≥2 action-class signals or scope shift?
│   ├─ Yes → Check if tightly coupled or independent
│   │   ├─ Independent → Split into ≥2 triage items
│   │   └─ Tightly coupled → One triage item with dual action classes
│   └─ No → Continue with single classification
├─ References prior routing?
│   ├─ Yes → Apply repair rules (repair in place / repair + fork / archive)
│   └─ No → Continue
├─ Any intent is high-risk or irreversible?
│   ├─ Yes → Surface to Ben (stop-and-ask)
│   └─ No → Continue
├─ Any intent is a research question or architectural decision?
│   ├─ Yes → Create spike intake or ADR candidate
│   └─ No → Continue
└─ Produce triage output shape for each item
```

## Related

- [`intake-triage.md`](intake-triage.md) — base classification, triage output shape, risk matrix, clarification policy, backlog refinement loop.
- [`LAT-29 PRD`](../prds/LAT-29-low-friction-intake.md) — product requirements for low-friction intake surfaces, intake-event contract to ICP.
- [`research-spike-lifecycle.md`](research-spike-lifecycle.md) — bounded spike workflow, graduation rules, spike intake packet.
- [`retrospective-learning-loop.md`](retrospective-learning-loop.md) — how introspection findings feed back into process docs.
- [`approval-gates-and-autonomy-rules.md`](approval-gates-and-autonomy-rules.md) — autonomy levels, rule matrix, failure posture.
- [`operating-model.md`](operating-model.md) — surfaces and responsibilities, approval gates, dispatch readiness.
- [LAT-123](https://linear.app/latentspacelabs/issue/LAT-123) — Overmind experiment audit that revealed the multi-intent routing gap.
- [LAT-29](https://linear.app/latentspacelabs/issue/LAT-29) — low-friction intake PRD.
- [LAT-119](https://linear.app/latentspacelabs/issue/LAT-119) — research spike lifecycle.
