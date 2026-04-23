/**
 * Agent evaluation and QA harness MVP (LAT-56, PRD LAT-26).
 *
 * Public entry points:
 * - `evaluateReadiness(input)` — pre-dispatch pre-flight (PRD §6.3).
 * - `evaluateCodingRun(input)` — post-run evaluator (PRD §6.1, §6.2).
 * - `aggregateRunsForRetro(runs, options)` — retro-loop aggregator (§6.4).
 *
 * The harness does not introduce a new telemetry substrate (PRD §3 non-goal
 * 4). It produces compact envelopes the existing run-report / QA-report /
 * PR-review-report templates reference, and the retro loop consumes.
 */
export { evaluateReadiness } from "./readiness-check.js";
export { evaluateCodingRun } from "./evaluator.js";
export { aggregateRunsForRetro } from "./retro-aggregator.js";
export type {
  Recommendation,
  Severity,
  FailureCategory,
  EvaluationFinding,
  EvaluationReport,
  EvaluationRunInput,
  ReadinessVerdict,
  ReadinessReason,
  ReadinessReport,
  ReadinessTicketInput,
  AggregatableRun,
  RetroCandidate,
  RetroAggregationResult,
  RetroAggregationOptions,
} from "./contract.js";
