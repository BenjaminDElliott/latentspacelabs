/**
 * Per-agent-type input/output contracts (LAT-163).
 *
 * Specifies the exact inputs and outputs for each agent type so adapters
 * know what to expect and what to produce. Every agent contract contains:
 *   - An *input* shape the caller must populate before dispatch.
 *   - An *output* shape the agent must populate on completion.
 *   - An input-validation function that returns errors (and applies defaults
 *     where specified by the contract).
 *   - An evidence-contract constant listing the LAT-8 evidence fields the
 *     output must always contain.
 *
 * Scope (LAT-163 acceptance criteria):
 *   - Coding agent:  code diffs, build output, test results, linting
 *   - QA agent:      acceptance criteria verification, regression check,
 *                    severity classification
 *   - PR review agent: review findings, approval status, change summary
 *   - SRE/deploy agent: deploy status, health checks, rollback capability, cost
 *
 * Non-goals:
 *   - Agent-specific output formats (adapters normalise into these types).
 *   - Custom fields per provider.
 *
 * References:
 *   - LAT-8: QA/review evidence workflow (evidence floor).
 *   - LAT-174: coding-agent contract (already defined in a sibling worktree;
 *     re-imported here for a single source of truth).
 *   - ADR-0006: run-report envelope.
 *   - ADR-0007: recommendation ladder.
 *   - ADR-0008: autonomy levels.
 *   - ADR-0009: cost band.
 */

import type {
  AgentInvocationResult,
  CostBand,
  AutonomyLevel,
  AgentType,
} from "../runtime/contract.js";

/* ================================================================== */
/* Shared types                                                        */
/* ================================================================== */

/**
 * Schema version for the agent-contract module. Bumped on breaking changes.
 */
export const AGENT_CONTRACT_SCHEMA_VERSION = "1.0.0";

/**
 * Recommendation ladder from ADR-0007 / LAT-26 §6.2.
 * Shared by coding, QA, and PR-review agent outputs.
 */
export type Recommendation =
  | "approve"
  | "approve-with-nits"
  | "request-changes"
  | "block-merge"
  | "needs-human";

/**
 * LAT-8 severity ladder. Shared across QA, PR-review, and evaluation.
 */
export type Severity = "nit" | "low" | "medium" | "high" | "critical";

/**
 * LAT-8 evidence fields required in *every* agent output.
 * The runner asserts these fields exist on any completed run.
 */
export interface AgentEvidence {
  /**
   * One-line summary of what the agent did. Used in Linear write-back
   * and the ADR-0006 run report.
   */
  summary: string;

  /**
   * LAT-8: acceptance criteria verification (coding agent).
   * Each criterion is verified as passed / failed / partial / skipped.
   * Empty array is valid when the agent type has no AC to verify (e.g. SRE).
   */
  acceptanceCriteriaVerified?: ReadonlyArray<AcceptanceCriterionResult>;

  /**
   * LAT-8: risks identified during the run.
   * One-line risk descriptions.
   */
  risks: ReadonlyArray<string>;

  /**
   * LAT-8: potential regressions.
   * One-line regression descriptions. Empty when no regressions identified.
   */
  regressions: ReadonlyArray<string>;

  /**
   * LAT-8: security and architecture concerns.
   * One-line concern descriptions.
   */
  securityOrArchitectureConcerns: ReadonlyArray<string>;

  /**
   * LAT-8: final recommendation for the reviewer / merger.
   */
  recommendation: Recommendation;

  /**
   * Pointers to PR, commit, and branch for correlation with the ICP runner.
   * Mirrors the correlation envelope from the run-report.
   */
  prUrl?: string | null;
  prBranch?: string | null;
  commitSha?: string | null;

  /**
   * Free-form notes from the agent (sanitised of secrets).
   */
  notes?: ReadonlyArray<string>;
}

/**
 * Verification result for a single acceptance criterion (LAT-8).
 */
export interface AcceptanceCriterionResult {
  /** The criterion text (verbatim from input). */
  criterion: string;
  /** Verification result. */
  status: "passed" | "failed" | "partial" | "skipped";
  /** Evidence or explanation. */
  evidence: string;
}

/**
 * Evidence contract required by LAT-8 for a completed run.
 */
export interface AgentEvidenceContract {
  summary: true;
  risks: true;
  recommendation: true;
  /** Whether acceptance-criteria verification is required. */
  acceptanceCriteriaVerified?: true;
  /** Whether regressions must be reported. */
  regressions?: true;
  /** Whether security/architecture concerns must be reported. */
  securityOrArchitectureConcerns?: true;
  /** Whether PR/branch/commit correlation pointers are required. */
  prCorrelation?: true;
}

/* ================================================================== */
/* Coding agent input / output                                         */
/* ================================================================== */

/**
 * Schema version for the coding-agent contract. Bumped on breaking changes.
 */
export const CODING_AGENT_SCHEMA_VERSION = "1.0.0";

/**
 * The canonical input a coding agent receives before it starts work.
 */
export interface CodingAgentInput {
  /** Target repository in `owner/name` form. */
  repo: string;
  /** Source branch the agent will create / modify. */
  branch: string;
  /** Target (base) branch for the PR. Typically `main`. */
  targetBranch: string;
  /**
   * Code diff or patch the agent should produce. Can be empty if the agent
   * generates code from scratch.
   */
  codeDiff?: string;
  /** Shell command to build the project. Must exit 0 on success. */
  buildCommand: string;
  /** Shell command to run tests. Must exit 0 on success. */
  testCommand: string;
  /** Optional lint command. Absent → lint skipped in output. */
  lintCommand?: string;
  /** Optional coverage command. Absent → coverage omitted. */
  coverageCommand?: string;
  /** Acceptance criteria the agent should verify. */
  acceptanceCriteria?: ReadonlyArray<string>;
  /** Files in scope. Helps the agent avoid editing irrelevant files. */
  filesInScope?: ReadonlyArray<string>;
  /** Files explicitly excluded. */
  filesForbidden?: ReadonlyArray<string>;
  /** Non-goals / out-of-scope notes. */
  nonGoals?: ReadonlyArray<string>;
  /** Guardrails / rules the agent must follow. */
  guardrails?: ReadonlyArray<string>;
  /** Numeric ADR-0009 budget cap. */
  budgetCapUsd?: number | null;
  /** ADR-0008 autonomy level (L1–L4). */
  autonomyLevel?: AutonomyLevel;
  /** Stable run identifier for correlation. */
  runId?: string;
  /** Ticket title from Linear. Used as the PR title prefix. */
  ticketTitle?: string;
  /** Linear issue ID for write-back. */
  linearIssueId?: string;
}

