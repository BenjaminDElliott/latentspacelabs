---
prd_id: LAT-167-agent-type-catalog
title: Agent type catalog — purpose, autonomy level, and risk profile
status: draft
owner: Ben Elliott
date: 2026-06-14
related_linear:
  - LAT-167
related_adrs:
  - ADR-0008
  - ADR-0009
  - ADR-0013
  - ADR-0019
derived_from:
  - root-agentic-development-flywheel
supersedes:
superseded_by:
---

# Agent Type Catalog

> This document catalogs every agent type in the Agentic Development Flywheel, capturing purpose, inputs, outputs, autonomy level, and risk profile. It serves as the canonical reference for dispatch routing (LAT-134), the ICP dispatcher (LAT-129), and the approval-gate matrix (`docs/process/approval-gates-and-autonomy-rules.md`).

## 1. Overview

The flywheel operates with four canonical agent types. Each has a distinct role in the intake → dispatch → QA → deploy → retro pipeline. Agents are classified by their **purpose** (what job they do), their **inputs** (what they need to start), their **outputs** (what they produce), their **autonomy level** (how independently they can act), and their **risk profile** (what goes wrong and how bad it gets).

| Agent Type | Autonomy Level | Risk | Primary Lane |
|---|---|---|---|
| Coding agent | L3–L4 | Medium | `runpod_frontline` / `local_dev_fallback` |
| QA agent | L3 | Medium | `runpod_frontline` |
| PR review agent | L3 | Low–Medium | `runpod_frontline` |
| SRE / deploy agent | L3–L4 | High | `runpod_frontline` / `local_dev_fallback` |

## 2. Coding Agent

### Purpose

Produces code changes in response to an agent-ready ticket. The coding agent reads the ticket, the relevant repo code, and any linked ADRs/PRDs, then writes implementation code, opens a PR, and emits a run report.

### Inputs

- **Code diffs** — base branch state and any existing diffs from prior runs on the same ticket.
- **Repo** — the target repository (this monorepo, or an external repo scoped by the ticket).
- **Branch** — a scratch branch derived from the ticket's configured base (usually `main`).
- **Ticket** — the agent-ready ticket (Linear issue key, description, acceptance criteria, files-in-scope, budget cap).
- **Context documents** — linked ADRs, PRDs, process docs, and templates the ticket references.

### Outputs

- **Pull Request** — a PR targeting the ticket's configured base branch, with the `LAT-NN:` prefix per the PR ↔ Linear linking convention.
- **Run report** — structured evidence per ADR-0006 / `docs/templates/agent-run-report.md`, including cost, lane, routing, and refusal reason if applicable.
- **Linear write-back** — outcome summary, evidence links, risk flags, PR link, next action (per ADR-0003).
- **Preflight result** — pass/warn/refuse against `docs/process/coding-agent-preflight.md`.

### Autonomy Level

- **Pilot default: L3-with-approval.** The dispatcher selects the ticket; a human (Ben) explicitly approves each dispatch.
- **Target: L4.** Autonomous implementation with review gates — the agent executes end-to-end, opens a PR, and requests review. Merge still requires human approval.

### Risk Profile

- **Risk: Medium.**
  - Wrong implementation that looks correct → QA catches it.
  - Context overflow on large scope → refusal or partial implementation.
  - Cost overrun → ADR-0009 runaway-cost interrupt stops the run.
  - Drift from ADR → preflight refuse against accepted ADRs.
  - Not destructive — changes live in a branch until human merges.

### Dispatch Eligibility

- Must carry `reasoning: implementation` (LAT-134).
- Complexity `small` or `medium` → local/RunPod eligible.
- Complexity `large` → escalates to frontier reasoning.
- Missing tags → refuses with `pack_invalid`.

### Governing Docs

- ADR-0013 — agent invocation and integration boundaries.
- ADR-0019 — opencode local Qwen implementation runtime.
- `docs/process/coding-agent-preflight.md`.
- `docs/process/dispatcher-eligibility-policy.md`.

---

## 3. QA Agent

### Purpose

Verifies that a code-producing run delivered what the ticket specified. The QA agent reads the run's PR, the ticket's acceptance criteria, and the relevant code, then runs tests and checks the actual diff against the expected outcome.

### Inputs

- **Ticket** — the agent-ready ticket with acceptance criteria.
- **Acceptance criteria** — the specific, testable conditions the ticket defines.
- **PR** — the pull request produced by the coding agent (or a prior QA run).
- **Test harness** — the agent-evaluation harness (`packages/agent-bench/` or equivalent).

### Outputs

