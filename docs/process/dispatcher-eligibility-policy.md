# Dispatcher Eligibility Policy

> **LAT-134**: Complexity and reasoning tags gate dispatch eligibility. The
> dispatcher distinguishes local implementation work from architect/PM
> reasoning work, refuses to silently dispatch unclassified tickets to local
> agents, and routes ADR/PRD/planning tickets to the reasoning/human workflow.

## Tags

Each Linear issue may carry two classification labels, set by triage or
human operators during the refinement pass:

| Tag | Enum values | Source |
|---|---|---|
| `complexity` | `small` · `medium` · `large` · *(default: unknown)* | Linear label `complexity/{value}` |
| `reasoning` | `implementation` · `synthesis` · `architecture` · *(default: unknown)* | Linear label `reasoning/{value}` |

The dispatcher reads these labels from the issue's label set at dispatch
time (LAT-129 `linear-client.ts`). They are also surfaced in the ticket
pack header so the implementer knows their classification.

## Routing Rules

The dispatcher evaluates tags against the following rules (applied in order
after the existing LAT-129 deterministic hard-stop checks):

| Complexity | Reasoning | Local agent eligible? | Human approval required? |
|---|---|---|---|
| `small` | `implementation` | **Yes** — dispatch to local/RunPod | No |
| `medium` | `implementation` | **Yes** — dispatch to local/RunPod | No |
| `large` | `implementation` | **No** — escalate to reasoning/human | Yes |
| `small` | `synthesis` | **No** — route to frontier reasoning | Yes |
| `small` | `architecture` | **No** — route to frontier/human | Yes |
| `medium` | `synthesis` | **No** — route to frontier reasoning | Yes |
| `medium` | `architecture` | **No** — route to frontier/human | Yes |
| `large` | `synthesis` | **No** — escalate to frontier | Yes |
| `large` | `architecture` | **No** — escalate to frontier | Yes |
| *(unknown)* | *(any)* | **No** — requires human review | Yes |
| *(any)* | *(unknown)* | **No** — requires human review | Yes |

### Decision matrix summary

```
                   reasoning
                   impl     syn    arch
complexity small   ✓ local  → front → front
           medium   ✓ local  → front → front
           large    → front  → front → front
           unknown  → human  → human → human
```

✓ = local/RunPod agent eligible  
→ = route to frontier reasoning or human review

## Default Behavior When Tags Are Absent

When a ticket lacks both `complexity` and `reasoning` labels (or has one
or both set to `unknown`), the dispatcher does **NOT** silently dispatch
to local agents. Instead:

1. The ticket passes the existing LAT-129 deterministic hard-stop checks.
2. The classifier sets `local_agent_eligible = false` and
   `required_human_approval = true`.
3. The dispatcher emits the run but marks it as requiring human approval
   — the human gate (e.g. LAT-129 explicit override, or an approval
   marker on the ticket) must be present before dispatch proceeds.

This ensures that unclassified tickets are never quietly executed by a
local agent that might not have the right scope.

## Examples

### Eligible for local/RunPod implementation

These tickets would be dispatched to a local/RunPod implementation agent
without requiring human approval (assuming hard-stop checks pass):

#### LAT-126 style: Implementation cleanup

```
Complexity: small
Reasoning: implementation

Ticket: "Refactor redact helper to share regex constants"
Description: Pure refactor of the redact module. Do not touch secrets.
Labels: complexity/small, reasoning/implementation, ready
```

This is a small, bounded implementation task — exactly what the local/RunPod
lane is for.

#### LAT-127 style: Focused implementation

```
Complexity: medium
Reasoning: implementation

Ticket: "Wire live opencode adapter behind control-loop seam"
Description: Per ADR-0012, wire the seam so the live adapter implements
  the contract documented there. Tests pass without touching credentials.
Labels: complexity/medium, reasoning/implementation, ready
```

A medium-complexity implementation task. Still dispatchable locally.

### Ineligible for local implementation (route to reasoning/human)

These tickets would **NOT** be dispatched to a local/RunPod agent:

#### LAT-132 style: ADR work

```
Complexity: small
Reasoning: synthesis

Ticket: "Draft ADR for inference routing policy"
Description: Author a new architecture decision documenting the chosen
  routing policy between Claude Sonnet and local Qwen.
Labels: complexity/small, reasoning/synthesis, ready
```

Even though complexity is small, the reasoning type is `synthesis` — this
requires frontier reasoning (e.g. Claude Sonnet/Opus) or human PM review.

#### LAT-133 style: Architecture decision

```
Complexity: medium
Reasoning: architecture

Ticket: "Decide on telemetry substrate for agent runs"
Description: Evaluate telemetry options (file-based, database, event
  streaming) and choose the substrate for the pilot.
Labels: complexity/medium, reasoning/architecture, ready
```

Architecture work goes to frontier reasoning or human decision.

#### Unbounded scope

```
Complexity: large
Reasoning: implementation

Ticket: "Migrate all packages from CommonJS to ESM"
Description: Convert the entire monorepo to ESM modules.
Labels: complexity/large, reasoning/implementation, ready
```

Large scope exceeds what the bounded implementation lane can credibly
handle without risking context overflow or incomplete changes.

#### Missing classification

```
Complexity: unknown
Reasoning: unknown

Ticket: "Improve the dispatcher"
Description: Make the dispatcher better.
Labels: ready
```

No complexity or reasoning tag — the dispatcher refuses to silently
dispatch and requires a human approval gate before proceeding.

## Non-Goals

- **Full model router/concurrency.** This policy defines eligibility;
  the actual model selection and concurrency logic are deferred to
  LAT-58 / ADR-0020.
- **Tags bypass hard blockers.** Even if a ticket is `complexity/small`
  + `reasoning/implementation`, a hard blocker (e.g. "rotate production
  secrets") still prevents dispatch.
- **Local agents make merge/deploy/architecture decisions.** The bounded
  implementation lane operates within a fixed surface — no ADR edits,
  no workflow changes, no deploys.
- **Automatic tag assignment.** Triage or operators set the tags; the
  dispatcher reads them, does not compute them (though a future
  Perplexity plug-in could produce a recommendation envelope).

## Related

- ADR-0008: Agent control layer and Perplexity boundary (Stop list)
- ADR-0009: Cost controls and runaway-cost interrupts
- ADR-0020: Cost-class inference routing policy
- ADR-0021: Dispatcher synthesis boundary and deterministic hard stops
- ADR-0019: opencode local Qwen implementation runtime
- `intake-triage.md`: Backlog refinement loop (where tags are set)
- `agent-ready-ticket.md`: Pre-flight checks (where tags are verified)
- LAT-131: Classifier MVP
- LAT-132: Dispatcher decision ticket
- LAT-133: ADR/PRD workflow ticket