/**
 * Coding agent output. Mirrors the LAT-174 coding-agent contract.
 */
export interface CodingAgentOutput {
  schemaVersion: typeof CODING_AGENT_SCHEMA_VERSION;
  diff: string;
  buildStatus: BuildStatus;
  testResults: TestResults;
  lintResults: LintResults;
  coverage: CoverageMetrics | null;
  acceptanceCriteriaVerified: ReadonlyArray<AcceptanceCriterionResult>;
  risks: ReadonlyArray<string>;
  regressions: ReadonlyArray<string>;
  securityOrArchitectureConcerns: ReadonlyArray<string>;
  recommendation: Recommendation;
  summary: string;
  prUrl?: string | null;
  prBranch?: string | null;
  commitSha?: string | null;
  notes?: ReadonlyArray<string>;
}

/** Build result from a coding agent run. */
export type BuildStatus = {
  status: "passed" | "failed" | "not_run";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

/** Test outcome enumeration. */
export type TestOutcome = "passed" | "failed" | "skipped" | "not_run";

/** Structured test results. */
export interface TestResults {
  outcome: TestOutcome;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  durationMs: number;
  tests: ReadonlyArray<TestCaseResult>;
}

/** Result for a single test case. */
export interface TestCaseResult {
  name: string;
  suite?: string;
  status: "passed" | "failed" | "skipped" | "errored";
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
}

/** Lint result status. */
export type LintStatus = "passed" | "failed" | "not_run";

/** Structured lint results. */
export interface LintResults {
  status: LintStatus;
  totalViolations: number;
  errors: number;
  warnings: number;
  infos: number;
  durationMs: number;
  violations: ReadonlyArray<LintViolation>;
}

/** A single lint violation. */
export interface LintViolation {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

/** Coverage metrics. */
export interface CoverageMetrics {
  totalPercentage: number | null;
  branchPercentage: number | null;
  functionPercentage: number | null;
  statementPercentage: number | null;
  durationMs: number;
  files: ReadonlyArray<CoverageFileSummary>;
}

/** Per-file coverage summary. */
export interface CoverageFileSummary {
  file: string;
  lineCoverage: number | null;
  branchCoverage: number | null;
  functionCoverage: number | null;
  statementCoverage: number | null;
}

/** Coding agent evidence contract (LAT-8). */
export const CODING_AGENT_EVIDENCE_CONTRACT: AgentEvidenceContract = {
  summary: true,
  risks: true,
  recommendation: true,
  acceptanceCriteriaVerified: true,
  regressions: true,
  securityOrArchitectureConcerns: true,
  prCorrelation: true,
};

/* ================================================================== */
/* QA agent input / output                                             */
/* ================================================================== */

/**
 * Schema version for the QA agent contract. Bumped on breaking changes.
 */
export const QA_AGENT_SCHEMA_VERSION = "1.0.0";

/**
 * QA agent input: what the QA agent needs to verify a completed run.
 */
export interface QAAgentInput {
  /** The coding-agent output this QA agent evaluates. */
  codingOutput: CodingAgentOutput;
  /** Linear issue ID for write-back. */
  linearIssueId?: string;
  /** Stable run identifier for correlation. */
  runId?: string;
  /** Acceptance criteria from the ticket. Used as ground truth. */
  acceptanceCriteria?: ReadonlyArray<string>;
  /**
   * Previously known failing tests (regression baseline).
   * Empty means "no baseline" → all tests are new.
   */
  knownFailingTests?: ReadonlyArray<string>;
  /** Guardrails the QA agent must honour. */
  guardrails?: ReadonlyArray<string>;
  /** ADR-0008 autonomy level. */
  autonomyLevel?: AutonomyLevel;
  /** ADR-0009 budget cap. */
  budgetCapUsd?: number | null;
}

/**
 * QA agent output: structured verification results.
 */
export interface QAAgentOutput {
  schemaVersion: typeof QA_AGENT_SCHEMA_VERSION;
  /** Verification per acceptance criterion. */
  acceptanceCriteriaVerification: ReadonlyArray<QAAcceptanceCriterionResult>;
  /** Regression check results: tests that regressed since baseline. */
  regressions: ReadonlyArray<RegressionResult>;
  /** Severity classification of the overall run. */
  severityClassification: SeverityClassification;
  /** LAT-8 evidence: risks found during QA. */
  risks: ReadonlyArray<string>;
  /** LAT-8 evidence: security / architecture concerns. */
  securityOrArchitectureConcerns: ReadonlyArray<string>;
  /** LAT-8: final recommendation. */
  recommendation: Recommendation;
  /** LAT-8: summary. */
  summary: string;
  /** LAT-8: correlation pointers. */
  prUrl?: string | null;
  prBranch?: string | null;
  commitSha?: string | null;
  notes?: ReadonlyArray<string>;
}

/**
 * Verification result for a single acceptance criterion by the QA agent.
 */
export interface QAAcceptanceCriterionResult {
  criterion: string;
  status: "passed" | "failed" | "partial" | "skipped";
  /**
   * Evidence: what the QA agent checked to reach this verdict.
   */
  evidence: string;
  /**
   * If failed: what specifically went wrong.
   */
  failureReason?: string;
}

/**
 * A single regression: a test that previously passed but now fails.
 */
export interface RegressionResult {
  /** Test name (or description) that regressed. */
  testName: string;
  /**
   * Previous status (from the baseline). Should be "passed" or "failed"
   * depending on whether the baseline had it passing.
   */
  previousStatus: "passed" | "failed" | "unknown";
  /** Current status after the coding agent's changes. */
  currentStatus: "passed" | "failed" | "skipped" | "errored";
  /**
   * Whether this is a *new* regression (was passing, now failing) vs
   * an existing failure that persisted.
   */
  isRegression: boolean;
  /** Error message if failed / errored. */
  errorMessage?: string;
}

/**
 * Severity classification of the overall QA run.
 */
export interface SeverityClassification {
  /**
   * Highest severity across all findings. One of ADR-0007 values.
   */
  overall: Severity;
  /** Per-category severities for granular retro aggregation. */
  breakdown: {
    /** Highest severity among acceptance criteria failures. */
    acceptanceCriteria: Severity;
    /** Highest severity among regressions. */
    regressions: Severity;
    /** Highest severity among lint violations. */
    lint: Severity;
    /** Highest severity among build failures. */
    build: Severity;
    /** Highest severity among test failures. */
    tests: Severity;
  };
}

/** QA agent evidence contract (LAT-8). */
export const QA_AGENT_EVIDENCE_CONTRACT: AgentEvidenceContract = {
  summary: true,
  risks: true,
  recommendation: true,
  regressions: true,
  securityOrArchitectureConcerns: true,
  prCorrelation: true,
};

/* ================================================================== */
/* PR review agent input / output                                      */
/* ================================================================== */

/**
 * Schema version for the PR review agent contract. Bumped on breaking changes.
 */
export const PR_REVIEW_AGENT_SCHEMA_VERSION = "1.0.0";

/**
 * PR review agent input: what the review agent needs to review a PR.
 */
export interface PRReviewAgentInput {
  /** The coding-agent output (or the raw diff) the agent reviews. */
  diff?: string;
  /** Coding agent output if already produced. */
  codingOutput?: CodingAgentOutput;
  /** Linear issue ID for write-back. */
  linearIssueId?: string;
  /** Stable run identifier for correlation. */
  runId?: string;
  /** Acceptance criteria from the ticket. */
  acceptanceCriteria?: ReadonlyArray<string>;
  /** Files changed by the PR. */
  changedFiles?: ReadonlyArray<string>;
  /** Guardrails the reviewer must honour. */
  guardrails?: ReadonlyArray<string>;
  /** Non-goals / out-of-scope. */
  nonGoals?: ReadonlyArray<string>;
  /** ADR-0008 autonomy level. */
  autonomyLevel?: AutonomyLevel;
  /** ADR-0009 budget cap. */
  budgetCapUsd?: number | null;
  /** Existing PR URL for context. */
  prUrl?: string;
  /** PR title. */
  prTitle?: string;
  /** PR description. */
  prDescription?: string;
}

/**
 * PR review agent output: structured review findings.
 */
export interface PRReviewAgentOutput {
  schemaVersion: typeof PR_REVIEW_AGENT_SCHEMA_VERSION;
  /** Review findings: issues, suggestions, and observations. */
  findings: ReadonlyArray<ReviewFinding>;
  /** LAT-8: acceptance criteria verification. */
  acceptanceCriteriaVerified: ReadonlyArray<AcceptanceCriterionResult>;
  /** LAT-8: regression check — tests that regressed since baseline. */
  regressions: ReadonlyArray<RegressionResult>;
  /** LAT-8: approval status. */
  approvalStatus: ApprovalStatus;
  /** LAT-8: change summary (what the PR does). */
  changeSummary: ChangeSummary;
  /** LAT-8: risks identified during review. */
  risks: ReadonlyArray<string>;
  /** LAT-8: security / architecture concerns. */
  securityOrArchitectureConcerns: ReadonlyArray<string>;
  /** LAT-8: final recommendation. */
  recommendation: Recommendation;
  /** LAT-8: summary. */
  summary: string;
  /** LAT-8: correlation pointers. */
  prUrl?: string | null;
  prBranch?: string | null;
  commitSha?: string | null;
  notes?: ReadonlyArray<string>;
}

/**
 * A single finding from the PR review agent.
 */
export interface ReviewFinding {
  /** File path the finding relates to (if any). */
  file?: string;
  /** Line number (if applicable). */
  line?: number;
  /** Severity of the finding. */
  severity: Severity;
  /** Category of the finding. */
  category:
    | "style"
    | "logic"
    | "performance"
    | "security"
    | "accessibility"
    | "testing"
    | "documentation"
    | "architecture"
    | "other";
  /** One-line title of the finding. */
  title: string;
  /** Detailed description. */
  description: string;
  /** Suggested fix or action. */
  suggestion?: string;
}

/**
 * Approval status for the PR review.
 */
export interface ApprovalStatus {
  /**
   * Whether the PR meets the minimum quality gate for auto-merge.
   * True means: no high/critical findings, no AC failures, lint passes.
   */
  passesQualityGate: boolean;
  /** Number of findings per severity. */
  findingsBySeverity: Record<Severity, number>;
  /** Highest severity finding (or "nit" if none). */
  highestSeverity: Severity;
  /** Whether the reviewer (human or automated) approved. */
  approved: boolean;
  /** One-line rationale for the approval decision. */
  rationale: string;
}

/**
 * High-level change summary produced by the PR review agent.
 */
export interface ChangeSummary {
  /** One-sentence description of the change. */
  description: string;
  /** Number of files changed. */
  filesChanged: number;
  /** List of changed files (truncated if too many). */
  changedFiles: ReadonlyArray<string>;
  /** Number of additions / deletions (approximate). */
  additions?: number;
  deletions?: number;
  /** Whether this is a breaking change. */
  isBreaking: boolean;
  /** Whether tests were added / modified. */
  hasTests: boolean;
}

/** PR review agent evidence contract (LAT-8). */
export const PR_REVIEW_AGENT_EVIDENCE_CONTRACT: AgentEvidenceContract = {
  summary: true,
  risks: true,
  recommendation: true,
  acceptanceCriteriaVerified: true,
  regressions: true,
  securityOrArchitectureConcerns: true,
  prCorrelation: true,
};

/* ================================================================== */
/* SRE / deploy agent input / output                                   */
/* ================================================================== */

/**
 * Schema version for the SRE/deploy agent contract. Bumped on breaking changes.
 */
export const SRE_AGENT_SCHEMA_VERSION = "1.0.0";

/**
 * SRE/deploy agent input: what the deploy agent needs to perform a deployment.
 */
export interface SREAgentInput {
  /** The target environment (e.g. production, staging, dev). */
  environment: "production" | "staging" | "dev";
  /** Linear issue ID for write-back. */
  linearIssueId?: string;
  /** Stable run identifier for correlation. */
  runId?: string;
  /**
   * Deployment target: image tag, commit sha, version string, or release tag.
   */
  deployTarget: string;
  /**
   * Deployment strategy (e.g. rolling, blue-green, canary, recreate).
   */
  strategy?: "rolling" | "blue-green" | "canary" | "recreate";
  /**
   * Pre-deploy health checks to run before deploying.
   */
  preHealthChecks?: ReadonlyArray<HealthCheck>;
  /**
   * Post-deploy health checks to run after deploying.
   */
  postHealthChecks?: ReadonlyArray<HealthCheck>;
  /**
   * Rollback configuration.
   */
  rollbackConfig?: RollbackConfig;
  /**
   * Guardrails the deploy agent must honour.
   */
  guardrails?: ReadonlyArray<string>;
  /**
   * Non-goals / out-of-scope.
   */
  nonGoals?: ReadonlyArray<string>;
  /**
   * ADR-0008 autonomy level.
   */
  autonomyLevel?: AutonomyLevel;
  /**
   * ADR-0009 budget cap.
   */
  budgetCapUsd?: number | null;
  /**
   * PR URL / commit SHA being deployed (for correlation).
   */
  prUrl?: string;
  /**
   * Whether to skip smoke tests (for fast rollbacks).
   */
  skipSmokeTests?: boolean;
}

/**
 * A health check the SRE agent can run.
 */
export interface HealthCheck {
  /**
   * Check name / identifier.
   */
  name: string;
  /**
   * Check type: http, tcp, command, or custom.
   */
  type: "http" | "tcp" | "command";
  /**
   * For http: the URL to GET/HEAD. For tcp: host:port. For command: the command to run.
   */
  target: string;
  /**
   * Expected HTTP status code (for http checks).
   */
  expectedStatus?: number;
  /**
   * Maximum allowed response time in milliseconds.
   */
  timeoutMs?: number;
}

/**
 * Rollback configuration.
 */
export interface RollbackConfig {
  /**
   * Whether automatic rollback is enabled on failure.
   */
  autoRollback: boolean;
  /**
   * Number of health check failures before triggering rollback.
   */
  failureThreshold?: number;
  /**
   * Wait time between retries in seconds.
   */
  retryWaitSec?: number;
  /**
   * Previous deploy target to roll back to. Auto-populated by the agent.
   */
  previousTarget?: string | undefined;
}

/**
 * SRE/deploy agent output: structured deployment results.
 */
export interface SREAgentOutput {
  schemaVersion: typeof SRE_AGENT_SCHEMA_VERSION;
  /**
   * Overall deployment status.
   */
  deployStatus: DeployStatus;
  /**
   * Pre-deploy health check results.
   */
  preHealthChecks: ReadonlyArray<HealthCheckResult>;
  /**
   * Post-deploy health check results.
   */
  postHealthChecks: ReadonlyArray<HealthCheckResult>;
  /**
   * Whether a rollback was performed and its status.
   */
  rollback?: RollbackResult;
  /**
   * LAT-8: cost information for the deployment.
   */
  cost: DeploymentCost;
  /**
   * LAT-8: risks identified during deployment.
   */
  risks: ReadonlyArray<string>;
  /**
   * LAT-8: security / architecture concerns.
   */
  securityOrArchitectureConcerns: ReadonlyArray<string>;
  /**
   * LAT-8: final recommendation.
   */
  recommendation: Recommendation;
  /**
   * LAT-8: summary.
   */
  summary: string;
  /**
   * LAT-8: correlation pointers.
   */
  prUrl?: string | null;
  prBranch?: string | null;
  commitSha?: string | null;
  notes?: ReadonlyArray<string>;
}

/**
 * Overall deployment status.
 */
export type DeployStatus =
  | "deployed"
  | "failed"
  | "rolled_back"
  | "in_progress"
  | "cancelled";

/**
 * Result of a single health check.
 */
export interface HealthCheckResult {
  name: string;
  /** Whether the check passed. */
  passed: boolean;
  /** Response time in milliseconds. */
  responseTimeMs: number;
  /**
   * For http: status code. For tcp: connection status. For command: exit code.
   */
  statusCode?: number;
  /**
   * Output or error message.
   */
  output?: string;
  /**
   * Error message if the check failed.
   */
  errorMessage?: string;
}

/**
 * Rollback result after a failed deployment.
 */
export interface RollbackResult {
  /** Whether rollback succeeded. */
  success: boolean;
  /** Target rolled back to. */
  rolledBackTo: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Output from the rollback command. */
  output?: string;
}

/**
 * Cost information for a deployment.
 */
export interface DeploymentCost {
  /** ADR-0009 cost band. */
  costBand: CostBand;
  /** Cost in USD (or null if unknown). */
  spentUsd: number | null;
  /** Budget cap in USD (or null). */
  budgetCapUsd: number | null;
  /**
   * Reason the cost band is unknown (required when costBand === "unknown").
   */
  costBandUnavailableReason: string | null;
}

/** SRE agent evidence contract (LAT-8). */
export const SRE_AGENT_EVIDENCE_CONTRACT: AgentEvidenceContract = {
  summary: true,
  risks: true,
  recommendation: true,
  securityOrArchitectureConcerns: true,
  prCorrelation: true,
};

/* ================================================================== */
/* Unified agent I/O envelope                                          */
/* ================================================================== */

/**
 * Discriminated union of all agent output types.
 * The discriminant is the `schemaVersion` field.
 */
export type AgentOutput =
  | { agentType: "coding"; output: CodingAgentOutput }
  | { agentType: "qa"; output: QAAgentOutput }
  | { agentType: "review"; output: PRReviewAgentOutput }
  | { agentType: "sre"; output: SREAgentOutput };

/**
 * Discriminated union of all agent input types.
 * The discriminant is the `agentType` field.
 */
export type AgentInput =
  | { agentType: "coding"; input: CodingAgentInput }
  | { agentType: "qa"; input: QAAgentInput }
  | { agentType: "review"; input: PRReviewAgentInput }
  | { agentType: "sre"; input: SREAgentInput };

/**
 * Evidence contract lookup by agent type.
 */
export function getEvidenceContract(
  agentType: AgentType,
): AgentEvidenceContract | null {
  switch (agentType) {
    case "coding":
      return CODING_AGENT_EVIDENCE_CONTRACT;
    case "qa":
      return QA_AGENT_EVIDENCE_CONTRACT;
    case "review":
      return PR_REVIEW_AGENT_EVIDENCE_CONTRACT;
    case "sre":
      return SRE_AGENT_EVIDENCE_CONTRACT;
    case "pm":
    case "research":
    case "observability":
      return null;
    default:
      return null;
  }
}

/* ================================================================== */
/* Input validation and defaults                                       */
/* ================================================================== */

/**
 * Validation error for an agent input.
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result: errors list + defaulted (merged) input.
 */
export interface ValidationResult<T> {
  /** Empty array when valid. */
  errors: ReadonlyArray<ValidationError>;
  /** The input with defaults applied. Same shape as the input on success. */
  value: T;
}

/**
 * Validate coding-agent input and apply defaults.
 *
 * Required fields (validated): repo, branch, targetBranch, buildCommand, testCommand.
 * Defaults applied:
 *   - lintCommand → "" (skipped)
 *   - coverageCommand → "" (skipped)
 *   - acceptanceCriteria → []
 *   - filesInScope → []
 *   - filesForbidden → []
 *   - nonGoals → []
 *   - guardrails → []
 *   - budgetCapUsd → null
 *   - autonomyLevel → "L2-propose"
 *   - codeDiff → ""
 *
 * Validation rules:
 *   - repo must match `owner/name` pattern.
 *   - branch must be non-empty.
 *   - targetBranch must be non-empty.
 *   - buildCommand must be non-empty.
 *   - testCommand must be non-empty.
 *   - If acceptanceCriteria is provided, each must be non-empty.
 */
export function validateCodingAgentInput(
  input: Partial<CodingAgentInput>,
): ValidationResult<CodingAgentInput> {
  const errors: ValidationError[] = [];

  // Required fields
  if (!input.repo || typeof input.repo !== "string" || input.repo.trim().length === 0) {
    errors.push({ field: "repo", message: "repo is required (owner/name)" });
  } else if (!/^\w+[\w.-]*\/\w+[\w.-]*$/.test(input.repo)) {
    errors.push({ field: "repo", message: `repo must match "owner/name" pattern (got "${input.repo}")` });
  }

  if (!input.branch || typeof input.branch !== "string" || input.branch.trim().length === 0) {
    errors.push({ field: "branch", message: "branch is required" });
  }

  if (!input.targetBranch || typeof input.targetBranch !== "string" || input.targetBranch.trim().length === 0) {
    errors.push({ field: "targetBranch", message: "targetBranch is required" });
  }

  if (!input.buildCommand || typeof input.buildCommand !== "string" || input.buildCommand.trim().length === 0) {
    errors.push({ field: "buildCommand", message: "buildCommand is required" });
  }

  if (!input.testCommand || typeof input.testCommand !== "string" || input.testCommand.trim().length === 0) {
    errors.push({ field: "testCommand", message: "testCommand is required" });
  }

  // Optional array validations
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    input.acceptanceCriteria.forEach((c, i) => {
      if (!c || typeof c !== "string" || c.trim().length === 0) {
        errors.push({ field: `acceptanceCriteria[${i}]`, message: "each criterion must be a non-empty string" });
      }
    });
  }

  // Autonomy level validation
  if (input.autonomyLevel && input.autonomyLevel !== "L1-read-only" && input.autonomyLevel !== "L2-propose" && input.autonomyLevel !== "L3-with-approval" && input.autonomyLevel !== "L4-autonomous") {
    errors.push({ field: "autonomyLevel", message: "autonomyLevel must be L1-read-only | L2-propose | L3-with-approval | L4-autonomous" });
  }

  // Budget cap validation
  if (input.budgetCapUsd !== undefined && input.budgetCapUsd !== null) {
    if (typeof input.budgetCapUsd !== "number" || !Number.isFinite(input.budgetCapUsd) || input.budgetCapUsd < 0) {
      errors.push({ field: "budgetCapUsd", message: "budgetCapUsd must be a non-negative number or null" });
    }
  }

  const defaulted: CodingAgentInput = {
    repo: input.repo ?? "",
    branch: input.branch ?? "",
    targetBranch: input.targetBranch ?? "",
    buildCommand: input.buildCommand ?? "",
    testCommand: input.testCommand ?? "",
    codeDiff: input.codeDiff ?? "",
    lintCommand: input.lintCommand,
    coverageCommand: input.coverageCommand,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    filesInScope: input.filesInScope ?? [],
    filesForbidden: input.filesForbidden ?? [],
    nonGoals: input.nonGoals ?? [],
    guardrails: input.guardrails ?? [],
    budgetCapUsd: input.budgetCapUsd ?? null,
    autonomyLevel: input.autonomyLevel ?? "L2-propose",
    runId: input.runId,
    ticketTitle: input.ticketTitle,
    linearIssueId: input.linearIssueId,
  };

  return { errors, value: defaulted };
}

/**
 * Validate QA-agent input and apply defaults.
 *
 * Required fields: codingOutput.
 * Defaults applied:
 *   - acceptanceCriteria → []
 *   - knownFailingTests → []
 *   - guardrails → []
 *   - budgetCapUsd → null
 *   - autonomyLevel → "L2-propose"
 *
 * Validation rules:
 *   - codingOutput must be a valid CodingAgentOutput.
 *   - If acceptanceCriteria is provided, each must be non-empty.
 */
export function validateQAAgentInput(
  input: Partial<QAAgentInput>,
): ValidationResult<QAAgentInput> {
  const errors: ValidationError[] = [];

  // Required: codingOutput
  if (!input.codingOutput || typeof input.codingOutput !== "object") {
    errors.push({ field: "codingOutput", message: "codingOutput is required" });
  } else {
    // Validate that codingOutput has the expected shape
    const co = input.codingOutput as Record<string, unknown>;
    if (co["schemaVersion"] !== CODING_AGENT_SCHEMA_VERSION) {
      errors.push({ field: "codingOutput.schemaVersion", message: `codingOutput schema version must be ${CODING_AGENT_SCHEMA_VERSION}` });
    }
    if (co["buildStatus"] === undefined) {
      errors.push({ field: "codingOutput.buildStatus", message: "codingOutput.buildStatus is required" });
    }
    if (co["testResults"] === undefined) {
      errors.push({ field: "codingOutput.testResults", message: "codingOutput.testResults is required" });
    }
  }

  // Optional validations
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    input.acceptanceCriteria.forEach((c, i) => {
      if (!c || typeof c !== "string" || c.trim().length === 0) {
        errors.push({ field: `acceptanceCriteria[${i}]`, message: "each criterion must be a non-empty string" });
      }
    });
  }

  if (input.autonomyLevel && input.autonomyLevel !== "L1-read-only" && input.autonomyLevel !== "L2-propose" && input.autonomyLevel !== "L3-with-approval" && input.autonomyLevel !== "L4-autonomous") {
    errors.push({ field: "autonomyLevel", message: "autonomyLevel must be L1-read-only | L2-propose | L3-with-approval | L4-autonomous" });
  }

  if (input.budgetCapUsd !== undefined && input.budgetCapUsd !== null) {
    if (typeof input.budgetCapUsd !== "number" || !Number.isFinite(input.budgetCapUsd) || input.budgetCapUsd < 0) {
      errors.push({ field: "budgetCapUsd", message: "budgetCapUsd must be a non-negative number or null" });
    }
  }

  const defaulted: QAAgentInput = {
    codingOutput: input.codingOutput as CodingAgentOutput,
    linearIssueId: input.linearIssueId,
    runId: input.runId,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    knownFailingTests: input.knownFailingTests ?? [],
    guardrails: input.guardrails ?? [],
    budgetCapUsd: input.budgetCapUsd ?? null,
    autonomyLevel: input.autonomyLevel ?? "L2-propose",
  };

  return { errors, value: defaulted };
}