- **QA report** — structured pass/fail per acceptance criterion (`docs/templates/qa-report.md`).
- **Evidence** — test logs, diff inspection results, and any failures with reproduction steps.
- **Linear write-back** — QA verdict, linked evidence, any open questions.

### Autonomy Level

- **Pilot: L3-with-approval.** Human approves each QA dispatch.
- **Can be autonomous (L4)** once confidence is established — the agent can run QA end-to-end and produce a report without human intervention. Still requests merge only after passing QA.

### Risk Profile

- **Risk: Medium.**
  - False pass (agent misses a failing criterion) → downstream bug, caught at code review or merge.
  - False fail (agent incorrectly rejects a valid PR) → wasted effort, caught at human review.
  - Test harness dependency — QA quality is bounded by the quality of the test harness.
  - Not destructive — QA runs against a branch PR, not production.

### Dispatch Timing

- Runs **after** the coding agent opens a PR, **before** merge is requested.
- May run **in parallel** with PR review agent on the same PR.

### Governing Docs

- ADR-0007 — QA review evidence workflow.
- `docs/templates/qa-report.md`.
- `packages/agent-bench/README.md` (evaluation harness).

---

## 4. PR Review Agent

### Purpose

Reviews a PR for structural quality, architectural consistency, and code hygiene. Unlike the QA agent (which checks "did it do what it was supposed to?"), the PR review agent checks "is this the right change, done well?"

### Inputs

- **PR** — the pull request to review, including its diff, title, description, and linked Linear issue.
- **ADR / PRD context** — architectural and product requirements the PR should conform to.

### Outputs

- **Review findings** — structured report (`docs/templates/pr-review-report.md`) covering:
  - Code quality (naming, structure, readability).
  - Architectural fit (conforms to accepted ADRs, follows ICP conventions).
  - Correctness (no obvious bugs, edge cases handled).
  - Cost awareness (reasonable context usage, no runaway loops).
  - Linear compliance (PR title key, body references, linking convention).
- **Linear write-back** — review verdict, findings, and any action items.

### Autonomy Level

- **Pilot: L3-with-approval.** Human approves each PR review dispatch.
- **Can be L4** — autonomous review that produces a report and gates on human approval for merge.

### Risk Profile

- **Risk: Low–Medium.**
  - Missed structural issue → minor technical debt, caught at merge or later.
  - Overly strict review → slows velocity, but not incorrect.
  - Subjectivity — different reviewers may disagree on "good code"; the report captures reasoning so disagreements are auditable.
  - Not destructive — review happens before merge.

### Dispatch Timing

- Runs **in parallel** with QA agent (or sequentially; both must pass before merge is requested).
- May run on every push to a PR, not just the final version.

### Governing Docs

- ADR-0007 — QA review evidence workflow.
- `docs/templates/pr-review-report.md`.
- `docs/process/qa-review-evidence.md`.

---

## 5. SRE / Deploy Agent

### Purpose

Deploys a merged change to a target environment. The SRE/deploy agent reads the deploy configuration, validates the environment, executes the deploy, and reports the result.

### Inputs

- **Deploy config** — the deployment specification (target environment, build commands, deploy steps, rollback procedure).
- **Environment** — the target environment details (e.g., staging, production), including credentials and secrets.
- **Merged PR** — the change being deployed (usually referenced by the merged commit or the Linear issue key).

### Outputs

- **Deploy status** — success, failure, or partial deploy result.
- **Deployment logs** — build output, deploy steps, and any error messages.
- **Rollback result** — if the deploy failed, whether rollback succeeded.
- **Linear write-back** — deploy status, linked evidence, risk flags, next action.

### Autonomy Level

- **Pilot: L3-with-approval.** Human approves each deploy dispatch.
- **Target: L4.** Autonomous deploy to staging; production deploy remains L3-with-approval during pilot.

### Risk Profile

- **Risk: High.**
  - Wrong deploy config → breaks the target environment.
  - Uncaught breaking change → production regression.
  - Runaway cost from failed deploy retries → ADR-0009 interrupt.
  - Rollback failure → extended outage.
  - Destructive — a bad deploy can break production.
  - Deploy is a **Stop** action per ADR-0008's rule matrix — always requires human approval during the pilot.

### Dispatch Eligibility

- Runs **after** PR merge.
- Must pass both QA and PR review gates before deploy is requested.
- Runaway-cost halt on any ticket requires explicit Ben unblock before re-dispatch.

### Governing Docs

- ADR-0009 — cost controls and runaway-cost interrupts.
- ADR-0008 — Stop list (deploy is Stop).
- `docs/process/cost-controls.md`.
- `docs/templates/agent-run-report.md`.

