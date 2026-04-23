/**
 * Run recorder (ADR-0012 § "Run recorder", ADR-0006, ADR-0014).
 *
 * Produces the ADR-0006 run-report envelope (Markdown + JSON). ADR-0014 pins
 * the MVP destination to a repo-committed `runs/` tree; actually writing the
 * file is left to the caller (or the future telemetry substrate). This module
 * returns the serialised artefacts plus their conventional path so the
 * dispatch skill, tests, and the CLI can decide how to persist them.
 */
import { randomUUID } from "node:crypto";
import {
  RUN_REPORT_SCHEMA_VERSION,
  type RunRecorder,
  type RunRecorderInput,
  type RunRecorderOutput,
  type RunReport,
  type RunReportStatus,
} from "../runtime/contract.js";

export function createRunRecorder(): RunRecorder {
  return {
    async record(input: RunRecorderInput): Promise<RunRecorderOutput> {
      const runId = `run_${randomUUID()}`;
      const status = mapVerdictToStatus(input);
      const report: RunReport = {
        schema_version: RUN_REPORT_SCHEMA_VERSION,
        run_id: runId,
        agent_type: "coding",
        status,
        triggered_by: "user",
        linear_issue_id: input.linear_issue_id,
        autonomy_level: input.autonomy_level,
        started_at: input.started_at.toISOString(),
        ended_at: input.ended_at.toISOString(),
        summary: input.summary,
        decisions: input.reasons,
        next_actions: [input.next_action],
        errors: input.agent_result?.exit_signal === "failed" ? ["agent run failed"] : [],
        cost: {
          band: input.agent_result?.cost_band ?? "unknown",
          budget_cap_usd: input.budget_cap_usd,
          spent_usd: input.agent_result?.spent_usd ?? null,
          band_unavailable_reason: costBandUnavailableReason(input),
        },
        correlation: {
          pr_url: input.agent_result?.pr_url ?? null,
          pr_branch: input.agent_result?.pr_branch ?? null,
          commit_sha: input.agent_result?.commit_sha ?? null,
          linear_comment_url: null,
        },
      };

      const path = `runs/${runId}.md`;
      return {
        report,
        markdown: renderMarkdown(report, input),
        json: JSON.stringify(report, null, 2),
        path,
      };
    },
  };
}

function mapVerdictToStatus(input: RunRecorderInput): RunReportStatus {
  if (input.dry_run) return "succeeded";
  if (input.verdict === "blocked" || input.verdict === "stop") return "needs_human";
  if (!input.agent_result) return "needs_human";
  switch (input.agent_result.exit_signal) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "needs_human":
      return "needs_human";
  }
}

function renderMarkdown(report: RunReport, input: RunRecorderInput): string {
  const lines: string[] = [];
  lines.push(`# Agent Run Report: ${report.run_id}`);
  lines.push("");
  lines.push(`- **Run ID:** ${report.run_id}`);
  lines.push(`- **Agent type:** ${report.agent_type}`);
  lines.push(`- **Autonomy level:** ${report.autonomy_level}`);
  lines.push(`- **Linear issue:** ${report.linear_issue_id}`);
  lines.push(`- **Status:** ${report.status}`);
  lines.push(`- **Started / ended:** ${report.started_at} / ${report.ended_at}`);
  lines.push(`- **Cost band:** ${report.cost.band}`);
  lines.push(
    `- **Budget state:** ${formatBudgetState(report.cost.budget_cap_usd, report.cost.spent_usd)}`,
  );
  lines.push(`- **PR link:** ${report.correlation.pr_url ?? "n/a"}`);
  lines.push(`- **PR branch / commit:** ${report.correlation.pr_branch ?? "n/a"} / ${report.correlation.commit_sha ?? "n/a"}`);
  lines.push("");
  lines.push("## Narrative");
  lines.push("");
  lines.push(input.summary);
  if (input.dry_run) {
    lines.push("");
    lines.push("_Dry-run: policy evaluated only; no agent was invoked and no Linear write-back was posted._");
  }
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  for (const r of report.decisions) lines.push(`- ${r}`);
  if (report.decisions.length === 0) lines.push("- (no decisions recorded)");
  lines.push("");
  lines.push("## Next action");
  lines.push("");
  lines.push(`- ${report.next_actions[0] ?? "n/a"}`);
  lines.push("");
  lines.push("## Open questions");
  lines.push("");
  if (input.open_questions.length === 0) {
    lines.push("- none");
  } else {
    for (const q of input.open_questions) lines.push(`- ${q}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * LAT-66: record an explicit, secret-safe reason when the effective cost band
 * is `unknown`. For dry-runs and policy refusals no agent ran, so the band is
 * unknown-by-construction. For real agent runs, honour the provider's own
 * `cost_band_unavailable_reason` when present; otherwise surface a generic
 * "provider did not report a cost band" note. `null` when the band is
 * determinable (`normal` / `elevated` / `runaway_risk`).
 */
function costBandUnavailableReason(input: RunRecorderInput): string | null {
  const res = input.agent_result;
  if (!res) {
    if (input.dry_run) return "dry-run: no agent invocation; no spend to record";
    return "no agent run was invoked (policy refused or pre-dispatch abort)";
  }
  if (res.cost_band !== "unknown") return null;
  const providerReason = res.cost_band_unavailable_reason;
  if (typeof providerReason === "string" && providerReason.trim().length > 0) {
    return providerReason.trim();
  }
  return "provider returned no cost-band evidence (ADR-0009 unknown state)";
}

function formatBudgetState(cap: number | null, spent: number | null): string {
  if (cap === null) return "cap missing";
  if (spent === null) return "within cap (spend unknown)";
  if (spent > cap) return "exceeded";
  return "within cap";
}