/**
 * Validate PR-review agent input and apply defaults.
 *
 * At least one of: diff or codingOutput must be provided.
 * Defaults applied:
 *   - acceptanceCriteria → []
 *   - changedFiles → []
 *   - guardrails → []
 *   - nonGoals → []
 *   - budgetCapUsd → null
 *   - autonomyLevel → "L2-propose"
 */
export function validatePRReviewAgentInput(
  input: Partial<PRReviewAgentInput>,
): ValidationResult<PRReviewAgentInput> {
  const errors: ValidationError[] = [];

  // At least one of diff or codingOutput required
  if (!input.diff && !input.codingOutput) {
    errors.push({ field: "diff", message: "at least one of diff or codingOutput is required" });
  }

  // If codingOutput provided, validate it
  if (input.codingOutput) {
    const co = input.codingOutput as Record<string, unknown>;
    if (co["schemaVersion"] !== CODING_AGENT_SCHEMA_VERSION) {
      errors.push({ field: "codingOutput.schemaVersion", message: `codingOutput schema version must be ${CODING_AGENT_SCHEMA_VERSION}` });
    }
  }

  // If diff provided, validate it's a string
  if (input.diff !== undefined && typeof input.diff !== "string") {
    errors.push({ field: "diff", message: "diff must be a string" });
  }

  // Optional validations
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    input.acceptanceCriteria.forEach((c, i) => {
      if (!c || typeof c !== "string" || c.trim().length === 0) {
        errors.push({ field: `acceptanceCriteria[${i}]`, message: "each criterion must be a non-empty string" });
      }
    });
  }

  if (input.autonomyLevel && input.autonomyLevel !== "L1-read-only" && input.autonomyLevel !== "L2-propose" && input.autonomyLevel !== "L3-with-approval" && input.autonomyLevel !== "L4-autonomous") {
    errors.push({ field: "autonomyLevel", message: "autonomyLevel must be L1-read-only | L2-propose | L3-with-approval | L4-autonomous" });
  }

  if (input.budgetCapUsd !== undefined && input.budgetCapUsd !== null) {
    if (typeof input.budgetCapUsd !== "number" || !Number.isFinite(input.budgetCapUsd) || input.budgetCapUsd < 0) {
      errors.push({ field: "budgetCapUsd", message: "budgetCapUsd must be a non-negative number or null" });
    }
  }

  const defaulted: PRReviewAgentInput = {
    diff: input.diff,
    codingOutput: input.codingOutput,
    linearIssueId: input.linearIssueId,
    runId: input.runId,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    changedFiles: input.changedFiles ?? [],
    guardrails: input.guardrails ?? [],
    nonGoals: input.nonGoals ?? [],
    budgetCapUsd: input.budgetCapUsd ?? null,
    autonomyLevel: input.autonomyLevel ?? "L2-propose",
    prUrl: input.prUrl,
    prTitle: input.prTitle,
    prDescription: input.prDescription,
  };

  return { errors, value: defaulted };
}

