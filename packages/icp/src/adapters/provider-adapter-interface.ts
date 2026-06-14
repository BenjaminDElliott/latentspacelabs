/**
 * Provider-neutral adapter interface contract (LAT-162, ADR-0022).
 *
 * Defines a unified adapter interface that all agent providers implement
 * regardless of their underlying technology or protocol. ICP invokes any
 * provider through the same call pattern:
 *
 *   1. init(providerType)      — configure and bootstrap
 *   2. invoke(request)         — submit and get back an OperationHandle
 *   3. getStatus(handle)       — non-blocking state query
 *   4. pollForResult(handle)   — blocking until terminal, return RunResult
 *   5. cancel(handle)          — best-effort cancellation request
 *   6. dispose()               — release resources
 *
 * Scope:
 *   - Adapter interface contract (all five lifecycle methods).
 *   - RunRequest shape (ticket, repo, branch, autonomy, evidence requirements).
 *   - RunResult shape (status, evidence, artifacts, timing, errors).
 *   - Error types and retry semantics.
 *
 * Non-goals:
 *   - Transport protocol specifics (HTTP, gRPC, stdin/stdout, MCP, etc.).
 *   - Authentication mechanisms (the adapter receives a config map; auth
 *     credential resolution happens in the caller).
 *   - Provider-specific caching strategies.
 *
 * Agent types covered (LAT-161): coding, qa, review, sre, pm, research,
 * observability. Each provider implements this interface; the concrete
 * provider type is communicated via `ProviderType` and the optional
 * `providerConfig` map.
 */

/* ==================================================================== */
/*  Provider type enumeration                                            */
/* ==================================================================== */

/**
 * The set of agent provider types the ICP dispatches to.
 *
 * Each enum value maps to a concrete provider implementation (e.g. the
 * coding-agent adapter, the QA harness, the PR-review adapter, the SRE
 * runbook executor).  New types may be added without breaking existing
 * callers that pattern-match on known values and fall through to a
 * default case.
 */
export type ProviderType =
  | "coding"
  | "qa"
  | "review"
  | "sre"
  | "pm"
  | "research"
  | "observability";

/* ==================================================================== */
/*  RunRequest — invocation payload                                      */
/* ==================================================================== */

/**
 * The canonical shape ICP sends to any provider via `invoke(request)`.
 *
 * Every provider receives at minimum: ticket, repo, branch, autonomy level,
 * and evidence requirements.  Provider-specific fields live inside the
 * optional `providerConfig` map so the contract stays extensible.
 */
export interface RunRequest {
  /**
   * The Linear ticket identifier driving this run (e.g. `LAT-162`).
   * Used for correlation, write-back, and idempotency.
   */
  ticket: string;

  /**
   * Target repository in `owner/name` form (e.g. `BenjaminDElliott/latentspacelabs`).
   * The provider acts on this repository.
   */
  repo: string;

  /**
   * Branch the provider should work on (source branch).
   * Conventionally follows `lat-<issueNumber>-<slug>`.
   */
  branch: string;

  /**
   * Autonomy level governing what the provider may do without human approval.
   * L1 = read-only, L4 = fully autonomous.
   */
  autonomyLevel: AutonomyLevel;

  /**
   * Which agent provider type is being invoked.
   * Matches one of the `ProviderType` values.
   */
  providerType: ProviderType;

  /**
   * Evidence requirements the provider must produce.
   * Controls what artifacts and proofs the provider must return.
   */
  evidenceRequirements: EvidenceRequirements;

  /**
   * Optional provider-specific configuration.
   * Shape varies by provider type; the contract does not mandate fields here.
   */
  providerConfig?: Record<string, unknown>;

  /**
   * Optional budget cap in USD for the run.
   * Providers should surface cost-band evidence when this is set.
   */
  budgetCapUsd?: number | null;

  /**
   * Optional approval flag. When false, the provider must refuse or
   * produce a `needs_human` result for side-effecting runs.
   */
  approve?: boolean;

  /**
   * Optional dry-run flag. When true, the provider should compute
   * results without producing side effects (e.g. no PR creation).
   */
  dryRun?: boolean;

