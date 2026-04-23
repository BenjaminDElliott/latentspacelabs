/**
 * ICP observability cockpit types (LAT-55, PRD docs/prds/LAT-28).
 *
 * Pure types module. Defines the seven MVP view shapes and the notification
 * tiers named in PRD §6.2 and §6.4. Implementations live in `reader.ts`
 * (runs/ tree reader), `views.ts` (pure projections over the envelope),
 * and `summary.ts` (Perplexity-facing briefing renderer).
 *
 * The cockpit is a read-through projection only: it does not introduce a
 * new source of record, does not choose a telemetry backend, and never
 * edits Linear, GitHub, or the `runs/` tree. PRD §6.3 is authoritative for
 * source-of-record routing; every view below cites its source in a comment.
 */
import type { RunReport } from "../runtime/contract.js";

/**
 * Per-PRD §6.6.3 the cockpit projects ADR-0006 envelope fields only; it does
 * not invent view-local fields. ADR-0006 allows agent-type-specific detail to
 * live inside `agent_metadata` / `cost` / `correlation` as open sub-objects,
 * plus the optional `risk_level` top-level field. The cockpit reads those
 * optional fields when present and tolerates their absence.
 *
 * This shape extends the minimum `RunReport` the runtime persists today
 * (`RUN_REPORT_SCHEMA_VERSION` 1.0.0) with the optional ADR-0006 fields the
 * cockpit surfaces. Additions are non-breaking per ADR-0006's extensibility
 * contract.
 */
export interface CockpitRunRecord extends RunReport {
  /** ADR-0006 optional top-level field; surfaced in Cost and Risk Flags. */
  risk_level?: "low" | "medium" | "high" | "critical" | null;
  /** ADR-0006 open sub-object; cockpit reads `model` only. */
  agent_metadata?: {
    model?: string | null;
  } & Record<string, unknown>;
  /** Repo-relative path to the source JSON file (reader-populated). */
  source_path?: string;
}

/**
 * PRD §6.4 notification tiers. The trigger set is closed; widening requires
 * a PRD revision, not an implementation PR. A synchronous-page event always
 * cites the `run_id` or Linear issue that triggered it (PRD §6.4 last para).
 */
export type NotificationTier = "synchronous_page" | "ambient_queue" | "silent";

export interface NotificationEvent {
  tier: "synchronous_page" | "ambient_queue";
  reason: string;
  run_id: string;
  linear_issue_id: string;
  /** Name of the MVP view where the operator can act on the event. */
  source_view: ViewName;
}

export type ViewName =
  | "active_runs"
  | "blocked_work"
  | "recent_completions"
  | "failed_runs"
  | "cost_and_risk_flags"
  | "pr_review_queue"
  | "learning_candidates";

/* ------------------------------------------------------------------ */
/* View row shapes (PRD §6.2). Each row's column set is a fixed subset */
/* of ADR-0006 fields. No view-local invented fields (PRD §6.6.3).     */
/* ------------------------------------------------------------------ */

/** Source: runs/*.json. PRD §6.2.1. */
export interface ActiveRunRow {
  run_id: string;
  agent_type: RunReport["agent_type"];
  linear_issue_id: string;
  autonomy_level: RunReport["autonomy_level"];
  cost_band: RunReport["cost"]["band"];
  started_at: string;
  /** Reader-populated when §6.4 stale-run suspicion applies. */
  stale: boolean;
}

/** Source: runs/*.json + Linear issue state. PRD §6.2.2. */
export interface BlockedWorkRow {
  run_id: string;
  agent_type: RunReport["agent_type"];
  linear_issue_id: string;
  status: Exclude<RunReport["status"], "succeeded" | "started">;
  reason: string;
  next_action: string;
  /** Linear issue status if the caller supplied a Linear snapshot. */
  linear_status: string | null;
}

/** Source: runs/*.json + GitHub PR state. PRD §6.2.3. */
export interface RecentCompletionRow {
  run_id: string;
  agent_type: RunReport["agent_type"];
  linear_issue_id: string;
  status: RunReport["status"];
  summary: string;
  pr_url: string | null;
  ended_at: string;
}

/** Source: runs/*.json. PRD §6.2.4. Recurrence count is over the same group. */
export interface FailedRunsGroup {
  key: string;
  kind: "by_agent_type" | "by_linear_issue";
  count: number;
  most_recent_error: string;
  run_ids: ReadonlyArray<string>;
  retrospective_candidate: boolean;
}

/** Source: runs/*.json. PRD §6.2.5. */
export interface CostRiskRow {
  run_id: string;
  agent_type: RunReport["agent_type"];
  linear_issue_id: string;
  cost_band: RunReport["cost"]["band"];
  risk_level: CockpitRunRecord["risk_level"] | "unknown";
  reason: string;
  spent_usd: number | null;
  model: string | null;
  /** Highest-precedence flag for sort order (runaway_risk/critical first). */
  severity_rank: number;
}