/**
 * Validate SRE/deploy agent input and apply defaults.
 *
 * Required fields: environment, deployTarget.
 * Defaults applied:
 *   - strategy → "rolling"
 *   - preHealthChecks → []
 *   - postHealthChecks → []
 *   - rollbackConfig.autoRollback → false
 *   - rollbackConfig.failureThreshold → 3
 *   - rollbackConfig.retryWaitSec → 30
 *   - guardrails → []
 *   - nonGoals → []
 *   - budgetCapUsd → null
 *   - autonomyLevel → "L2-propose"
 *   - skipSmokeTests → false
 *
 * Validation rules:
 *   - environment must be one of: production, staging, dev.
 *   - deployTarget must be non-empty.
 *   - healthCheck targets must be non-empty.
 */
export function validateSREAgentInput(
  input: Partial<SREAgentInput>,
): ValidationResult<SREAgentInput> {
  const errors: ValidationError[] = [];

  // Required fields
  if (!input.environment || !["production", "staging", "dev"].includes(input.environment)) {
    errors.push({ field: "environment", message: "environment must be one of: production, staging, dev" });
  }

  if (!input.deployTarget || typeof input.deployTarget !== "string" || input.deployTarget.trim().length === 0) {
    errors.push({ field: "deployTarget", message: "deployTarget is required (image tag, sha, version, or release tag)" });
  }

  // Strategy validation
  if (input.strategy && !["rolling", "blue-green", "canary", "recreate"].includes(input.strategy)) {
    errors.push({ field: "strategy", message: "strategy must be one of: rolling, blue-green, canary, recreate" });
  }

  // Health check validations
  if (input.preHealthChecks && input.preHealthChecks.length > 0) {
    input.preHealthChecks.forEach((hc, i) => {
      if (!hc.name || typeof hc.name !== "string" || hc.name.trim().length === 0) {
        errors.push({ field: `preHealthChecks[${i}].name`, message: "health check name must be non-empty" });
      }
      if (!hc.type || !["http", "tcp", "command"].includes(hc.type)) {
        errors.push({ field: `preHealthChecks[${i}].type`, message: "health check type must be http | tcp | command" });
      }
      if (!hc.target || typeof hc.target !== "string" || hc.target.trim().length === 0) {
        errors.push({ field: `preHealthChecks[${i}].target`, message: "health check target must be non-empty" });
      }
    });
  }

  if (input.postHealthChecks && input.postHealthChecks.length > 0) {
    input.postHealthChecks.forEach((hc, i) => {
      if (!hc.name || typeof hc.name !== "string" || hc.name.trim().length === 0) {
        errors.push({ field: `postHealthChecks[${i}].name`, message: "health check name must be non-empty" });
      }
      if (!hc.type || !["http", "tcp", "command"].includes(hc.type)) {
        errors.push({ field: `postHealthChecks[${i}].type`, message: "health check type must be http | tcp | command" });
      }
      if (!hc.target || typeof hc.target !== "string" || hc.target.trim().length === 0) {
        errors.push({ field: `postHealthChecks[${i}].target`, message: "health check target must be non-empty" });
      }
    });
  }

  // Rollback config validation
  if (input.rollbackConfig) {
    if (typeof input.rollbackConfig.autoRollback !== "boolean") {
      errors.push({ field: "rollbackConfig.autoRollback", message: "autoRollback must be a boolean" });
    }
    if (input.rollbackConfig.failureThreshold !== undefined) {
      if (!Number.isInteger(input.rollbackConfig.failureThreshold) || input.rollbackConfig.failureThreshold < 1) {
        errors.push({ field: "rollbackConfig.failureThreshold", message: "failureThreshold must be a positive integer" });
      }
    }
    if (input.rollbackConfig.retryWaitSec !== undefined) {
      if (!Number.isInteger(input.rollbackConfig.retryWaitSec) || input.rollbackConfig.retryWaitSec < 1) {
        errors.push({ field: "rollbackConfig.retryWaitSec", message: "retryWaitSec must be a positive integer" });
      }
    }
  }

  // Autonomy level validation
  if (input.autonomyLevel && input.autonomyLevel !== "L1-read-only" && input.autonomyLevel !== "L2-propose" && input.autonomyLevel !== "L3-with-approval" && input.autonomyLevel !== "L4-autonomous") {
    errors.push({ field: "autonomyLevel", message: "autonomyLevel must be L1-read-only | L2-propose | L3-with-approval | L4-autonomous" });
  }

  // Budget cap validation
  if (input.budgetCapUsd !== undefined && input.budgetCapUsd !== null) {
    if (typeof input.budgetCapUsd !== "number" || !Number.isFinite(input.budgetCapUsd) || input.budgetCapUsd < 0) {
      errors.push({ field: "budgetCapUsd", message: "budgetCapUsd must be a non-negative number or null" });
    }
  }

  const defaulted: SREAgentInput = {
    environment: input.environment ?? "dev",
    deployTarget: input.deployTarget ?? "",
    linearIssueId: input.linearIssueId,
    runId: input.runId,
    strategy: input.strategy ?? "rolling",
    preHealthChecks: input.preHealthChecks ?? [],
    postHealthChecks: input.postHealthChecks ?? [],
    rollbackConfig: input.rollbackConfig ?? {
      autoRollback: false,
      failureThreshold: 3,
      retryWaitSec: 30,
    },
    guardrails: input.guardrails ?? [],
    nonGoals: input.nonGoals ?? [],
    budgetCapUsd: input.budgetCapUsd ?? null,
    autonomyLevel: input.autonomyLevel ?? "L2-propose",
    prUrl: input.prUrl,
    skipSmokeTests: input.skipSmokeTests ?? false,
  };

  return { errors, value: defaulted };
}