  /**
   * Optional run identifier for correlation with the ICP runner.
   * Must be stable across retries of the same logical run.
   */
  runId?: string;
}

/**
 * Evidence requirements the provider must produce for a successful run.
 *
 * Fields default to `false`; the caller enables what it needs.
 * Each field maps to an evidence category the provider must cover.
 */
export interface EvidenceRequirements {
  /**
   * Acceptance criteria verification.
   * Each criterion should be marked passed, failed, partial, or skipped.
   */
  acceptanceCriteria: boolean;

  /**
   * Build verification evidence.
   * Build must have been executed; results must include pass/fail and stdout/stderr.
   */
  build: boolean;

  /**
   * Test results evidence.
   * Tests must have been executed; results must include per-test pass/fail data.
   */
  tests: boolean;

  /**
   * Lint verification evidence.
   * Linting must have been executed (if a lint command is provided);
   * results must include violation counts and individual violations.
   */
  lint: boolean;

  /**
   * Coverage evidence.
   * Coverage must have been measured (if a coverage command is provided);
   * results must include percentage metrics.
   */
  coverage: boolean;

  /**
   * Risk identification evidence.
   * Provider must list identified risks.
   */
  risks: boolean;

  /**
   * Regression analysis evidence.
   * Provider must identify potential regressions.
   */
  regressions: boolean;

  /**
   * Security / architecture concerns evidence.
   * Provider must flag any security or architecture concerns.
   */
  securityConcerns: boolean;

  /**
   * Recommendation evidence.
   * Provider must produce a recommendation from the ADR-0007 ladder.
   */
  recommendation: boolean;
}

/**
 * Default evidence requirements when the caller does not specify.
 *
 * Minimal set: acceptance criteria, build, tests, and recommendation.
 * These are the four fields every provider must produce regardless of type.
 */
export const DEFAULT_EVIDENCE_REQUIREMENTS: EvidenceRequirements = {
  acceptanceCriteria: true,
  build: true,
  tests: true,
  lint: false,
  coverage: false,
  risks: true,
  regressions: true,
  securityConcerns: true,
  recommendation: true,
};

/* ==================================================================== */
/*  RunResult — final outcome                                            */
/* ==================================================================== */

/**
 * The result returned by `pollForResult` (or by a synchronous invoke).
 *
 * `status` is always terminal.  Either `data` (success) or `error`
 * (failure) is present — never both.
 *
 * This is the canonical run result shape that every provider produces,
 * regardless of provider type or implementation language.
 */
export interface RunResult {
  /**
   * The operation handle returned by `invoke`.
   * Present on all results for correlation.
   */
  handle: OperationHandle;

  /**
   * Terminal status of the run.
   * Always one of: succeeded, failed, cancelled, timeout.
   */
  status: RunStatus;

  /**
   * Evidence produced by the provider during the run.
   * Structure varies by provider type and evidence requirements,
   * but always includes at minimum: acceptanceCriteria, build, tests, recommendation.
   * Secret-safe by contract: no field contains raw API keys, tokens, or credentials.
   */
  evidence: RunEvidence;

  /**
   * Provider-specific artifacts — code diffs, PR URLs, commit SHAs,
   * generated files, reports, etc.
   *
   * Artifacts are provider-dependent; the contract specifies only that
   * the provider populates what is relevant for its domain.
   */
  artifacts: Record<string, unknown>;

  /**
   * Timing information for the run.
   * ISO-8601 strings for start/end, plus wall-clock duration in milliseconds.
   */
  timing: RunTiming;

  /**
   * Cost-band evidence per ADR-0009.
   * `null` when the provider does not track costs.
   */
  costBand: CostBand | null;

  /**
   * Optional cost-band unavailable reason when cost data is missing.
   */
  costBandUnavailableReason: string | null;

  /**
   * Operator cost in USD, when the provider tracks it.
   * `null` when cost is untracked.
   */
  spentUsd: number | null;

  /**
   * Error present when status is `failed`, `cancelled`, or `timeout`.
   * `null` when the run succeeded.
   */
  error: RunError | null;

