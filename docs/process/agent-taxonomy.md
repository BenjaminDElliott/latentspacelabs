# Agent Taxonomy

> Canonical inventory of all agent types that plug into the Integration
> Control Plane (ICP) as execution adapters.

## Why this document exists

LAT-161 requires us to establish a shared taxonomy of agent types before
designing provider-specific interfaces. This document catalogs every planned
agent type with its purpose, autonomy level, risk profile, invocation pattern,
typical inputs, and typical outputs.

This is a **taxonomy** — it describes *what* each agent does, not *how* it is
implemented. Concrete provider bindings live in `packages/icp/src/adapters/`
(e.g. the coding-agent adapter), while this document is the shared reference
for humans and agents alike.

## Predecessors

- **LAT-21 (Done)**: Agent invocation and integration boundaries — ADR-0013
  defines the four action categories (P-Direct, P-Propose, ICP-Routed, Stop)
  and autonomy levels (L1–L4 for the pilot). This document applies those
  categories to each agent type.
- **ADR-0008**: Autonomy levels and action categories.
- **ADR-0006**: Agent run visibility schema — defines the `agent_type` enum
  that this taxonomy extends.

## Classification model

Every registered agent type has six attributes:

| Attribute             | Values / Description                                                                                                         |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------|
| **id**                | Stable identifier matching the ADR-0006 `agent_type` enum (`coding`, `qa`, `pr-review`, `sre`).                              |
| **purpose**           | One-sentence description of what the agent does.                                                                             |
| **autonomy_level**    | ADR-0008 autonomy level at which the agent typically operates (`L1-read-only` through `L4-autonomous`).                       |
| **risk_profile**      | Destructiveness of the agent's typical actions (`low`, `medium`, `high`, `critical`).                                        |
| **invocation_pattern**| How the agent is typically triggered (`direct`, `proposed`, `acl-routed`, `stop-and-ask`).                                   |
| **typical_inputs**    | What the agent needs to run (from Linear, Git, or other surfaces).                                                           |
| **typical_outputs**   | What the agent produces (PR, report, deploy status, etc.).                                                                   |

## Registered agent types

### 1. Coding Agent (`coding`)

| Attribute         | Value                                                                                           |
|-------------------|-------------------------------------------------------------------------------------------------|
| **purpose**       | Reads a LAT ticket, implements the required changes in the repo, and opens a PR linking back to the ticket. |
| **autonomy_level**| `L3-with-approval` — dispatch requires explicit human approval during the pilot.                |
| **risk_profile**  | `medium` — changes the codebase but produces a PR for review before merge.                      |
| **invocation_pattern** | `acl-routed` — goes through ICP dispatch logic, which verifies blockers, budget cap, and ticket shape. |
| **typical_inputs** | `linear_issue_id` (LAT-XXX), `ticket_title`, `ticket_summary`, `guardrails`, `non_goals`, `repo` (owner/name), `branch_target`, `budget_cap_usd`. |
| **typical_outputs**| `pr_url`, `pr_branch`, `commit_sha`, `changed_files`, `run_report`, `linear_write_back`.         |

**Invocation:** The ICP dispatcher selects a dispatch-ready `LAT-*` issue, verifies the ADR-0013 minimum run contract (approval, repo, budget cap, ticket context, skill version), and invokes the coding-agent adapter. The adapter delegates to a configured provider (currently a local command harness). The provider opens a PR and returns structured evidence.

**Risk controls:**
- Budget cap enforced by ADR-0009 (LAT-21).
- PR requires human approval for merge.
- Runaway-cost interrupt halts the agent (ADR-0009 / `cost-controls.md`).

---

### 2. QA Agent (`qa`)

| Attribute         | Value                                                                                           |
|-------------------|-------------------------------------------------------------------------------------------------|
| **purpose**       | Receives a PR or ticket, runs the test suite or a QA procedure, and produces a quality report with a pass/fail recommendation. |
| **autonomy_level**| `L2-propose` — can run tests and produce a report without approval, but the recommendation is a proposal. |
| **risk_profile**  | `low` — reads the codebase and runs tests; does not modify shared state.                        |
| **invocation_pattern** | `acl-routed` — dispatched by ICP with a PR URL or ticket ID.                                |
| **typical_inputs** | `pr_url` or `linear_issue_id`, `branch_name`, `test_commands` (optional), `coverage_threshold` (optional). |
| **typical_outputs**| `qa_report`, `pass/fail` verdict, `test_results`, `coverage_report`, `recommendation` (approve / request-changes / comment). |

**Invocation:** ICP receives a request to run QA on a PR. The QA agent clones the branch, runs the test suite, collects coverage metrics, and produces an ADR-0007-style QA report. Results are posted to the PR or a Linear comment.

**Risk controls:**
- Non-destructive: only reads and runs tests.
- Report is a proposal, not a binding decision.
- Cost is bounded by test execution time.

---

### 3. PR Review Agent (`pr-review`)

| Attribute         | Value                                                                                           |
|-------------------|-------------------------------------------------------------------------------------------------|
| **purpose**       | Reviews a PR for correctness, style, and alignment with the ticket; surfaces comments or approval decisions. |
| **autonomy_level**| `L2-propose` — can surface comments and a recommendation without approval.                      |
| **risk_profile**  | `low` — reads the diff and posts comments; does not modify the codebase.                        |
| **invocation_pattern** | `acl-routed` — dispatched by ICP with a PR URL.                                           |
| **typical_inputs** | `pr_url`, `ticket_summary` (for alignment check), `review_guidelines` (optional).             |
| **typical_outputs**| `review_comments`, `verdict` (approve / request-changes / comment), `suggested_changes`, `risk_flags`. |