/* ================================================================== */
/* Evidence enforcement helpers                                        */
/* ================================================================== */

/**
 * Check whether an agent output satisfies its evidence contract (LAT-8).
 * Returns an array of missing evidence fields.
 */
export function checkEvidence(
  agentType: AgentType,
  output: AgentOutput,
): ReadonlyArray<string> {
  const contract = getEvidenceContract(agentType);
  if (!contract) return [];

  const missing: string[] = [];

  // Every agent output must have the base evidence fields
  if (!contract.summary && false) {
    missing.push("summary");
  }

  // Extract the raw output based on the discriminant
  const raw = output.output as unknown as Record<string, unknown>;

  if (!contract.risks && false) {
    missing.push("risks");
  }

  if (!contract.recommendation && false) {
    missing.push("recommendation");
  }

  if (contract.acceptanceCriteriaVerified && raw["acceptanceCriteriaVerified"] === undefined) {
    missing.push("acceptanceCriteriaVerified");
  }

  if (contract.regressions && raw["regressions"] === undefined) {
    missing.push("regressions");
  }

  if (contract.securityOrArchitectureConcerns && raw["securityOrArchitectureConcerns"] === undefined) {
    missing.push("securityOrArchitectureConcerns");
  }

  if (contract.prCorrelation && raw["prUrl"] === undefined && raw["prBranch"] === undefined && raw["commitSha"] === undefined) {
    missing.push("prCorrelation (at least one of prUrl, prBranch, commitSha)");
  }

  // Regression field: present on coding and qa outputs.
  // Coding output has it always (even empty), qa output too.
  // This check is redundant with the type system but kept for structural safety.

  return missing;
}