  /**
   * Free-form notes from the provider (sanitised of secrets).
   * Always present; never null.
   */
  notes: ReadonlyArray<string>;
}

/**
 * Terminal run status values.
 *
 * This is a closed enum: any switch / match on RunStatus must handle
 * every member.  Additions are non-breaking only when callers check for
 * known states and fall through to a default.
 */
export type RunStatus = "succeeded" | "failed" | "cancelled" | "timeout";

/**
 * Whether the run was a dry run or a real invocation.
 */
export type RunMode = "real" | "dry_run";

/**
 * Timing information for a run.
 * All timestamps are ISO-8601 strings when available, or `null` when
 * the timestamp has not been recorded yet.
 */
export interface RunTiming {
  /** When the provider began processing (null if not recorded). */
  startedAt: string | null;
  /** When the provider completed (null if still running or not recorded). */
  completedAt: string | null;
  /** Wall-clock duration from start to completion, in milliseconds. */
  durationMs: number;
}

/* ==================================================================== */
/*  RunEvidence — evidence envelope                                      */
/* ==================================================================== */

/**
 * Evidence envelope produced by the provider.
 *
 * Fields corresponding to enabled evidence requirements must be present.
 * Fields for disabled requirements default to `null`.
 *
 * Secret-safe by contract: no field contains raw API keys, tokens, or
 * credential values.
 */
export interface RunEvidence {
  /** Acceptance criteria verification results. Null if not required. */
  acceptanceCriteria: ReadonlyArray<AcceptanceCriterionResult> | null;

  /** Build result. Null if not required. */
  build: BuildResult | null;

  /** Test results. Null if not required. */
  tests: TestResults | null;

  /** Lint results. Null if not required. */
  lint: LintResults | null;

  /** Coverage metrics. Null if not required. */
  coverage: CoverageMetrics | null;

  /** Identified risks. Empty array when no risks identified. */
  risks: ReadonlyArray<string>;

  /** Potential regressions. Empty array when no regressions identified. */
  regressions: ReadonlyArray<string>;

  /** Security and architecture concerns. Empty array when none flagged. */
  securityConcerns: ReadonlyArray<string>;

  /** Final recommendation from the ADR-0007 recommendation ladder. */
  recommendation: Recommendation;
}

/* ==================================================================== */
/*  Evidence sub-types                                                   */
/* ==================================================================== */

/**
 * Verification result for a single acceptance criterion.
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
 * Build result from a provider run.
 */
export interface BuildResult {
  /** Overall status. */
  status: "passed" | "failed" | "not_run";
  /** Exit code from the build command (null if not_run). */
  exitCode: number | null;
  /** Stdout from the build command, sanitised. */
  stdout: string;
  /** Stderr from the build command, sanitised. */
  stderr: string;
  /** Duration in milliseconds. */
  durationMs: number;
}

/**
 * Overall test outcome.
 */
export type TestOutcome = "passed" | "failed" | "skipped" | "not_run";

/**
 * Structured test results.
 */
export interface TestResults {
  /** Overall outcome. */
  outcome: TestOutcome;
  /** Total test count. */
  totalTests: number;
  /** Number of tests that passed. */
  passed: number;
  /** Number of tests that failed. */
  failed: number;
  /** Number of tests that were skipped. */
  skipped: number;
  /** Number of tests that errored. */
  errors: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Individual test results. Empty when outcome is "not_run". */
  tests: ReadonlyArray<TestCaseResult>;
}

/**
 * Result for a single test case.
 */
export interface TestCaseResult {
  name: string;
  /** Suite/module this test belongs to. */
  suite?: string;
  status: "passed" | "failed" | "skipped" | "errored";
  /** Duration in milliseconds for this test. */
  durationMs: number;
  /** Error message if failed/errored. */
  errorMessage?: string;
  /** Stack trace if failed/errored, sanitised. */
  stackTrace?: string;
}

/**
 * Lint result status.
 */
export type LintStatus = "passed" | "failed" | "not_run";

/**
 * Structured lint results.
 */
