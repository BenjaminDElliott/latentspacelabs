/**
 * Agent evaluation and QA harness contract (LAT-56, PRD LAT-26).
 *
 * Defines the minimum executable evaluation contract for coding-agent runs:
 * the recommendation and failure-category vocabularies, the evaluation-report
 * envelope produced at run-close, and the readiness-check envelope produced
 * before dispatch. The vocabulary reuses ADR-0007's recommendation values and
 * severity ladder and the LAT-61 refusal categories so harness evidence is
 * directly legible alongside ADR-0006 run reports and ADR-0013 invocation
 * adapter outputs. No new telemetry substrate is introduced (PRD LAT-26 §3).
 *
 * Scope (per LAT-56 post-LAT-61 guard):
 * - Coding-agent runs only; QA / PR-review / SRE evaluation stays docs-only.
 * - Failure categories seeded from real LAT-61 refusal kinds; no speculative
 *   "long-term pattern" categories until the harness has real runs to read.
 */
import type {
  AgentInvocationResult,
  CodingAgentRefusalKind,
} from "./types-re-export.js";

/**
 * ADR-0007 recommendation ladder. This PRD (LAT-26 §6.2 non-functional rule
 * "stable vocabulary") forbids inventing new values — the harness consumes
 * and produces the same five tokens the review/QA report templates carry.
 */
export type Recommendation =
  | "approve"
  | "approve-with-nits"
  | "request-changes"
  | "block-merge"
  | "needs-human";

/** ADR-0007 severity ladder; reused verbatim. */
export type Severity = "nit" | "low" | "medium" | "high" | "critical";

/**
 * The failure-category vocabulary the harness records on every non-success
 * run. Seeded from the LAT-61 coding-agent invocation adapter's refusal
 * kinds (the concrete categories the system *actually* produces today) plus
 * three post-run evaluation categories the harness adds:
 *
 * - `missing_evidence_floor` — run claims `approve` but evidence contract
 *   from PRD §6.2 was not populated.
 * - `recommendation_ladder_violation` — recommendation does not match the
 *   ADR-0007 severity-ladder rules (e.g. `high` finding + `approve`).
 * - `preflight_ticket_not_agent_ready` — harness refused to dispatch because
 *   the ticket inputs failed the agent-ready pre-flight (PRD §6.3).
 * - `none` — the run succeeded cleanly; kept explicit so a retro aggregator
 *   can count "clean" runs separately from "unknown".
 *
 * The vocabulary is deliberately closed: we do not want free-text categories
 * drifting into retro aggregation. New categories require an ADR amendment.
 */
export type FailureCategory =
  | "none"
  | CodingAgentRefusalKind
  | "missing_evidence_floor"
  | "recommendation_ladder_violation"
  | "preflight_ticket_not_agent_ready";

/**
 * A single finding surfaced by the evaluator. Compact on purpose — the full
 * QA / PR-review report remains the canonical artefact; the harness evidence
 * is what the runner can generate deterministically from the run result.
 */
export interface EvaluationFinding {
  severity: Severity;
  category: FailureCategory;
  message: string;
}

/**
 * Output of `evaluateCodingRun` — the harness's compact judgement on a
 * completed coding-agent run. Matches PRD LAT-26 §7 acceptance criterion 1
 * ("evidence, recommendation, risks, and next action in the agreed run /
 * report shape").
 */
export interface EvaluationReport {
  run_id: string;
  linear_issue_id: string;
  recommendation: Recommendation;
  /** Primary failure category for retro aggregation. `none` on clean runs. */
  failure_category: FailureCategory;
  /** All findings; the primary category is derived from the highest severity. */
  findings: ReadonlyArray<EvaluationFinding>;
  /** One-line per risk, ADR-0007 phrasing (`cost_band=elevated`, etc.). */
  risks: ReadonlyArray<string>;
  /** Evidence pointers (PR URL, run report path, Linear comment URL). */
  evidence: {
    pr_url: string | null;
    run_report_path: string | null;
    linear_comment_url: string | null;
  };
  /** Single recommended next step. Matches ADR-0003 write-back element. */
  next_action: string;
}

/** The readiness-check's three-valued verdict, per PRD LAT-26 §6.3. */
export type ReadinessVerdict = "ready" | "caution" | "refuse";