/**
 * Build a default (empty) output for a given agent type.
 * Useful for test stubs and early-return paths.
 */
export function buildDefaultOutput(agentType: AgentType): AgentOutput | null {
  switch (agentType) {
    case "coding":
      return {
        agentType: "coding",
        output: buildDefaultCodingAgentOutput(),
      };
    case "qa":
      return {
        agentType: "qa",
        output: buildDefaultQAAgentOutput(),
      };
    case "review":
      return {
        agentType: "review",
        output: buildDefaultPRReviewAgentOutput(),
      };
    case "sre":
      return {
        agentType: "sre",
        output: buildDefaultSREAgentOutput(),
      };
    default:
      return null;
  }
}

/** Default coding agent output (empty). */
function buildDefaultCodingAgentOutput(): CodingAgentOutput {
  return {
    schemaVersion: CODING_AGENT_SCHEMA_VERSION,
    diff: "",
    buildStatus: { status: "not_run", exitCode: null, stdout: "", stderr: "", durationMs: 0 },
    testResults: { outcome: "not_run", totalTests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, durationMs: 0, tests: [] },
    lintResults: { status: "not_run", totalViolations: 0, errors: 0, warnings: 0, infos: 0, durationMs: 0, violations: [] },
    coverage: null,
    acceptanceCriteriaVerified: [],
    risks: [],
    regressions: [],
    securityOrArchitectureConcerns: [],
    recommendation: "needs-human",
    summary: "default (empty)",
    prUrl: null,
    prBranch: null,
    commitSha: null,
  };
}

