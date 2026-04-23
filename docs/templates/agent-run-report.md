# Agent Run Report

> Canonical agent-run envelope for the pilot. Schema is governed by **ADR-0006** (agent run visibility schema). The high-fidelity trace store is deferred to a follow-up ADR (see ADR-0003 open questions). Until that substrate exists, this run report — in the PR body, a PR comment, or a committed file — is the canonical form, and Linear receives a bounded write-back with links.

## Applicability

One envelope for all agent types in the pilot: `coding`, `qa`, `review`, `sre`, `pm`, `research`, `observability`. Agent-type-specific fields live inside the open sub-objects (`agent_metadata`, `cost`, `correlation`) or in the narrative sections — **not** as new top-level keys.

## Envelope (JSON)

Required core fields: `run_id`, `agent_type`, `status`, `started_at`, `ended_at`, and `schema_version`. All other fields are optional and forward-compatible. Adding a field is a non-breaking change; renaming or removing a field is ADR-worthy. Consumers must ignore fields they do not recognize.

`schema_version` is a SemVer string the run recorder stamps on every envelope. LAT-36 set it to `"1.0.0"` (first version that matches this template verbatim). Major-bump on any rename or removal; minor-bump on any new sub-object surface; patch-bump on a clarifying edit that does not change producer or consumer code. The canonical value lives in `packages/icp/src/runtime/contract.ts` as `RUN_REPORT_SCHEMA_VERSION`.

`agent_type` enumerates exactly seven values (`coding | qa | review | sre | pm | research | observability`). **`retro` is not an agent type.** Retros are a process artefact (ADR-0010 / `docs/templates/retro-report.md`), not a runnable agent invocation; a retro run is recorded under `pm` or `research` depending on who authored it.

```json
{
  "schema_version": "1.0.0",
  "run_id": "run_...",
  "agent_type": "coding | qa | review | sre | pm | research | observability",
  "triggered_by": "user | linear_status | schedule | webhook | agent | github_comment | hook | mcp",
  "linear_issue_id": "LAT-XXX",
  "project_id": "linear_project_uuid",
  "input_artifacts": [],
  "output_artifacts": [],
  "status": "started | succeeded | failed | cancelled | needs_human",
  "risk_level": "low | medium | high",
  "cost_band": "normal | elevated | runaway_risk",
  "approval_required": false,
  "autonomy_level": "L1-read-only | L2-propose | L3-with-approval | L4-autonomous",
  "summary": "",
  "decisions": [],
  "tests_run": [],
  "errors": [],
  "next_actions": [],
  "started_at": "",
  "ended_at": "",

  "agent_metadata": {
    "model": "claude-opus-4-7",
    "model_provider": "anthropic",
    "reasoning_effort": "low | medium | high | none",
    "thinking_tokens": 0,
    "temperature": null,
    "max_output_tokens": null,
    "system_prompt_version": "",
    "skill_versions": {},
    "tool_allowlist": [],
    "runtime": {
      "harness": "claude-code | sdk | other",
      "harness_version": "",
      "sandbox": "local | container | worktree | remote",
      "os": "",
      "working_dir": ""
    }
  },

  "cost": {
    "budget_cap_usd": null,
    "spent_usd": null,
    "input_tokens": 0,
    "output_tokens": 0,
    "cached_tokens": 0,
    "band": "normal | elevated | runaway_risk"
  },

  "correlation": {
    "parent_run_id": null,
    "trace_id": null,
    "session_id": null,
    "linear_project_id": null,
    "pr_url": null,
    "pr_branch": null,
    "commit_sha": null,
    "github_comment_url": null
  }
}
```

### Field notes by agent type

All types share the envelope above; the fields below are the ones each type should prioritize populating.

- **coding** — `correlation.pr_url`, `correlation.pr_branch`, `correlation.commit_sha`, `tests_run`, `output_artifacts` (changed files). `summary` should state scope of change.
- **qa** — `tests_run` (with per-test status), `errors`, `correlation.pr_url` of the PR under test, `risk_level`.
- **review** — `decisions` (approve / request changes / comment), `correlation.pr_url`, `correlation.github_comment_url`, `next_actions` for the PR author.
- **sre** — `correlation.trace_id` and/or a paged-alert ID inside `correlation` (agreed key), `errors`, `risk_level`, `next_actions` (runbook steps taken / recommended).
- **pm** — `output_artifacts` (PRD URL, ticket URLs), `decisions` (scope calls), `linear_issue_id` when refining a specific issue.
- **research** — `output_artifacts` (source URLs and derived artifacts), `decisions` (recommendations), `summary` with the headline finding.
- **research / observability dashboards, alerts, SLO checks** — `output_artifacts` (dashboard / alert URLs), `decisions` (thresholds changed), `risk_level` for surfaced regressions.

### Extensibility

Treat `agent_metadata`, `cost`, and `correlation` as open objects. Add keys when a new signal is needed; do not add new top-level keys without an ADR. Consumers (Linear formatter, future telemetry substrate, Perplexity) must tolerate unknown keys.

## Human-readable summary