---

## 6. Agent Type Comparison Matrix

| Aspect | Coding | QA | PR Review | SRE / Deploy |
|---|---|---|---|---|
| **Primary job** | Implement code from tickets | Verify acceptance criteria | Review PR quality | Deploy merged changes |
| **Triggers on** | Agent-ready ticket | PR from coding agent | PR from coding agent | Merged PR |
| **Inputs** | Diffs, repo, branch, ticket, docs | Ticket, acceptance criteria, PR, harness | PR, ADR/PRD context | Deploy config, env, merged PR |
| **Outputs** | PR, run report, Linear write-back | QA report, evidence, Linear write-back | Review report, findings, Linear write-back | Deploy status, logs, rollback result, Linear write-back |
| **Autonomy (pilot)** | L3-with-approval | L3-with-approval | L3-with-approval | L3-with-approval |
| **Target autonomy** | L4 | L4 | L4 | L4 (staging L4, prod L3) |
| **Risk** | Medium | Medium | Low–Medium | High |
| **Destructive?** | No (branch only) | No | No | Yes (production impact) |
| **Runs before merge?** | Yes | Yes (parallel) | Yes (parallel) | No |
| **Runs after merge?** | No | No | No | Yes |
| **Runway-cost risk** | Elevated if large context | Normal (test runs) | Normal (diff review) | Elevated (retry loops, infra spend) |
| **Preflight needed?** | Yes (coding-agent-preflight.md) | Ticket acceptance criteria present | PR exists and is reviewable | Deploy config and env present |

---

## 7. Dispatch Flow

The agents operate in a pipeline:

```
Intake → Triage → Scoping → Dispatch → Coding Agent → [QA Agent + PR Review Agent] (parallel)
  ↓
Merge (human) → SRE/Deploy Agent → Retro
```

1. **Intake.** Raw input from Perplexity, mobile, GitHub comments, or Linear comments.
2. **Triage.** Routes to PRD, epic, ticket, or ADR.
3. **Scoping.** Tickets become agent-ready with a ticket pack (LAT-104), classification tags (LAT-134), and budget cap.
4. **Dispatch.** The ICP dispatcher (LAT-129) selects a ticket and routes it to the appropriate agent based on complexity and reasoning tags.
5. **Coding Agent** implements the ticket, opens a PR.
6. **QA Agent and PR Review Agent** run in parallel against the PR.
7. **Human** reviews, merges (pilot default: human merge).
8. **SRE/Deploy Agent** deploys the merged change.
9. **Retro** captures learnings for the learning loop (ADR-0010).

---

## 8. Future Agent Types (Planned)

The catalog is extensible. Potential future agent types:

| Agent Type | Purpose | Autonomy | Risk | Status |
|---|---|---|---|---|
| **Research / spike agent** | Explore a topic, produce findings or a spike PR | L1–L2 | Low | Planned (LAT-119) |
| **Perplexity reasoning agent** | Architecture decisions, PRD drafting, synthesis | L1–L2 | Low–Medium | Active (via Perplexity) |
| **Ops / incident agent** | Detect and respond to deployment failures | L2–L3 | Medium | Planned |
| **Cost optimization agent** | Monitor spend, suggest optimizations | L1 | Low | Planned |

These are not part of the MVP. They are tracked as future Linear issues and will be added to this catalog when their contracts are defined.

---

## 9. Sequencing

Hard blockers: none
Recommended predecessors: none
Related context: LAT-26 (QA harness), LAT-129 (dispatcher), LAT-133 (dispatch loop), LAT-134 (classification tags)
Dispatch status: ready

---

## Related

- Root PRD: [`root-agentic-development-flywheel.md`](root-agentic-development-flywheel.md)
- ADRs: `docs/decisions/0008-agent-control-layer-and-perplexity-boundary.md` (action categories, autonomy levels, Stop list), `0009-cost-controls-and-runaway-cost-interrupts.md` (cost bands), `0013-agent-invocation-and-integration-boundaries.md` (invocation categories), `0019-opencode-local-qwen-implementation-runtime.md` (local agent runtime)
- Process: `docs/process/approval-gates-and-autonomy-rules.md`, `docs/process/dispatcher-eligibility-policy.md`, `docs/process/coding-agent-preflight.md`, `docs/process/cost-controls.md`
- Templates: `docs/templates/agent-run-report.md`, `docs/templates/qa-report.md`, `docs/templates/pr-review-report.md`
- Linear: LAT-26 (QA harness), LAT-119 (research spikes), LAT-129 (dispatcher), LAT-133 (dispatch loop), LAT-134 (classification tags)