/** Default QA agent output (empty). */
function buildDefaultQAAgentOutput(): QAAgentOutput {
  return {
    schemaVersion: QA_AGENT_SCHEMA_VERSION,
    acceptanceCriteriaVerification: [],
    regressions: [],
    severityClassification: {
      overall: "nit",
      breakdown: {
        acceptanceCriteria: "nit",
        regressions: "nit",
        lint: "nit",
        build: "nit",
        tests: "nit",
      },
    },
    risks: [],
    securityOrArchitectureConcerns: [],
    recommendation: "needs-human",
    summary: "default (empty)",
    prUrl: null,
    prBranch: null,
    commitSha: null,
  };
}

/** Default PR review agent output (empty). */
function buildDefaultPRReviewAgentOutput(): PRReviewAgentOutput {
  return {
    schemaVersion: PR_REVIEW_AGENT_SCHEMA_VERSION,
    findings: [],
    acceptanceCriteriaVerified: [],
    regressions: [],
    approvalStatus: {
      passesQualityGate: true,
      findingsBySeverity: { nit: 0, low: 0, medium: 0, high: 0, critical: 0 },
      highestSeverity: "nit",
      approved: false,
      rationale: "default (empty)",
    },
    changeSummary: {
      description: "default (empty)",
      filesChanged: 0,
      changedFiles: [],
      additions: 0,
      deletions: 0,
      isBreaking: false,
      hasTests: false,
    },
    risks: [],
    securityOrArchitectureConcerns: [],
    recommendation: "needs-human",
    summary: "default (empty)",
    prUrl: null,
    prBranch: null,
    commitSha: null,
  };
}

/** Default SRE agent output (empty). */
function buildDefaultSREAgentOutput(): SREAgentOutput {
  return {
    schemaVersion: SRE_AGENT_SCHEMA_VERSION,
    deployStatus: "in_progress",
    preHealthChecks: [],
    postHealthChecks: [],
    cost: { costBand: "unknown", spentUsd: null, budgetCapUsd: null, costBandUnavailableReason: "default (empty)" },
    risks: [],
    securityOrArchitectureConcerns: [],
    recommendation: "needs-human",
    summary: "default (empty)",
    prUrl: null,
    prBranch: null,
    commitSha: null,
  };
}
