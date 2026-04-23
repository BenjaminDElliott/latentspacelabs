# Agent Run Report

> Minimum envelope for every agent run. The canonical high-fidelity trace should live in a dedicated telemetry substrate (see ADR-0003). Linear receives a short summary with links; this template is the structure the summary and the full report both follow.

## Envelope (JSON)

```json
{
  "run_id": "run_...",
  "agent_type": "coding | qa | review | sre | pm | research | observability",
  "triggered_by": "user | linear_status | schedule | webhook | agent",
  "linear_issue_id": "LAT-XXX",
  "project_id": "linear_project_uuid",
  "input_artifacts": [],
  "output_artifacts": [],
  "status": "started | succeeded | failed | cancelled | needs_human",
  "risk_level": "low | medium | high",
  "cost_band": "normal | elevated | runaway_risk",
  "approval_required": false,
  "summary": "",
  "decisions": [],
  "tests_run": [],
  "errors": [],
  "next_actions": [],
  "started_at": "",
  "ended_at": ""
}
```

## Human-readable summary

- **Run ID:**
- **Agent type:**
- **Linear issue:** LAT-XX
- **Status:**
- **Started / ended:**
- **Cost band:**
- **Budget state:** within cap | elevated | exceeded
- **PR link (if any):**
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
