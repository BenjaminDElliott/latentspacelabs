/**
 * dispatch-ticket@0.2.0 (ADR-0012 § "First vertical slice", LAT-61).
 *
 * Reads one agent-ready Linear ticket, evaluates the ADR-0005 / ADR-0008
 * dispatch policy, invokes one bounded coding-agent run with explicit human
 * approval, records the run against the ADR-0006 envelope, and posts the
 * five-element Linear write-back.
 *
 * LAT-61 bumps the skill from 0.1.0 → 0.2.0 because the adapter boundary
 * now carries the ADR-0013 minimum run contract (repo, branch_target,
 * ticket_context, budget_cap_usd, cost_band_observed, skill_name_and_version).
 * The additions are optional inputs on this skill (non-breaking), but the
 * request shape passed to the invocation adapter is richer, which is a
 * MINOR bump per ADR-0016 §Q4.
 *
 * This is the runtime adapter for the three canonical docs named in
 * `derived_from`; the runner / registry enforce provenance and evidence.
 */
import type {
  AutonomyLevel,
  CostBand,
  SkillDefinition,
  SkillStatus,
} from "../runtime/contract.js";
import type { FormatInput } from "../adapters/write-back-formatter.js";

export interface DispatchTicketInputs extends Record<string, unknown> {
  linear_issue_id: string;
  approve: boolean;
  dry_run: boolean;
  /**
   * Target repository for the coding-agent run, `owner/name`. LAT-61:
   * required by the ADR-0013 minimum run contract for side-effecting
   * invocations; the adapter refuses without it. Harnesses that dispatch
   * against the pilot repo pass `BenjaminDElliott/latentspacelabs`.
   */
  repo?: string;
  /** Base branch the agent should branch from; defaults to `main`. */
  branch_target?: string;
  /** Short human-readable ticket title surfaced to the provider. */
  ticket_title?: string;
  /** Short summary of what the ticket asks the provider to do. */
  ticket_summary?: string;
  /**
   * Caller's best-known cost band per ADR-0009 before invocation. Defaults
   * to `normal`; callers aware of elevated/runaway_risk context pass it
   * explicitly so the adapter can refuse preflight.
   */
  cost_band_observed?: "normal" | "elevated" | "runaway_risk" | "unknown";
}

export type DispatchTicketOutputs = {
  status: SkillStatus;
  run_id: string | null;
  linear_issue_id: string;
  pr_url: string | null;
  linear_comment_url: string | null;
  reasons: ReadonlyArray<string>;
  run_report_path: string | null;
  run_report_markdown: string | null;
  /**
   * LAT-66 / ADR-0009: cost band surfaced to the runner so the evidence
   * gate can refuse a successful run that lacks cost-band evidence.
   */
  cost_band: CostBand;
  /**
   * Secret-safe reason the cost band is `unknown`; `null` when the band
   * is determinable. Required by the LAT-66 runner gate.
   */
  cost_band_unavailable_reason: string | null;
  spent_usd: number | null;
  budget_cap_usd: number | null;
} & Record<string, unknown>;

const AUTONOMY: AutonomyLevel = "L3-with-approval";

export const dispatchTicketSkill: SkillDefinition<
  DispatchTicketInputs,
  DispatchTicketOutputs