**Invocation:** ICP dispatches the review agent with a PR URL. The agent reads the diff, compares it against the ticket summary, checks for style and correctness, and posts review comments to the PR. The verdict is a proposal for the human reviewer.

**Risk controls:**
- Non-destructive: only reads and comments.
- Review agent is never authorized to approve a PR (ADR-0013 rule matrix).
- Review comments are human-readable and actionable.

---

### 4. SRE / Deploy Agent (`sre`)

| Attribute         | Value                                                                                           |
|-------------------|-------------------------------------------------------------------------------------------------|
| **purpose**       | Manages infrastructure lifecycle: deploys artifacts to target environments, monitors health, and runs runbooks on incidents. |
| **autonomy_level**| `L3-with-approval` — deployment requires explicit human approval during the pilot.              |
| **risk_profile**  | `high` — modifies live infrastructure; a bad deploy can cause outages.                          |
| **invocation_pattern** | `acl-routed` — dispatched by ICP with a deploy request or incident alert.                   |
| **typical_inputs** | `deploy_request` or `incident_alert`, `target_environment` (staging / production), `artifact_url` or `commit_sha`, `runbook` (optional). |
| **typical_outputs**| `deploy_status`, `health_check_results`, `alert_fires`, `runbook_steps_completed`, `rollback_url` (if applicable). |

**Invocation:** ICP dispatches the SRE agent with a deploy request (triggered by a human, a schedule, or a PR merge). The agent runs the deployment pipeline, monitors health checks, and produces a deploy report. On incidents, the agent runs the prescribed runbook and reports results.

**Risk controls:**
- Deployment requires human approval (L3).
- Health checks verify the deploy succeeded before declaring success.
- Rollback URL is included in the report.
- Runaway-cost interrupt applies to long-running deployments.

---

## Autonomy level reference

Per ADR-0008, the pilot autonomy levels are:

| Level | Name                | What's enabled                                                                                      |
|-------|---------------------|-----------------------------------------------------------------------------------------------------|
| L1    | Observe / draft only | Read and draft. No external writes.                                                                 |
| L2    | Bounded writes       | Create/update Linear issues, add comments, open PRs. No project creation. No native-relation writes. |
| L3    | Agent dispatch       | ICP selects a dispatchable `LAT-*` issue; a coding/QA/review agent starts only after explicit human go. |
| L4    | Autonomous           | Dispatched agent executes end-to-end, opens a PR, requests review. Merge still requires human approval. |
| L5    | Autonomous merge     | Out of scope for the pilot.                                                                        |

Each agent type's autonomy level is set to balance speed with safety:
- **Low-risk agents** (qa, pr-review) run at L2 so they can operate without per-invocation approval.
- **Medium/high-risk agents** (coding, sre) run at L3 so the human operator approves each dispatch.

## Invocation pattern reference

Per ADR-0008 / LAT-21, the four action categories:

| Pattern        | Meaning                                                                                       |
|----------------|-----------------------------------------------------------------------------------------------|
| `direct`       | ICP dispatches without extra steps.                                                           |
| `proposed`     | Human proposes then confirms.                                                                 |
| `acl-routed`   | Goes through ICP routing logic (dispatch algorithm, policy evaluation, evidence recording).   |
| `stop-and-ask` | Always halts for human before acting.                                                         |

All four registered agent types use `acl-routed` invocation: the ICP dispatcher handles precondition checks, policy evaluation, and evidence recording before invoking the agent's provider.

## Risk profile reference

| Profile  | Meaning                                                                        |
|----------|--------------------------------------------------------------------------------|
| `low`    | Non-destructive; can be rolled back or repeated easily.                        |
| `medium` | Modifies the codebase; requires PR review before merge.                        |
| `high`   | Modifies live infrastructure; a failure can cause an outage.                   |
| `critical` | Modifies production data or state; failure is expensive to recover from.     |

## Extensibility

When a new agent type is proposed (e.g. `pm`, `research`, `observability`), use the classification heuristic in `packages/icp/src/adapters/agent-taxonomy.ts` (`classifyNewAgentType()`) to determine if it fits an existing classification:

| Match         | Keywords in purpose / domain                                          |
|---------------|-----------------------------------------------------------------------|
| `coding`      | "code", "implement", "code-generation", "write"                       |
| `qa`          | "test", "qa", "quality", "testing", "run suite"                       |
| `pr-review`   | "review", "pr", "pull request", "code-review"                         |
| `sre`         | "deploy", "infra", "infrastructure", "ops", "runbook"                 |

A match with confidence ≥ 0.25 means the new type fits an existing classification. Below that, add a new row to this document and a new entry in `AGENT_TYPES`.

Adding a type is non-breaking — consumers must tolerate unknown types. Removing or renaming a type requires an ADR.

## Relationship to ADR-0006 `agent_type` enum

ADR-0006 defines `agent_type` as an enum with seven values: `coding`, `qa`, `review`, `sre`, `pm`, `research`, `observability`. This taxonomy covers the four primary execution agents (`coding`, `qa`, `pr-review`/`review`, `sre`). The remaining types (`pm`, `research`, `observability`) are process/support agents that may be added to this document in follow-up tickets.

Note: `retro` is **not** an agent type (ADR-0010) — retros are a process artifact recorded under `pm` or `research` depending on who authored them.

## Related

- **LAT-21** (Done): Agent invocation and integration boundaries — ADR-0013
- **ADR-0006**: Agent run visibility schema
- **ADR-0008**: Autonomy levels and action categories
- **ADR-0010**: Retrospective learning loop
- **ADR-0013**: Agent invocation and integration boundaries (renamed from ACL)
- `packages/icp/src/adapters/agent-taxonomy.ts` — machine-readable taxonomy
- `packages/icp/src/adapters/agent-taxonomy.test.ts` — taxonomy tests
