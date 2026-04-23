/**
 * Skill contract module (ADR-0012 § "Skill contract").
 *
 * Pure types / interfaces. Defines the shape every skill file conforms to and
 * the shared result envelopes skills produce. This module is a leaf: it does
 * not call adapters, register skills, or execute them.
 */

export type AutonomyLevel =
  | "L1-read-only"
  | "L2-propose"
  | "L3-with-approval"
  | "L4-autonomous";

export type SkillStatus =
  | "ready"
  | "succeeded"
  | "caution"
  | "failed"
  | "blocked"
  | "stopped"
  | "needs_human";

export type PolicyVerdict = "ready" | "caution" | "blocked" | "stop";

/**
 * Minimum-viable projection of the ADR-0006 run report envelope.
 * The full envelope (agent_metadata / cost / correlation open sub-objects)
 * is produced by the run recorder; this shape is what the skill runner
 * needs to enforce the evidence contract.
 */
export interface RunReport {
  run_id: string;
  agent_type:
    | "coding"
    | "qa"
    | "review"
    | "sre"
    | "pm"
    | "research"
    | "observability";
  status: "started" | "succeeded" | "failed" | "cancelled" | "needs_human";
  triggered_by: "user" | "linear_status" | "schedule" | "webhook" | "agent";
  linear_issue_id: string;
  autonomy_level: AutonomyLevel;
  started_at: string;
  ended_at: string;
  summary: string;
  decisions: ReadonlyArray<string>;
  next_actions: ReadonlyArray<string>;
  errors: ReadonlyArray<string>;
  cost: {
    band: "normal" | "elevated" | "runaway_risk" | "unknown";
    budget_cap_usd: number | null;
    spent_usd: number | null;
  };
  correlation: {
    pr_url: string | null;
    pr_branch: string | null;
    commit_sha: string | null;
    linear_comment_url: string | null;
  };
}

export interface WriteBackComment {
  body: string;
  url: string | null;
}

export interface SkillInputSpec {
  name: string;
  type: "string" | "boolean";
  required: boolean;
}

export interface EvidenceContract {
  run_report: boolean;
  linear_write_back: boolean;
}

/**
 * The runner calls `execute` with fully resolved tools. A skill file's
 * contract is responsible for declaring metadata + inputs + evidence;
 * the runner enforces approval gates and evidence production.
 */
export interface SkillDefinition<
  Inputs extends Record<string, unknown> = Record<string, unknown>,
  Outputs extends { status: SkillStatus } = { status: SkillStatus },
> {
  name: string;
  version: string;
  inputs: ReadonlyArray<SkillInputSpec>;
  required_tools: ReadonlyArray<ToolName>;
  autonomy_level: AutonomyLevel;
  requires_approval_flag: boolean;
  evidence: EvidenceContract;
  /**
   * Repo-relative paths to canonical docs this skill adapts (ADR-0004).
   * The registry refuses to load a skill whose list is empty or whose
   * referenced paths cannot be resolved against the filesystem.
   */
  derived_from: ReadonlyArray<string>;
  derived_at: string;
  execute: (ctx: SkillExecutionContext<Inputs>) => Promise<Outputs>;
}

export type ToolName =
  | "linear-adapter"
  | "policy-evaluator"
  | "agent-invocation-adapter"
  | "run-recorder"
  | "write-back-formatter";

export interface SkillExecutionContext<
  Inputs extends Record<string, unknown> = Record<string, unknown>,
> {
  inputs: Inputs;
  approve: boolean;
  dry_run: boolean;
  tools: ResolvedTools;
  now: () => Date;
}

export interface ResolvedTools {
  linear: LinearAdapter;
  policy: PolicyEvaluator;
  agents: AgentInvocationAdapter;
  runRecorder: RunRecorder;
  writeBack: WriteBackFormatter;
}

/* ------------------------------------------------------------------ */
/* Shared-component interfaces (thin; implementations live alongside)  */
/* ------------------------------------------------------------------ */

export interface LinearIssueSnapshot {
  id: string;
  status: string;
  sequencing: {
    hard_blockers: ReadonlyArray<string>;
    recommended_predecessors: ReadonlyArray<string>;
    dispatch_status: "ready" | "caution" | "blocked" | "unknown";
    dispatch_note: string;
  };
  blocker_statuses: Readonly<Record<string, string>>;
  budget_cap_usd: number | null;
}

export interface LinearAdapter {
  readIssue(id: string): Promise<LinearIssueSnapshot>;
  postComment(issueId: string, body: string): Promise<{ url: string }>;
}

export interface PolicyInput {
  issue: LinearIssueSnapshot;
  autonomy_level: AutonomyLevel;
  approve: boolean;
}

export interface PolicyEvaluation {
  verdict: PolicyVerdict;
  reasons: ReadonlyArray<string>;
  requires_approval: boolean;
}

export interface PolicyEvaluator {
  evaluate(input: PolicyInput): PolicyEvaluation;
}

export interface AgentInvocationRequest {
  agent_type: "coding";
  linear_issue_id: string;
  autonomy_level: AutonomyLevel;
  approve: boolean;
  dry_run: boolean;
}

export interface AgentInvocationResult {
  exit_signal: "succeeded" | "failed" | "cancelled" | "needs_human";
  pr_url: string | null;
  pr_branch: string | null;
  commit_sha: string | null;
  cost_band: "normal" | "elevated" | "runaway_risk" | "unknown";
  spent_usd: number | null;
  notes: ReadonlyArray<string>;
}

export interface AgentInvocationAdapter {
  invoke(req: AgentInvocationRequest): Promise<AgentInvocationResult>;
}

export interface RunRecorderInput {
  run_id: string;
  linear_issue_id: string;
  autonomy_level: AutonomyLevel;
  started_at: Date;
  ended_at: Date;
  verdict: PolicyVerdict;
  reasons: ReadonlyArray<string>;
  agent_result: AgentInvocationResult | null;
  dry_run: boolean;
  summary: string;
  next_action: string;
  open_questions: ReadonlyArray<string>;
  budget_cap_usd: number | null;
}

export interface RunRecorderOutput {
  report: RunReport;
  markdown: string;
  json: string;
  /** Path relative to the repo root where the report would be committed. */
  path: string;
}

export interface RunRecorder {
  record(input: RunRecorderInput): Promise<RunRecorderOutput>;
}

export interface WriteBackFormatter {
  format(report: RunReport): string;
}