> = {
  name: "dispatch-ticket",
  version: "0.2.0",
  inputs: [
    { name: "linear_issue_id", type: "string", required: true },
    { name: "approve", type: "boolean", required: false },
    { name: "dry_run", type: "boolean", required: false },
    { name: "repo", type: "string", required: false },
    { name: "branch_target", type: "string", required: false },
    { name: "ticket_title", type: "string", required: false },
    { name: "ticket_summary", type: "string", required: false },
    { name: "cost_band_observed", type: "string", required: false },
  ],
  required_tools: [
    "linear-adapter",
    "policy-evaluator",
    "agent-invocation-adapter",
    "run-recorder",
    "write-back-formatter",
  ],
  autonomy_level: AUTONOMY,
  requires_approval_flag: true,
  evidence: { run_report: true, linear_write_back: true, cost_band: true },
  derived_from: [
    "docs/decisions/0005-linear-dependency-and-sequencing-model.md",
    "docs/decisions/0006-agent-run-visibility-schema.md",
    "docs/decisions/0008-agent-control-layer-and-perplexity-boundary.md",
  ],
  derived_at: "2026-04-23",

  async execute(ctx) {
    const startedAt = ctx.now();
    const linearIssueId = ctx.inputs.linear_issue_id;

    const issue = await ctx.tools.linear.readIssue(linearIssueId);
    const policy = ctx.tools.policy.evaluate({
      issue,
      autonomy_level: AUTONOMY,
      approve: ctx.approve,
    });

    // Refuse dispatch when the policy verdict is worse than caution, unless
    // this is a dry-run (which is allowed to surface reasons regardless).
    const policyRefuses = policy.verdict === "blocked" || policy.verdict === "stop";

    if (policyRefuses && !ctx.dry_run) {
      const recorded = await ctx.tools.runRecorder.record({
        run_id: "",
        linear_issue_id: linearIssueId,
        autonomy_level: AUTONOMY,
        started_at: startedAt,
        ended_at: ctx.now(),
        verdict: policy.verdict,
        reasons: policy.reasons,
        agent_result: null,
        dry_run: false,
        summary: `Dispatch refused for ${linearIssueId}: ${policy.verdict}`,
        next_action: "resolve policy failures and retry",
        open_questions: policy.reasons,
        budget_cap_usd: issue.budget_cap_usd,
      });
      return {
        status: "blocked",
        run_id: recorded.report.run_id,
        linear_issue_id: linearIssueId,
        pr_url: null,
        linear_comment_url: null,
        reasons: policy.reasons,
        run_report_path: recorded.path,
        run_report_markdown: recorded.markdown,
        cost_band: recorded.report.cost.band,
        cost_band_unavailable_reason: recorded.report.cost.band_unavailable_reason,
        spent_usd: recorded.report.cost.spent_usd,
        budget_cap_usd: recorded.report.cost.budget_cap_usd,
      };
    }

    // Dry-run: evaluate policy + record, but never invoke the agent or post.
    if (ctx.dry_run) {
      const recorded = await ctx.tools.runRecorder.record({
        run_id: "",
        linear_issue_id: linearIssueId,
        autonomy_level: AUTONOMY,
        started_at: startedAt,
        ended_at: ctx.now(),
        verdict: policy.verdict,
        reasons: policy.reasons,
        agent_result: null,
        dry_run: true,
        summary: `Dry-run dispatch evaluation for ${linearIssueId}: verdict=${policy.verdict}`,
        next_action:
          policy.verdict === "ready"
            ? "rerun with approve=true to dispatch"
            : "address the policy reasons before dispatch",
        open_questions: policy.reasons,
        budget_cap_usd: issue.budget_cap_usd,
      });
      return {
        status: policy.verdict === "ready" ? "succeeded" : "caution",
        run_id: recorded.report.run_id,
        linear_issue_id: linearIssueId,
        pr_url: null,
        linear_comment_url: null,
        reasons: policy.reasons,
        run_report_path: recorded.path,
        run_report_markdown: recorded.markdown,
        cost_band: recorded.report.cost.band,
        cost_band_unavailable_reason: recorded.report.cost.band_unavailable_reason,
        spent_usd: recorded.report.cost.spent_usd,
        budget_cap_usd: recorded.report.cost.budget_cap_usd,
      };
    }

    // The runner has already enforced the approval gate. Caution with approval
    // is allowed: approval is the acknowledgement that the caution is known.
    // LAT-61: the invocation request now carries the ADR-0013 minimum run
    // contract (repo, branch_target, ticket_context, budget_cap_usd,
    // cost_band_observed, skill_name_and_version). The adapter refuses
    // structurally when any required field is missing.
    const agentResult = await ctx.tools.agents.invoke({
      agent_type: "coding",
      linear_issue_id: linearIssueId,
      autonomy_level: AUTONOMY,
      approve: ctx.approve,
      dry_run: false,
      repo: ctx.inputs.repo,
      branch_target: ctx.inputs.branch_target ?? "main",
      branch_naming: `lat-${issueNumber(linearIssueId)}-<slug>`,
      ticket_context: {
        title: ctx.inputs.ticket_title ?? linearIssueId,
        summary:
          ctx.inputs.ticket_summary ??
          issue.sequencing.dispatch_note ??
          `Dispatch ${linearIssueId} per ADR-0005 / ADR-0013.`,
        guardrails: [
          "No auto-merge; all PRs are human-reviewed (ADR-0008).",
          "No secret values in PR body, logs, or run report (ADR-0017 Rule 5).",
          "ADR-0009 cost bands apply; runaway risk halts dispatch.",
        ],
        non_goals: [],
      },
      budget_cap_usd: issue.budget_cap_usd,
      cost_band_observed: ctx.inputs.cost_band_observed ?? "normal",
      skill_name_and_version: "dispatch-ticket@0.2.0",
    });

    const endedAt = ctx.now();
    const recorded = await ctx.tools.runRecorder.record({
      run_id: "",
      linear_issue_id: linearIssueId,
      autonomy_level: AUTONOMY,
      started_at: startedAt,
      ended_at: endedAt,
      verdict: policy.verdict,
      reasons: policy.reasons,
      agent_result: agentResult,
      dry_run: false,
      summary: summaryFor(linearIssueId, policy.verdict, agentResult.exit_signal),
      next_action: nextActionFor(agentResult.exit_signal),
      open_questions: [],
      budget_cap_usd: issue.budget_cap_usd,
    });

    // Post the five-element write-back only when the agent actually ran —
    // success, failure, or needs_human all deserve a Linear comment so the
    // dispatch path is auditable. Cancelled runs still get recorded but we
    // defer write-back to the human who cancelled.
    let linearCommentUrl: string | null = null;
    if (agentResult.exit_signal !== "cancelled") {
      const body = formatWriteBack(ctx.tools.writeBack, {
        report: recorded.report,
        run_report_url: recorded.path,
        open_questions: [],
      });
      const posted = await ctx.tools.linear.postComment(linearIssueId, body);
      linearCommentUrl = posted.url;
    }

    const status = runStatusFrom(agentResult.exit_signal);
    return {
      status,
      run_id: recorded.report.run_id,
      linear_issue_id: linearIssueId,
      pr_url: agentResult.pr_url,
      linear_comment_url: linearCommentUrl,
      reasons: policy.reasons,
      run_report_path: recorded.path,
      run_report_markdown: recorded.markdown,
      cost_band: recorded.report.cost.band,
      cost_band_unavailable_reason: recorded.report.cost.band_unavailable_reason,
      spent_usd: recorded.report.cost.spent_usd,
      budget_cap_usd: recorded.report.cost.budget_cap_usd,
    };
  },
};

