/**
 * Skill contract module (ADR-0012 § "Skill contract").
 *
 * Pure types / interfaces. Defines the shape every skill file conforms to and
 * the shared result envelopes skills produce. This module is a leaf: it does
 * not call adapters, register skills, or execute them.
 *
 * LAT-36 reconciles the enum surface so the code, the ADR-0006 template, and
 * the ADR-0013 minimum run contract agree: autonomy uses the `L1..L4` ADR-0008
 * notation; `agent_type`, `triggered_by`, and the run-report `status` are the
 * single source of truth for their respective enums; and `SkillStatus` has an
 * explicit mapping to the narrower run-report `status` (see `toRunStatus`).
 */

/**
 * Schema version for the ADR-0006 envelope produced by the run recorder and
 * consumed by the write-back formatter. Bumped only when a breaking change
 * to the envelope lands (per ADR-0006's extensibility rule: additions are
 * non-breaking; renames/removals require an ADR).
 */
export const RUN_REPORT_SCHEMA_VERSION = "1.0.0";

/**
 * Autonomy notation per ADR-0008 (L0–L5). The pilot runtime operates between
 * L1 and L4; L0 is Perplexity-only "observe/draft" and L5 is the out-of-scope
 * autonomous-merge-and-deploy level.
 */
export type AutonomyLevel =
  | "L1-read-only"
  | "L2-propose"
  | "L3-with-approval"
  | "L4-autonomous";

/**
 * SkillStatus is the **runner-facing** outcome of a single skill invocation.
 * It is broader than RunReport["status"] because it also carries pre-execution
 * verdicts (`ready`, `caution`, `blocked`) the runner emits without ever
 * reaching the agent. `stopped` is the skill-side term for a cancelled run.
 * Use `toRunStatus` to project onto the ADR-0006 run-report status enum.
 */
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
 * ADR-0006 canonical agent types. Keep in sync with
 * `docs/templates/agent-run-report.md`. Note: `retro` is deliberately NOT an
 * agent_type — retros are a process (ADR-0010), not a runnable agent. A retro
 * run is recorded under `pm` or `research` depending on who authored it.
 */
export type AgentType =
  | "coding"
  | "qa"
  | "review"
  | "sre"
  | "pm"
  | "research"
  | "observability";

/**
 * ADR-0006 run-report status enum (the narrow lifecycle-facing enum written
 * to `runs/<run_id>.json`). Distinct from `SkillStatus` on purpose: a run
 * report is only written for a run that actually reached the invocation
 * boundary, so pre-execution verdicts like `ready`/`caution`/`blocked` are
 * projected onto `needs_human` or `failed` via `toRunStatus`.
 */
export type RunReportStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_human";

/**
 * ADR-0006 `triggered_by` surface. LAT-36 adds `hook` (Claude Code harness
 * hook callback) and `mcp` (MCP server callback) to the three existing
 * programmatic surfaces (`schedule`, `webhook`, `agent`) alongside the
 * Linear/GitHub-originated surfaces. Additions are non-breaking per ADR-0006.
 */
export type TriggeredBy =
  | "user"
  | "linear_status"
  | "schedule"
  | "webhook"
  | "agent"
  | "github_comment"
  | "hook"
  | "mcp";

/**
 * Projects a SkillStatus onto the narrower RunReportStatus enum the run
 * recorder persists. `ready`/`caution`/`blocked` all mean the skill never
 * reached the agent — from the run-report's perspective that is either
 * `needs_human` (human decision required) or `failed` (runtime rejected).
 * `stopped` → `cancelled` is the skill↔run-report rename of the same event.
 */
export function toRunStatus(s: SkillStatus): RunReportStatus {
  switch (s) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "needs_human":
    case "blocked":
    case "caution":
    case "ready":
      return "needs_human";
    case "stopped":
      return "cancelled";
    default:
      return "failed";
  }
}

/**
 * Minimum-viable projection of the ADR-0006 run report envelope.
 * The full envelope (agent_metadata / cost / correlation open sub-objects)
 * is produced by the run recorder; this shape is what the skill runner
 * needs to enforce the evidence contract.
 */
