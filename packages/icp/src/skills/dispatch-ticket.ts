/**
 * dispatch-ticket@0.1.0 (ADR-0012 § "First vertical slice").
 *
 * Reads one agent-ready Linear ticket, evaluates the ADR-0005 / ADR-0008
 * dispatch policy, invokes one bounded coding-agent run with explicit human
 * approval, records the run against the ADR-0006 envelope, and posts the
 * five-element Linear write-back.
 *
 * This is the runtime adapter for the three canonical docs named in
 * `derived_from`; the runner / registry enforce provenance and evidence.
 */
import type {
  AutonomyLevel,
  SkillDefinition,
  SkillStatus,
} from "../runtime/contract.js";
import type { FormatInput } from "../adapters/write-back-formatter.js";

export interface DispatchTicketInputs extends Record<string, unknown> {
  linear_issue_id: string;
  approve: boolean;
  dry_run: boolean;
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
} & Record<string, unknown>;

const AUTONOMY: AutonomyLevel = "L3-with-approval";

export const dispatchTicketSkill: SkillDefinition<
  DispatchTicketInputs,
  DispatchTicketOutputs
> = {
  name: "dispatch-ticket",
  version: "0.1.0",
  inputs: [
    { name: "linear_issue_id", type: "string", required: true },
    { name: "approve", type: "boolean", required: false },
    { name: "dry_run", type: "boolean", required: false },
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
  evidence: { run_report: true, linear_write_back: true },
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
      };
    }

    // The runner has already enforced the approval gate. Caution with approval
    // is allowed: approval is the acknowledgement that the caution is known.
    const agentResult = await ctx.tools.agents.invoke({
      agent_type: "coding",
      linear_issue_id: linearIssueId,
      autonomy_level: AUTONOMY,
      approve: ctx.approve,
      dry_run: false,
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
