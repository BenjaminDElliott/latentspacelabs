/**
 * SRE / Deploy agent contract (LAT-177).
 *
 * Defines the input/output type contract for the SRE/deploy agent invocation.
 * The SRE agent receives a deployment request (input) and produces a deploy
 * result envelope (output) with health-check findings, rollback capability,
 * and cost evidence — all aligned with the ADR-0006 run-report envelope and
 * LAT-8 / ADR-0007 evidence format (severity-tagged findings, structured
 * recommendation via `deploy_status`, and ADR-0009 cost band).
 *
 * Scope:
 * - This contract is agent-type-specific (sre). The ICP runtime's core
 *   contract (`contract.ts`) is agent-type-agnostic; SRE-specific fields
 *   live here.
 * - The SRE agent is one of seven agent types defined in the core contract
 *   (`AgentType = "sre"`).
 *
 * Evidence format (LAT-8 / ADR-0007):
 * - Every health check result is a severity-tagged finding (critical/high/
 *   medium/low/info), matching the ADR-0007 severity ladder.
 * - `deploy_status` serves as the agent's recommendation (succeeded = approve,
 *   failed = request-changes, etc.).
 * - `cost.band` provides the risk flag per ADR-0009.
 *
 * Schema versioning:
 * - `SRE_DEPLOY_SCHEMA_VERSION` follows SemVer. Major bump on rename or removal;
 *   minor bump on new fields; patch on clarifying edits. The runtime will
 *   consume this version to gate compatibility.
 */

/* ------------------------------------------------------------------ */
/* Schema version                                                      */
/* ------------------------------------------------------------------ */

/**
 * Schema version for the SRE deploy contract.
 * Set to "0.1.0" — pre-release, pending LAT-177 implementation.
 */
export const SRE_DEPLOY_SCHEMA_VERSION = "0.1.0";

/* ------------------------------------------------------------------ */
/* Deploy target                                                       */
/* ------------------------------------------------------------------ */

/**
 * The target to deploy. A human-readable identifier for the service,
 * component, or infrastructure element being deployed (e.g., "api-gateway",
 * "auth-service", "k8s-cluster"). Not a URL or full resource ARN — just
 * the service name.
 */
export type DeployTarget = string;

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deployment environment. The three canonical environments the system
 * supports, mirroring the standard CI/CD pipeline stages.
 *
 * - `dev` — development environment, fast feedback, relaxed SLAs.
 * - `staging` — pre-production mirror of production, integration testing.
 * - `prod` — production, requires approval at L3+, rollback guarantees.
 *
 * New environments (e.g. "canary", "dogfood") can be added via an ADR
 * if needed; the deploy agent's behavior may differ per environment.
 */
export type Environment = "dev" | "staging" | "prod";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/**
 * Deployment configuration. A free-form key-value map carrying the
 * agent-relevant config for this deploy (image tag, replicas, regions,
 * feature flags, etc.). The exact shape is provider-specific; the
 * contract does not prescribe specific keys — only that `config` must
 * be an object.
 *
 * For structured configs, prefer plain JSON-serializable values
 * (strings, numbers, booleans, arrays, objects).
 */
export type DeployConfig = Readonly<Record<string, unknown>>;

/* ------------------------------------------------------------------ */
/* Rollback policy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rollback strategy the deploy agent should use if health checks fail
 * or the deploy is interrupted.
 *
 * - `auto` — the agent automatically rolls back on failure.
 * - `manual` — the agent records the target but waits for human approval.
 * - `never` — no rollback is attempted; failures are left for manual remediation.
 *
 * `auto` is recommended for production deploys with proven rollback
 * procedures; `never` is appropriate for one-time migrations or
 * irreversible changes.
 */
export type RollbackPolicy = "auto" | "manual" | "never";

/* ------------------------------------------------------------------ */
/* Deploy status                                                       */
/* ------------------------------------------------------------------ */