/**
 * Source: GitHub (PR list) + runs/*.json (risk/cost) + repo QA/PR-review
 * reports where present. PRD §6.2.6. Callers that lack GitHub access pass
 * `pr_state = null`; the cockpit renders "requires future telemetry" for
 * that field (PRD §6.5.3).
 */
export interface PRReviewQueueRow {
  pr_number: number | null;
  pr_url: string | null;
  pr_title: string | null;
  lat_key: string;
  author: string | null;
  /** Null when ADR-0007 review reports are not supplied. */
  qa_findings_by_severity: Readonly<Record<string, number>> | null;
  risk_level: CockpitRunRecord["risk_level"] | "unknown";
  cost_band: RunReport["cost"]["band"];
  run_id: string | null;
}

/**
 * Source: runs/*.json + ADR-0007 review reports where supplied.
 * PRD §6.2.7. Clusters recur across ≥2 runs.
 */
export interface LearningCandidate {
  kind:
    | "repeated_error_class"
    | "consecutive_failed_agent"
    | "recurring_pr_finding";
  cluster_key: string;
  count: number;
  /** ISO-8601 span; `start` is earliest, `end` is latest. */
  span: { start: string; end: string };
  run_ids: ReadonlyArray<string>;
  /** One-line pointer into ADR-0010 retro intake. */
  retro_intake_hint: string;
}

/**
 * The full cockpit state returned by `buildCockpitState()`. Every field
 * corresponds to a PRD §6.2 view; aggregate counts are view-local
 * derived fields, not new envelope fields.
 */
export interface CockpitState {
  /** UTC ISO timestamp when the state was rendered. */
  rendered_at: string;
  active_runs: ReadonlyArray<ActiveRunRow>;
  blocked_work: ReadonlyArray<BlockedWorkRow>;
  recent_completions: ReadonlyArray<RecentCompletionRow>;
  failed_runs: {
    by_agent_type: ReadonlyArray<FailedRunsGroup>;
    by_linear_issue: ReadonlyArray<FailedRunsGroup>;
    window_days: number;
  };
  cost_and_risk_flags: ReadonlyArray<CostRiskRow>;
  pr_review_queue: ReadonlyArray<PRReviewQueueRow>;
  learning_candidates: ReadonlyArray<LearningCandidate>;
  notifications: ReadonlyArray<NotificationEvent>;
  /** Views that cannot be answered from runs/ + Linear + GitHub. */
  telemetry_gaps: ReadonlyArray<string>;
  /** Counts of runs the reader saw, post filtering. */
  totals: {
    runs_seen: number;
    runs_rejected: number;
    runs_in_window: number;
  };
}

/* ------------------------------------------------------------------ */
/* Inputs: optional external-system snapshots callers may supply.      */
/* The cockpit never fetches; it projects over data the caller hands   */
/* it. This preserves PRD §6.3 routing and keeps unit tests hermetic.  */
/* ------------------------------------------------------------------ */

export interface LinearIssueState {
  /** Linear issue key, e.g. `LAT-55`. */
  id: string;
  /** Linear workflow state name, e.g. `In Progress`, `Blocked`. */
  status: string;
}

export interface GitHubPRState {
  number: number;
  url: string;
  title: string;
  author: string | null;
  state: "open" | "closed" | "merged";
  /** Optional: LAT key parsed from the title. */
  lat_key?: string | null;
}

export interface QAReviewReport {
  /** PR number the report is attached to. */
  pr_number: number;
  findings_by_severity: Readonly<Record<string, number>>;
  /** Repeatable finding class (for Learning Candidates). */
  finding_classes: ReadonlyArray<string>;
}

export interface CockpitInputs {
  runs: ReadonlyArray<CockpitRunRecord>;
  linear_issues?: ReadonlyArray<LinearIssueState>;
  open_prs?: ReadonlyArray<GitHubPRState>;
  qa_reports?: ReadonlyArray<QAReviewReport>;
  /** Override for `Date.now()` in tests and reproducible renders. */
  now?: Date;
  /** Stale-started threshold in hours (PRD §9.2 open question). */
  stale_started_hours?: number;
  /** Failed-window in days (PRD §6.2.4). Defaults to 7. */
  failed_window_days?: number;
  /** Active-runs window in hours (PRD §6.2.1). Defaults to 24. */
  active_runs_window_hours?: number;
  /** Cap on Recent Completions. Defaults to 20 per PRD §6.2.3. */
  recent_completions_limit?: number;
}