export interface RunReport {
  /**
   * Envelope schema version (`RUN_REPORT_SCHEMA_VERSION`). Written into the
   * run report so consumers (Linear formatter, future telemetry substrate,
   * Perplexity) can branch on version without re-reading ADR-0006.
   */
  schema_version: string;
  run_id: string;
  agent_type: AgentType;
  status: RunReportStatus;
  triggered_by: TriggeredBy;
  linear_issue_id: string;
  autonomy_level: AutonomyLevel;
  started_at: string;
  ended_at: string;
  summary: string;
  decisions: ReadonlyArray<string>;
  next_actions: ReadonlyArray<string>;
  errors: ReadonlyArray<string>;
  cost: {
    band: CostBand;
    budget_cap_usd: number | null;
    spent_usd: number | null;
    /**
     * Free-text, secret-safe reason surfaced when `band === "unknown"` — e.g.
     * "command provider returned no spend data". ADR-0009 requires a narrative
     * whenever spend cannot be measured; this field carries the machine-
     * readable handle so reviewers can tell apart genuine unknowns from
     * skipped reporting (LAT-66).
     */
    band_unavailable_reason: string | null;
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
  /**
   * LAT-66 / ADR-0009: when true, the skill must surface cost-band evidence
   * on a successful non-dry run. The runner refuses a `succeeded` outcome
   * that lacks a valid `cost_band` output, and requires a typed unavailable
   * reason when the band is `"unknown"`. Side-effecting skills (L3+ or
   * `requires_approval_flag`) default this to `true` at the skill level so a
   * missing cost band cannot silently produce a successful run.
   */
  cost_band: boolean;
}

/** Valid cost-band values per ADR-0009. */
export type CostBand = "normal" | "elevated" | "runaway_risk" | "unknown";

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

/**
 * Minimum agent invocation request carried across the ICP-Routed boundary
 * (ADR-0013 § "Minimum run contract"). The earlier LAT-52 stub only needed
 * `linear_issue_id`, `autonomy_level`, `approve`, and `dry_run`; LAT-61 adds
 * the rest of the contract so a real coding provider receives enough context
 * to open a `LAT-NN:` PR or return a typed refusal.
 *
 * New fields are optional on the type so pre-LAT-61 callers keep compiling;
 * the real adapter (`createCodingAgentAdapter`) structurally refuses when the
 * fields a provider actually needs are missing.
 */
export interface AgentInvocationRequest {
  agent_type: "coding";
  linear_issue_id: string;
  autonomy_level: AutonomyLevel;
  approve: boolean;
  dry_run: boolean;
  /** `owner/name` repository the provider should act on (ADR-0013). */
  repo?: string | undefined;
  /** Base branch the provider should branch from, typically `main`. */
  branch_target?: string | undefined;
  /** Branch naming convention, typically `lat-<n>-<slug>`. */
  branch_naming?: string | undefined;
  /** Ticket title/summary/guardrails the provider must read before acting. */
  ticket_context?: TicketInvocationContext | undefined;
  /** Numeric ADR-0009 budget cap; required for side-effecting runs. */
  budget_cap_usd?: number | null | undefined;
  /**
   * Caller's best-known cost band per ADR-0009 before invocation. `elevated`
   * or `runaway_risk` bands at the start of a run are refusals (ADR-0013).
   */
  cost_band_observed?: CostBand | undefined;
  /** The `name@version` of the skill originating this invocation. */
  skill_name_and_version?: string | undefined;
  /** Stable per-run correlation id; surfaced into provider logs only. */
  run_id?: string | undefined;
}

export interface TicketInvocationContext {
  /** Human-readable title from Linear. Never a secret. */
  title: string;
  /** Short summary of what the ticket asks the provider to do. */
  summary: string;
  /** ADR-0008 / ADR-0013 / ADR-0017 guardrails the provider must honour. */
  guardrails: ReadonlyArray<string>;
  /**
   * Non-goals / out-of-scope notes the caller wants surfaced verbatim.
   * Empty array is valid; `null` is not.
   */
  non_goals: ReadonlyArray<string>;
}

export interface AgentInvocationResult {
  exit_signal: "succeeded" | "failed" | "cancelled" | "needs_human";
  pr_url: string | null;
  pr_branch: string | null;
  commit_sha: string | null;
  cost_band: CostBand;
  spent_usd: number | null;
  /**
   * Secret-safe reason the provider could not produce a concrete cost band.
   * Expected only when `cost_band === "unknown"`; required by the runner
   * LAT-66 gate so callers cannot silently paper over missing cost evidence
   * (ADR-0009). `null` when the band is determinable.
   */
  cost_band_unavailable_reason: string | null;
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