function summaryFor(
  issueId: string,
  verdict: string,
  signal: string,
): string {
  return `Dispatched coding agent for ${issueId} (policy=${verdict}, agent=${signal}).`;
}

function nextActionFor(signal: string): string {
  switch (signal) {
    case "succeeded":
      return "review PR and merge if approved";
    case "failed":
      return "inspect agent errors and retriage";
    case "needs_human":
      return "resolve the agent's blocker and retry";
    case "cancelled":
      return "decide whether to resume or close";
    default:
      return "review run report";
  }
}

/**
 * Map the agent invocation adapter's exit_signal onto the SkillStatus the
 * runner returns. `cancelled` → `stopped` is the deliberate rename: inside
 * the skill runner, a cancelled invocation reads as "stopped by policy /
 * human"; the ADR-0006 run report still records it as `status: cancelled`
 * via `toRunStatus` in contract.ts.
 */
function runStatusFrom(signal: string): SkillStatus {
  switch (signal) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "needs_human":
      return "needs_human";
    case "cancelled":
      return "stopped";
    default:
      return "failed";
  }
}

function issueNumber(issueId: string): string {
  const m = /-(\d+)$/.exec(issueId);
  return m ? (m[1] as string) : "nn";
}

function formatWriteBack(
  formatter: {
    formatFull?: (input: FormatInput) => string;
    format: (report: FormatInput["report"]) => string;
  },
  input: FormatInput,
): string {
  if (typeof formatter.formatFull === "function") {
    return formatter.formatFull(input);
  }
  return formatter.format(input.report);
}