/**
 * The outcome of a deploy run, covering the full lifecycle from queue
 * through cancellation. This is the SRE agent's primary recommendation
 * and maps to the ADR-0007 recommendation ladder:
 *
 * - `succeeded` → approve
 * - `partially_succeeded` → approve-with-nits
 * - `failed` → request-changes
 * - `cancelled` → cancelled (no action needed)
 * - `queued` → not yet determined
 * - `in_progress` → in progress
 *
 * New statuses can be added if needed; existing consumers must treat
 * unknown statuses as "needs_human".
 */
export type DeployStatus =
  | "queued"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "partially_succeeded"
  | "cancelled";

/* ------------------------------------------------------------------ */
/* Cost band (re-exported for convenience)                             */
/* ------------------------------------------------------------------ */

/**
 * Cost band values per ADR-0009, re-exported so SRE output consumers
 * can reference the band without importing from runtime/contract.ts.
 * The ADR-0009 rule is: elevated or runaway_risk bands at deploy start
 * are refusals; the band must be deterministic.
 */
export type CostBand = "normal" | "elevated" | "runaway_risk" | "unknown";

/* ------------------------------------------------------------------ */
/* Cost envelope                                                       */
/* ------------------------------------------------------------------ */

/**
 * Cost evidence for a deploy run. Mirrors the ADR-0009 cost structure
 * so the SRE output is directly legible alongside the core RunReport.
 */
export interface DeployCost {
  /** ADR-0009 cost band. Deterministic for every non-dry run. */
  band: CostBand;
  /** Numeric budget cap from the ticket. `null` = not set. */
  budget_cap_usd: number | null;
  /** Actual spend in USD. `null` = not measured. */
  spent_usd: number | null;
}

/* ------------------------------------------------------------------ */
/* Health check result                                                 */
/* ------------------------------------------------------------------ */

/**
 * A single health-check finding from the SRE deploy run. Matches the
 * ADR-0007 severity ladder: every finding is severity-tagged, and the
 * severity determines the merge/deploy gate.
 *
 * - `critical` — active breakage (down service, secret exposed).
 * - `high` — significant concern (high error rate, replication lag).
 * - `medium` — real concern (test gap, performance degradation).
 * - `low` — minor issue (doc drift, minor test gap).
 * - `info` — informational (nominal metric reading, baseline status).
 *
 * `latency_ms` is optional and carries the metric value for the check.
 */
export interface HealthCheckResult {
  /** Whether this check passed or failed. */
  status: "passed" | "failed";
  /** ADR-0007 severity. Determines the deploy gate. */
  severity: "critical" | "high" | "medium" | "low" | "info";
  /** Human-readable check name (e.g. "http-liveness", "db-replication"). */
  check: string;
  /** Human-readable message describing the result. */
  message: string;
  /**
   * Optional latency in milliseconds. Present when the check measures
   * a timing metric (e.g., response time, replication lag).
   */
  latency_ms?: number;
}

/* ------------------------------------------------------------------ */
/* Rollback capability                                                 */
/* ------------------------------------------------------------------ */

/**
 * Rollback capability metadata produced by the SRE agent. Indicates
 * whether the deploy can be rolled back, to what target, and how long
 * it would take.
 */
export interface RollbackCapability {
  /** Whether a rollback is possible. False when the change is irreversible. */
  can_rollback: boolean;
  /**
   * The target version to roll back to. `null` when `can_rollback` is false
   * or the target is not yet determined.
   */
  rollback_target: string | null;
  /**
   * Estimated rollback time in seconds. `null` when not measurable.
   * Helps humans decide between rolling back and hot-fixing.
   */
  estimated_rollback_time_s: number | null;
}

/* ------------------------------------------------------------------ */
/* Correlation (evidence pointers)                                     */
/* ------------------------------------------------------------------ */

/**
 * Evidence pointers linking the deploy to other system artefacts.
 * Mirrors the ADR-0006 `correlation` sub-object for cross-reference.
 */
export interface DeployCorrelation {
  /** PR URL if the deploy is associated with a PR. */
  pr_url?: string | null;
  /** Linear issue ID this deploy was triggered by. */
  linear_issue_id: string;
  /** Commit SHA being deployed. */
  commit_sha?: string | null;
  /**
   * Optional trace ID for distributed tracing integration.
   * Populated when the deploy agent is part of a larger run pipeline.
   */
  trace_id?: string | null;
}

