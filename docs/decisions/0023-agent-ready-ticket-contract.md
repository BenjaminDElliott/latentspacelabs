---
id: ADR-0023
title: Agent-ready ticket contract and lane policy
status: proposed
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-142
  - LAT-131
  - LAT-133
  - LAT-134
  - LAT-135
  - LAT-137
supersedes:
superseded_by:
revisit_trigger:
  - When the dispatcher's refusal rate exceeds 30% on agent-ready tickets
  - When a lane's scope drift is detected by policy-scan or classifier
---

# ADR-0023: Agent-ready ticket contract and lane policy

> File name: `docs/decisions/0023-agent-ready-ticket-contract.md` — zero-padded 4-digit sequence, lowercase, dashed.
> Keep ADRs short (a page or two). Link out to supporting detail rather than inlining it.

## Context

The dispatcher (LAT-129) routes one Linear ticket per invocation into a bounded run. The ticket classifier (LAT-131) detects risky scope and missing acceptance criteria. The ticket pack (LAT-104 / opencode-ticket-pack.md) is the implementer-side input shape. But there is no single, authoritative contract that defines **what makes a ticket "agent-ready"** at the dispatcher level, **which lanes a ticket may enter**, and **how missing or malformed fields cause refusal versus clarification**.

Without such a contract, tickets are promoted to `agent-ready` inconsistently: vague research tasks, under-specified ADR drafts, and tickets with forbidden file scope slip through to the dispatcher, where they either refuse late (wasting a run) or succeed silently on the wrong scope.

## Decision

The agent-ready ticket contract is a **structured set of required fields, lane boundaries, acceptance-criteria format rules, file-scope expectations, and executable-check vs. policy-validation distinctions**. Every ticket promoted to `agent-ready` must satisfy all required fields. Every ticket promoted to `agent-ready` must declare which lane it targets. The dispatcher and classifier (LAT-131) consume this contract before selecting a ticket; the ticket-pack generator (LAT-104) embeds the contract fields into the pack; the implementer prompt (LAT-137) references the contract.

This ADR defines:

1. **Required fields** for an agent-ready ticket (the "agent-ready contract").
2. **Four lanes** and their scope boundaries: `docs/adr/prd`, `implementation`, `harness/meta`, `research/spike`.
3. **Acceptance criteria format** rules — each criterion must be objectively checkable, checkbox-prefixed, and mapped to a verification method.
4. **File scope expectations** — allowed and forbidden paths per lane.
5. **Executable checks vs. policy/manual validations** — what runs as shell vs. what is verified against the diff.
6. **Refusal vs. clarification policy** — when missing fields cause a hard refusal vs. a `needs_clarification` signal.

The contract is documented here and codified in the `@latentspacelabs/ticket-contract` package (`packages/ticket-contract/src/validate.ts`) that the dispatcher imports. The dispatcher consumes the contract via `validateAgentReadyContract()` before dispatch; the ticket-pack generator calls `buildTicketPackFromContract()` which enriches the pack with lane-specific rules.

## Consequences

### Good

- **Deterministic refusal.** The dispatcher can refuse a ticket at selection time with a precise reason ("missing budget cap", "vague spike without acceptance criteria", "secret rotation in implementation lane") rather than guessing.
- **Lane-based scope enforcement.** Each lane has a fixed file-scope allowlist and forbid-list. The policy-scanner already enforces some of this; the contract makes it explicit per-lane.
- **Clear acceptance-criteria format.** Every agent-ready ticket follows the same AC format, which the dispatcher, ticket-pack generator, and implementer all understand.
- **Executable checks are executable.** The distinction between "run `npm run check`" (executable) and "no edits under `docs/decisions/**`" (policy) is explicit in the pack and validated against the diff.

### Bad / open

- **Slight overhead on ticket authoring.** The agent-ready ticket template now has more required sections. This is acceptable because the pre-flight refuses incomplete tickets.
- **Lane scope must stay in sync.** If a new package is added, the lane allowlists must be updated. This is tracked as a policy change, not an ADR change.
- **The contract is a policy doc, not a spec.** It defines *what* an agent-ready ticket looks like; future tickets (LAT-140+) can add enforcement tools that read the same schema.

## Confirmation

This decision is working when:

- The dispatcher refuses ≥90% of non-agent-ready tickets before dispatching.
- A ticket pack generated from an agent-ready ticket always contains lane-specific constraints.
- `npm run check` passes on the repo (including the new ticket-contract package).

## Links

- Related Linear issue(s): LAT-142, LAT-131, LAT-133, LAT-134, LAT-135, LAT-137
- Related process docs: `docs/templates/agent-ready-ticket.md`, `docs/process/coding-agent-preflight.md`, `docs/process/intake-triage.md`, `docs/process/research-spike-lifecycle.md`
- Related templates: `docs/templates/agent-ready-ticket.md`, `docs/templates/opencode-ticket-pack.md`, `docs/templates/local-agent-prompt.md`