export interface LintResults {
  status: LintStatus;
  /** Total number of lint violations. */
  totalViolations: number;
  /** Number of errors (must-fix). */
  errors: number;
  /** Number of warnings (should-fix). */
  warnings: number;
  /** Number of infos/notices (cosmetic). */
  infos: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Individual lint violations. Empty when status is "not_run". */
  violations: ReadonlyArray<LintViolation>;
}

/**
 * A single lint violation.
 */
export interface LintViolation {
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

/**
 * Coverage metrics.
 */
export interface CoverageMetrics {
  totalPercentage: number | null;
  branchPercentage: number | null;
  functionPercentage: number | null;
  statementPercentage: number | null;
  durationMs: number;
  files: ReadonlyArray<CoverageFileSummary>;
}

/**
 * Coverage for a single file.
 */
export interface CoverageFileSummary {
  file: string;
  lineCoverage: number | null;
  branchCoverage: number | null;
  functionCoverage: number | null;
  statementCoverage: number | null;
}

/**
 * Recommendation ladder from ADR-0007.
 */
export type Recommendation =
  | "approve"
  | "approve-with-nits"
  | "request-changes"
  | "block-merge"
  | "needs-human";

/* ==================================================================== */
/*  Autonomy level                                                       */
/* ==================================================================== */

/**
 * Autonomy notation per ADR-0008 (L0–L5).
 *
 * L1 = read-only, L2 = propose, L3 = with-approval, L4 = autonomous.
 * L0 is Perplexity-only observe/draft; L5 is the out-of-scope
 * autonomous-merge-and-deploy level.
 */
export type AutonomyLevel =
  | "L1-read-only"
  | "L2-propose"
  | "L3-with-approval"
  | "L4-autonomous";

/* ==================================================================== */
/*  Cost band                                                            */
/* ==================================================================== */

/**
 * Cost-band values per ADR-0009.
 */
export type CostBand = "normal" | "elevated" | "runaway_risk" | "unknown";

/* ==================================================================== */
/*  RunError — error envelope                                            */
/* ==================================================================== */

/**
 * Machine-readable error categories for provider runs.
 *
 * New kinds may be added by follow-up tickets; existing callers must
 * handle unknown kinds gracefully (e.g. falling through to a default
 * case in a switch).
 */
export type RunErrorCode =
  | "not_found"
  | "timeout"
  | "cancelled"
  | "failed"
  | "disconnected"
  | "permission_denied"
  | "invalid_input"
  | "internal_error"
  | "unknown";

/**
 * An error returned by a provider run.
 * Secret-safe by contract: no field contains raw API keys, tokens, or
 * credential values.
 */
export interface RunError {
  /** Machine-readable error category. */
  kind: RunErrorCode;
  /** Human-readable, secret-safe description. */
  message: string;
  /** Optional machine-readable error code (e.g. "HTTP_429"). */
  code?: string;
  /** Optional structured details; never contains secrets. */
  details?: unknown;
  /**
   * Whether the error is retryable. Providers may set this based on the
   * error category (e.g. "timeout" is retryable, "invalid_input" is not).
   */
  retryable: boolean;
}

/* ==================================================================== */
/*  OperationHandle                                                      */
/* ==================================================================== */

/**
 * Opaque string handle returned by `invoke` and accepted by
 * `getStatus`, `pollForResult`, and `cancel`.
 *
 * The adapter owns the mapping from handle to internal operation state.
 * Handles are unique per invocation and do not carry semantic meaning.
 */
export type OperationHandle = string;

/* ==================================================================== */
/*  ProviderAdapter — the unified interface                              */
/* ==================================================================== */

/**
 * The provider-neutral adapter interface (LAT-162, ADR-0022).
 *
 * Every agent provider implements these methods to expose a uniform
 * async-operation lifecycle. ICP invokes any provider through the same
 * call pattern:
 *
 *   1. init(providerType)      — configure and bootstrap
 *   2. invoke(request)         — submit and get back an OperationHandle
 *   3. getStatus(handle)       — non-blocking state query
 *   4. pollForResult(handle)   — block until terminal, return RunResult
 *   5. cancel(handle)          — best-effort cancellation
 *   6. dispose()               — release resources
 *
 * Lifecycle invariants:
 *   1. init() must be called before any other method.
 *   2. invoke() is idempotent: calling with the same runId returns the
 *      existing handle instead of creating a duplicate.
 *   3. pollForResult() is idempotent — calling it twice on the same
 *      handle returns the same result if the operation already completed.
 *   4. cancel() is a best-effort request; the caller must check status
 *      to confirm cancellation.
 *   5. dispose() releases all resources; the adapter is unusable after
 *      dispose (except init, which re-initialises).
 */
export interface ProviderAdapter {
  /**
   * Initialise the adapter with configuration.
   *
   * Called once before any other method. Idempotent: calling twice with
   * the same providerType and config is a no-op.
   *
   * @param providerType — the agent type this adapter serves (e.g. "coding").
   * @param config — flat key-value map of configuration. Keys are strings;
   *   values are strings, numbers, booleans, or null.
   * @throws on fatal configuration errors (missing API key, unreachable
   *   endpoint, unsupported provider type, etc.).
   */
  init(providerType: ProviderType, config: Record<string, unknown>): void;

