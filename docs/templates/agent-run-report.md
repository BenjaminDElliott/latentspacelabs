# Agent Run Report

> Minimum envelope for every agent run. The canonical high-fidelity trace should live in a dedicated telemetry substrate (see ADR-0003). Linear receives a short summary with links; this template is the structure the summary and the full report both follow.

## Envelope (JSON)

All fields other than `run_id`, `agent_type`, `status`, `started_at`, and `ended_at` are optional and forward-compatible. New fields may be added over time; consumers must ignore fields they do not recognize.

```json
{
  "run_id": "run_...",
  "agent_type": "coding | qa | review | sre | pm | research | observability",
  "triggered_by": "user | linear_status | schedule | webhook | agent | github_comment",
  "linear_issue_id": "LAT-XXX",
  "project_id": "linear_project_uuid",
  "input_artifacts": [],
  "output_artifacts": [],
  "status": "started | succeeded | failed | cancelled | needs_human",
  "risk_level": "low | medium | high",
  "cost_band": "normal | elevated | runaway_risk",
  "approval_required": false,
  "autonomy_level": "suggest | review_required | auto_with_gate | full_auto",
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

### Extensibility note

Treat `agent_metadata`, `cost`, and `correlation` as open objects. Adding a key is a minor, non-breaking change; renaming or removing a key is a breaking change and should be ADR-worthy. Consumers of this envelope (Linear formatter, telemetry substrate) should tolerate unknown keys.

## Human-readable summary

- **Run ID:**
- **Agent type:**
- **Model / reasoning:** e.g. `claude-opus-4-7`, reasoning=`medium`
- **Autonomy level:**
- **Linear issue:** LAT-XX
- **Status:**
- **Started / ended:**
- **Cost band:**
- **Budget state:** within cap | elevated | exceeded
- **PR link (if any):** PR title must be prefixed with the Linear issue key (e.g. `LAT-13: ...`); body must reference the issue. See `docs/process/operating-model.md` → *PR ↔ Linear linking convention*.
- **PR branch / commit:**
- **Files changed:**
- **Tests run / results:**
- **QA result:**
- **Review result:**
- **Risks surfaced:**
- **Next action:**

## Narrative

One or two paragraphs. What did the agent set out to do, what did it do, and what should a human pay attention to?

## Evidence

- Artifacts produced.
- External trace / log links.
- Diffs, screenshots, or metrics relevant to acceptance.

## Human follow-up required

- [ ] Approval to merge.
- [ ] Approval to deploy.
- [ ] Resolution of open risk or question.
- [ ] None.