- **Run ID:**
- **Agent type:**
- **Model / reasoning:** e.g. `claude-opus-4-7`, reasoning=`medium`
- **Autonomy level:** one of `L1-read-only | L2-propose | L3-with-approval | L4-autonomous` (ADR-0008)
- **Linear issue:** LAT-XX
- **Status:**
- **Started / ended:**
- **Cost band:**
- **Budget state:** within cap | elevated | exceeded
- **PR link (if any):** PR title must be prefixed with the Linear issue key (e.g. `LAT-13: ...`); body must reference the issue. See `docs/process/operating-model.md` → *PR ↔ Linear linking convention*.
- **PR branch / commit:**
- **Files changed:**
- **Tests run / results:**
- **QA result:** link to `qa-report.md` (see ADR-0007); include recommendation verbatim.
- **Review result:** link to `pr-review-report.md` (see ADR-0007); include recommendation verbatim.
- **Risks surfaced:**
- **Next action:**

## Narrative

One or two paragraphs. What did the agent set out to do, what did it do, and what should a human pay attention to?

If the run crossed a **context / chat compaction event** and is shipping a change whose rationale was in the pre-compaction context, record here (per [ADR-0015](../decisions/0015-context-compaction-and-agent-handoff-policy.md) Rule 2): *when* the compaction happened, *what* was compacted, and *where the pre-compaction content is durable* — a link to the ADR / process doc / PRD / template / named paragraph in this run report that preserves the load-bearing content, or an explicit statement that the content was not durably preserved because it was not load-bearing. A shipped change whose rationale now resolves only to chat is a preflight refuse (`docs/process/coding-agent-preflight.md` § C).

If the run is a spike that produced **no implementation PR**, state the spike's terminal state (ADR-0015 Rule 4): *findings promoted* (link the promotion PR and the durable surface) or *explicitly archived* (with a one-line rationale for not promoting).

## Evidence

- Artifacts produced.
- External trace / log links.
- Diffs, screenshots, or metrics relevant to acceptance.
- Handoff packet (ADR-0015 Rule 1): confirm current goal, active tickets, open PRs, blockers, prior decisions (with durable links), next action, and open questions are all present in this report + the PR body + the Linear write-back. References to prior rationale must resolve to a durable surface, not to chat.

## Human follow-up required

- [ ] Approval to merge.
- [ ] Approval to deploy.
- [ ] Resolution of open risk or question.
- [ ] None.

## Linear write-back (paste this into the issue comment)

Bounded summary per the ADR-0003 write-back contract and the ADR-0006 envelope→comment mapping. Keep it scannable — see the comment size/shape guideline in ADR-0003. Everything else stays in this run report, the PR, or the future telemetry substrate.

The ADR-0003 contract names **five elements** (outcome, evidence, risks, PR, next action + open questions); the render below emits **six lines** because the fifth element splits into an explicit `Next action` line and an explicit `Open questions` line so either can be `"none"` without ambiguity. The write-back formatter (`packages/icp/src/adapters/write-back-formatter.ts`) produces exactly these six lines; renderers and reviewers should treat any other shape as non-conforming.

```md
**Outcome:** <one or two sentences on what happened>
**Evidence:** <PR URL> · <run report URL> · <other artifacts>
**Risks:** <risk flags, including cost band if elevated; "none" is fine>
**PR:** <PR URL, or "n/a">
**Next action:** <single recommended next step>
**Open questions:** <blocking questions, or "none">
```

Mapping from envelope fields to comment lines:

- `Outcome` ← `summary`.
- `Evidence` ← `correlation.pr_url` + run-report URL + selected `output_artifacts`.
- `Risks` ← `risk_level`, and `cost_band` if not `normal`, plus any flagged `errors`.
- `PR` ← `correlation.pr_url`.
- `Next action` ← first entry in `next_actions`.
- `Open questions` ← unresolved items needing human input.

Do not paste `decisions`, `tests_run`, raw traces, or `agent_metadata` into the Linear comment. Link them via the run report URL.

## Visibility questions this envelope must answer

The run report is considered sufficient if, across a set of runs, Perplexity (or any reader of these reports + Linear + GitHub) can answer the following without bespoke tooling. See ADR-0006 for the full rationale.

1. **What are agents currently doing?** — recent runs by `agent_type`, `linear_issue_id`, `status`, `started_at`, `summary`.
2. **What is blocked, and on what?** — runs with `status = needs_human`, plus open `next_actions` and Linear write-back `Open questions`, grouped by `linear_issue_id`.
3. **Which runs are costly, and why?** — runs with `cost_band != normal` or `risk_level = high`, segmented by `agent_type` and `agent_metadata.model`, sorted by `cost.spent_usd`.
4. **Where are agents failing repeatedly?** — runs with `status = failed` grouped by `agent_type` and by `linear_issue_id` / `correlation.pr_branch`.
5. **What changed in the last <window>?** — runs filtered by `started_at`, grouped by `agent_type` and `status`.

If a new operational question cannot be answered from the envelope, that is the trigger to extend the schema — open sub-object when possible, ADR when a top-level change is needed.