/* ------------------------------------------------------------------ */
/* SRE Deploy Input                                                    */
/* ------------------------------------------------------------------ */

/**
 * The SRE/deploy agent's input contract. Carries everything the agent
 * needs to execute a deployment.
 *
 * Fields:
 * - `schema_version` — the contract version this input conforms to.
 * - `deploy_target` — the service/component being deployed.
 * - `environment` — dev, staging, or prod.
 * - `config` — deployment configuration (image tag, replicas, etc.).
 * - `rollback_policy` — how the agent handles failures.
 * - `run_id` (optional) — unique identifier for this deploy run.
 * - `correlation` (optional) — evidence pointers to PR, ticket, commit.
 */
export interface SreDeployInput {
  schema_version: typeof SRE_DEPLOY_SCHEMA_VERSION;
  deploy_target: DeployTarget;
  environment: Environment;
  config: DeployConfig;
  rollback_policy: RollbackPolicy;
  run_id?: string;
  correlation?: DeployCorrelation;
}

/* ------------------------------------------------------------------ */
/* SRE Deploy Output                                                   */
/* ------------------------------------------------------------------ */

/**
 * The SRE/deploy agent's output contract. The structured envelope the
 * agent produces after executing a deployment, carrying all evidence
 * needed by the ICP runner and downstream consumers (Linear write-back,
 * retro aggregation, cost tracking).
 *
 * Fields:
 * - `schema_version` — the contract version this output conforms to.
 * - `deploy_status` — the outcome and primary recommendation.
 * - `health_check_results` — severity-tagged findings per ADR-0007.
 * - `rollback_capability` — whether and how to roll back.
 * - `cost` — cost evidence per ADR-0009.
 */
export interface SreDeployOutput {
  schema_version: typeof SRE_DEPLOY_SCHEMA_VERSION;
  deploy_status: DeployStatus;
  health_check_results: ReadonlyArray<HealthCheckResult>;
  rollback_capability: RollbackCapability;
  cost: DeployCost;
}

/* ------------------------------------------------------------------ */
/* Helper: project DeployStatus → ADR-0007 recommendation               */
/* ------------------------------------------------------------------ */

/**
 * Project `DeployStatus` onto the ADR-0007 recommendation ladder so
 * downstream consumers (Linear write-back, retro aggregation) can
 * consume the SRE output without knowing the SRE-specific enum.
 *
 * Mapping:
 * - succeeded → approve
 * - partially_succeeded → approve-with-nits
 * - failed → request-changes
 * - cancelled → cancelled (no action)
 * - queued / in_progress → needs_human
 */
export type Recommendation =
  | "approve"
  | "approve-with-nits"
  | "request-changes"
  | "block-merge"
  | "needs-human";

export function deployStatusToRecommendation(
  status: DeployStatus,
): Recommendation {
  switch (status) {
    case "succeeded":
      return "approve";
    case "partially_succeeded":
      return "approve-with-nits";
    case "failed":
      return "request-changes";
    case "cancelled":
      return "needs-human";
    case "queued":
    case "in_progress":
    default:
      return "needs-human";
  }
}

/* ------------------------------------------------------------------ */
/* Helper: extract highest severity from health check results           */
/* ------------------------------------------------------------------ */

/**
 * Find the highest severity across all health check results.
 * Returns "info" when there are no checks (all passed).
 *
 * Severity ordering (lowest to highest): info < low < medium < high < critical.
 */
export const SEVERITY_ORDER: readonly ("info" | "low" | "medium" | "high" | "critical")[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

export function highestSeverity(
  results: ReadonlyArray<HealthCheckResult>,
): "info" | "low" | "medium" | "high" | "critical" {
  if (results.length === 0) return "info";
  let maxIdx = 0;
  for (const r of results) {
    const idx = SEVERITY_ORDER.indexOf(r.severity);
    if (idx > maxIdx) maxIdx = idx;
  }
  // maxIdx is always >= 0 here because we initialised it to 0 and only
  // increase it on positive indices.
  return SEVERITY_ORDER[maxIdx] as "info" | "low" | "medium" | "high" | "critical";
}