  /**
   * Submit a run and return an opaque handle immediately.
   *
   * @param request — the invocation payload containing ticket, repo,
   *   branch, autonomy level, evidence requirements, and provider-specific
   *   configuration.
   * @returns an OperationHandle that can be passed to getStatus,
   *   pollForResult, and cancel.
   * @throws if the adapter has not been initialised.
   * @throws on fatal errors (e.g. internal state corruption).
   */
  invoke(request: RunRequest): OperationHandle;

  /**
   * Check the current state of a run without blocking.
   *
   * @param handle — the operation handle returned by invoke.
   * @returns the latest known status snapshot, or a default status if
   *   the handle is not recognised.
   */
  getStatus(handle: OperationHandle): OperationStatus;

  /**
   * Block until the run reaches a terminal state, then return the result.
   *
   * If timeoutMs is provided and the run has not completed, returns a
   * result with status === "timeout".
   *
   * @param handle — the operation handle.
   * @param timeoutMs — optional maximum wait time in milliseconds. If
   *   omitted, the adapter uses its configured default or blocks
   *   indefinitely.
   * @returns the run result when the run completes.
   * @throws if the adapter becomes disconnected or encounters a fatal error.
   */
  pollForResult(handle: OperationHandle, timeoutMs?: number): RunResult;

  /**
   * Request cancellation of a running run. A no-op if the run is already
   * terminal.
   *
   * @param handle — the operation handle.
   */
  cancel(handle: OperationHandle): void;