/**
 * Structured reason the readiness check emits. Mirrors the LAT-61 refusal
 * shape so downstream Linear write-back / retro aggregation can treat
 * pre-dispatch refusals and invocation-time refusals uniformly.
 */
export interface ReadinessReason {
  category: FailureCategory;
  message: string;
}

export interface ReadinessReport {
  verdict: ReadinessVerdict;
  reasons: ReadonlyArray<ReadinessReason>;
  /**
   * Ticket-facing refusal block the dispatcher writes back when the verdict
   * is `refuse`. Shape matches the `## Pre-flight: REFUSED` template in
   * `docs/templates/agent-ready-ticket.md`.
   */
  refusal_markdown: string | null;
}

/** Minimum ticket shape the readiness check reads. */
export interface ReadinessTicketInput {
  linear_issue_id: string;
  /** Risk level from the agent-ready ticket. `null` = not set. */
  risk_level: "low" | "medium" | "high" | null;
  /** Numeric budget cap from the agent-ready ticket. `null` = missing. */
  budget_cap_usd: number | null;
  /** Scope block. Both in/out arrays must be non-empty to pass. */
  scope_in: ReadonlyArray<string>;
  scope_out: ReadonlyArray<string>;
  /** Acceptance criteria; each must be testable. Checked by non-empty rule only. */
  acceptance_criteria: ReadonlyArray<string>;
  /** Whether the ticket's Tests section is populated. */
  has_tests_section: boolean;
  /** ADR-0005 sequencing: `unknown` means the block was missing. */
  sequencing_status: "ready" | "caution" | "blocked" | "unknown";
  /** Whether the coding-agent repo target is known (`owner/name`). */
  repo: string | null;
  /** Whether a one-sentence goal was provided. */
  goal: string | null;
}

/** Minimum run shape the evaluator reads. */
export interface EvaluationRunInput {
  run_id: string;
  linear_issue_id: string;
  /** The `AgentInvocationResult` the adapter produced. */
  agent_result: AgentInvocationResult;
  /**
   * Claimed recommendation (from QA / PR-review report if one was produced).
   * `null` means "no review artefact yet"; the evaluator defaults to
   * `needs-human` in that case.
   */
  claimed_recommendation: Recommendation | null;
  /** Whether the ADR-0006 run report / ADR-0003 write-back were produced. */
  has_run_report: boolean;
  has_linear_write_back: boolean;
  /** Severity labels of every finding the QA / review report carried. */
  finding_severities: ReadonlyArray<Severity>;
  /** Pointers carried through onto the evaluation evidence. */
  pr_url: string | null;
  run_report_path: string | null;
  linear_comment_url: string | null;
}

/**
 * The subset of an `EvaluationReport` the retro aggregator needs. Kept as a
 * thin structural type so aggregation can run over *stored* reports read
 * from disk without carrying the whole envelope. Matches PRD §6.4.
 */
export interface AggregatableRun {
  run_id: string;
  linear_issue_id: string;
  failure_category: FailureCategory;
}

/**
 * Retro-loop output per PRD §6.4 and ADR-0010. The aggregator never decides
 * promotion — it surfaces categories that crossed the recurrence threshold
 * and leaves the archive-vs-promote call to the retro itself.
 */
export interface RetroCandidate {
  category: FailureCategory;
  occurrences: number;
  run_ids: ReadonlyArray<string>;
  /** Linear issue IDs the pattern was observed on. Stable, deduped order. */
  linear_issue_ids: ReadonlyArray<string>;
  /** One-line suggested promotion, worded to match ADR-0010's four paths. */
  suggested_promotion: string;
}

export interface RetroAggregationResult {
  /** Categories at or above the recurrence threshold. */
  candidates: ReadonlyArray<RetroCandidate>;
  /** Categories observed but below threshold — archived-with-rationale. */
  archived: ReadonlyArray<{ category: FailureCategory; occurrences: number }>;
  /** Total runs read (including `none`), for denominator visibility. */
  total_runs: number;
}

export interface RetroAggregationOptions {
  /**
   * Recurrence threshold, per PRD §6.4: ≥ 2 in window OR ≥ 3 across recent
   * retros. The MVP aggregator treats a single call as "one window"; the
   * caller passes `2` for the in-window threshold.
   */
  threshold: number;
}