  /**
   * Release all resources held by the adapter. The adapter must not be
   * used after dispose (except init, which re-initialises).
   *
   * Idempotent: calling dispose twice is safe.
   */
  dispose(): void;
}

/* ==================================================================== */
/*  OperationStatus — current state snapshot                             */
/* ==================================================================== */

/**
 * Non-blocking snapshot of an operation's current state.
 *
 * `startedAt` and `completedAt` are ISO-8601 strings when available,
 * or `null` when the timestamp has not been recorded yet.
 */
export interface OperationStatus {
  /** The operation handle. */
  handle: OperationHandle;
  /** Current state: one of unknown, running, succeeded, failed, cancelled, timeout. */
  state: OperationState;
  /** When the operation started (null if not recorded). */
  startedAt: string | null;
  /** When the operation completed (null if still running or not recorded). */
  completedAt: string | null;
  /** Present when state is failed, cancelled, or timeout. */
  error: RunError | null;
}

/* ==================================================================== */
/*  OperationState — non-terminal states                                 */
/* ==================================================================== */

/**
 * States for an operation during its lifecycle.
 *
 * Terminal states: succeeded, failed, cancelled, timeout.
 * Non-terminal states: unknown, running.
 *
 * This is a closed enum: any switch / match on OperationState must handle
 * every member. Additions are non-breaking only when callers check for
 * known states and fall through to a default.
 */
export type OperationState =
  | "unknown"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

/* ==================================================================== */
/*  Error construction utilities                                         */
/* ==================================================================== */

/**
 * Build a typed RunError from a kind and message.
 *
 * Utility for providers that construct errors internally; ensures
 * consistent shape across implementations.
 */
export function createRunError(
  kind: RunErrorCode,
  message: string,
  opts?: { code?: string; details?: unknown; retryable?: boolean },
): RunError {
  const r: RunError = { kind, message, retryable: opts?.retryable ?? isRetryableKind(kind) };
  const code = opts?.code;
  const details = opts?.details;
  if (code !== undefined) r.code = code;
  if (details !== undefined) r.details = details;
  return r;
}

/**
 * Determine if an error kind is generally retryable.
 *
 * Retryable kinds: timeout, disconnected, internal_error, unknown.
 * Non-retryable kinds: not_found, cancelled, failed, permission_denied, invalid_input.
 */
export function isRetryableKind(kind: RunErrorCode): boolean {
  switch (kind) {
    case "timeout":
    case "disconnected":
    case "internal_error":
    case "unknown":
      return true;
    case "not_found":
    case "cancelled":
    case "failed":
    case "permission_denied":
    case "invalid_input":
      return false;
    default:
      return false;
  }
}

/* ==================================================================== */
/*  Type guards                                                          */
/* ==================================================================== */

/**
 * Type guard: is this a RunError?
 *
 * Useful for runtime validation in languages with soft typing (Python, JS).
 * In TypeScript, the static type is usually sufficient, but this helps
 * with JSON deserialisation or cross-language FFI boundaries.
 */
export function isRunError(val: unknown): val is RunError {
  return (
    typeof val === "object" &&
    val !== null &&
    "kind" in val &&
    "message" in val &&
    "retryable" in val &&
    typeof (val as Record<string, unknown>).kind === "string" &&
    typeof (val as Record<string, unknown>).message === "string" &&
    typeof (val as Record<string, unknown>).retryable === "boolean"
  );
}

/**
 * Type guard: is this a valid OperationState?
 */
export function isOperationState(val: unknown): val is OperationState {
  return (
    typeof val === "string" &&
    (val === "unknown" ||
      val === "running" ||
      val === "succeeded" ||
      val === "failed" ||
      val === "cancelled" ||
      val === "timeout")
  );
}

/**
 * Type guard: is this a terminal OperationState?
 */
export function isTerminalState(
  state: OperationState,
): state is Exclude<OperationState, "unknown" | "running"> {
  return state !== "unknown" && state !== "running";
}

/**
 * Type guard: is this a valid RunStatus?
 */
export function isRunStatus(val: unknown): val is RunStatus {
  return (
    typeof val === "string" &&
    (val === "succeeded" || val === "failed" || val === "cancelled" || val === "timeout")
  );
}

/**
 * Type guard: is this a valid ProviderType?
 */
export function isProviderType(val: unknown): val is ProviderType {
  return (
    typeof val === "string" &&
    (val === "coding" ||
      val === "qa" ||
      val === "review" ||
      val === "sre" ||
      val === "pm" ||
      val === "research" ||
      val === "observability")
  );
}

/* ==================================================================== */
/*  Helpers                                                              */
/* ==================================================================== */

/**
 * Format an OperationStatus as a human-readable string.
 *
 * Utility for logging and debugging. Not part of the interface contract.
 */
export function formatStatus(status: OperationStatus): string {
  const parts: string[] = [
    `handle=${status.handle}`,
    `state=${status.state}`,
  ];
  if (status.startedAt) parts.push(`started=${status.startedAt}`);
  if (status.completedAt) parts.push(`completed=${status.completedAt}`);
  if (status.error) parts.push(`error=${status.error.kind}: ${status.error.message}`);
  return parts.join(", ");
}

/**
 * Format a RunResult as a human-readable summary.
 *
 * Utility for logging and debugging. Not part of the interface contract.
 */
export function formatResultSummary(result: RunResult): string {
  const parts: string[] = [
    `handle=${result.handle}`,
    `status=${result.status}`,
    `durationMs=${result.timing.durationMs}`,
  ];
  if (result.costBand) parts.push(`costBand=${result.costBand}`);
  if (result.error) parts.push(`error=${result.error.kind}: ${result.error.message}`);
  return parts.join(", ");
}
