/**
 * Coding agent input/output contract (LAT-174).
 *
 * Defines the canonical shape of the coding agent's contract: what the agent
 * receives as input (repo, branch, targetBranch, code diff, build command,
 * test command) and what it produces as output (diff, buildStatus, testResults,
 * lintResults, coverage).
 *
 * Evidence requirements are drawn from LAT-8 (Define QA/review evidence
 * workflow), which mandates that every coding-agent run produces structured
 * evidence for:
 *   - Acceptance criteria verification
 *   - Test results
 *   - Files changed
 *   - Risks
 *   - Regressions
 *   - Security/architecture concerns
 *   - Final recommendation
 *
 * This contract is a **pure type layer** — it does not call any adapters,
 * run commands, or perform I/O. Adapters (the command provider, MCP server,
 * Claude Code harness) normalise their own outputs into these types so the
 * rest of the stack works against a stable surface.
 *
 * LAT-174 non-goals: agent-specific output formats (adapters normalise).
 */

/* ------------------------------------------------------------------ */
/* Schema version                                                    */
/* ------------------------------------------------------------------ */

/**
 * Schema version for the coding agent contract. Bumped on breaking changes.
 * The runner and adapters use this to verify compatibility.
 */
export const CODING_AGENT_CONTRACT_SCHEMA_VERSION = "1.0.0";

/* ------------------------------------------------------------------ */
/* Input types                                                       */
/* ------------------------------------------------------------------ */

/**
 * The canonical input a coding agent receives before it starts work.
 *
 * Mirrors the LAT-8 evidence requirements: the agent needs enough
 * context to verify acceptance criteria, run build/tests/lint, and
 * produce a structured output with all required evidence fields.
 *
 * LAT-174 input fields (per the issue acceptance criteria):
 *   - repo:         the target repository (`owner/name`)
 *   - branch:       the source branch the agent will work on
 *   - targetBranch: the base branch for the PR (typically `main`)
 *   - codeDiff:     the code diff or patch the agent should apply/return
 *   - buildCommand:  command to build the project
 *   - testCommand:   command to run tests
 */
export interface CodingAgentInput {
  /**
   * Target repository in `owner/name` form (e.g. `BenjaminDElliott/latentspacelabs`).
   * The agent opens/closes PRs against this repo.
   */
  repo: string;

  /**
   * Source branch the agent will create/modify.
   * Conventionally follows the pattern `lat-<issueNumber>-<slug>`.
   */
  branch: string;

  /**
   * Target (base) branch for the PR. Typically `main` or `develop`.
   * The agent opens a PR from `branch` → `targetBranch`.
   */
  targetBranch: string;

  /**
   * Code diff or patch the agent should produce (or apply on top of the
   * working tree). Can be empty if the agent generates code from scratch.
   * Stored as a unified diff string (git-diff format) for structured
   * consumption by downstream reviewers.
   */
  codeDiff?: string;

  /**
   * Shell command to build the project. Executed inside the agent's
   * sandbox/worktree. Must exit 0 on success.
   *
   * Example: `npm run build` or `make -j4`
   */
  buildCommand: string;

  /**
   * Shell command to run tests. Executed inside the agent's sandbox/
   * worktree. Must exit 0 on success.
   *
   * Example: `npm test` or `pytest tests/`
   */
  testCommand: string;

  /**
   * Optional shell command to run linting. If absent, linting is skipped
   * in the output (lintResults.status defaults to "not_run").
   *
   * Example: `npm run lint` or `flake8 src/`
   */
  lintCommand?: string;

  /**
   * Optional shell command to measure test coverage. If absent, coverage
   * is omitted from the output (coverage.totalPercentage defaults to null).
   *
   * Example: `npm run coverage` or `pytest --cov=src`
   */
  coverageCommand?: string;

  /**
   * Acceptance criteria the agent should verify in its output.
   * Mirrors LAT-8's acceptance criteria verification requirement.
   * Each criterion should be a single testable statement.
   */
  acceptanceCriteria?: ReadonlyArray<string>;

  /**
   * Files in scope for the task. Helps the agent avoid editing
   * irrelevant files. Mirrors LAT-8's files changed requirement.
   */
  filesInScope?: ReadonlyArray<string>;

  /**
   * Files explicitly excluded from the task.
   */
  filesForbidden?: ReadonlyArray<string>;

  /**
   * Non-goals / out-of-scope notes. The agent should not touch these.
   */
  nonGoals?: ReadonlyArray<string>;

  /**
   * Guardrails / rules the agent must follow (e.g. ADR-0008, ADR-0013).
   */
  guardrails?: ReadonlyArray<string>;

  /**
   * Numeric ADR-0009 budget cap for the run. The agent should surface
   * cost band evidence in its output.
   */
  budgetCapUsd?: number | null;

  /**
   * ADR-0008 autonomy level for this run (L1–L4). Affects what the
   * agent is allowed to do (propose, approve, auto-merge).
   */
  autonomyLevel?: AutonomyLevel;

  /**
   * Stable run identifier for correlation with the ICP runner.
   */
  runId?: string;

  /**
   * Ticket title from Linear. Used as the PR title prefix.
   */
  ticketTitle?: string;
}

/* ------------------------------------------------------------------ */
/* Output types                                                      */
/* ------------------------------------------------------------------ */

/**
 * The canonical output a coding agent produces after completing its task.
 *
 * Every field maps to an LAT-8 evidence requirement:
 *   - diff              → files changed
 *   - buildStatus       → build verification
 *   - testResults       → test results
 *   - lintResults       → lint verification
 *   - coverage          → coverage evidence
 *
 * LAT-174 output fields (per the issue acceptance criteria):
 *   - diff:              the code diff / patch produced
 *   - buildStatus:       whether the build passed
 *   - testResults:       structured test pass/fail results
 *   - lintResults:       lint pass/fail results
 *   - coverage:          test coverage metrics
 *
 * Plus LAT-8 evidence fields:
 *   - acceptanceCriteriaVerified
 *   - risks
 *   - regressions
 *   - securityOrArchitectureConcerns
 *   - recommendation
 */
export interface CodingAgentOutput {
  /**
   * Schema version. Consumers use this to branch on schema without
   * re-reading the contract.
   */
  schemaVersion: typeof CODING_AGENT_CONTRACT_SCHEMA_VERSION;

  /**
   * The code diff produced by the agent. Stored as a unified diff
   * (git-diff format). Mirrors LAT-8's "files changed" evidence.
   * Empty string when no code was produced (e.g. a documentation-only
   * ticket or a refused run).
   */
  diff: string;

  /**
   * Build result. Mirrors LAT-8's build verification evidence.
   */
  buildStatus: BuildStatus;

  /**
   * Test results. Mirrors LAT-8's test results evidence.
   * Contains structured per-test pass/fail data.
   */
  testResults: TestResults;

  /**
   * Lint results. Mirrors LAT-8's lint verification evidence.
   * Empty when no lint command was provided.
   */
  lintResults: LintResults;

  /**
   * Coverage metrics. Mirrors LAT-8's coverage evidence.
   * Null when no coverage command was provided.
   */
  coverage: CoverageMetrics | null;

  /**
   * LAT-8 evidence: acceptance criteria verification. Each criterion
   * is verified as `passed`, `failed`, `partial`, or `skipped`.
   */
  acceptanceCriteriaVerified: ReadonlyArray<AcceptanceCriterionResult>;

  /**
   * LAT-8 evidence: identified risks during the run.
   * One-line risk descriptions. Empty array means no risks identified.
   */
  risks: ReadonlyArray<string>;

  /**
   * LAT-8 evidence: potential regressions from the changes.
   * One-line regression descriptions. Empty array means no regressions identified.
   */
  regressions: ReadonlyArray<string>;

  /**
   * LAT-8 evidence: security and architecture concerns flagged by the agent.
   * One-line concern descriptions. Empty array means no concerns flagged.
   */
  securityOrArchitectureConcerns: ReadonlyArray<string>;

  /**
   * LAT-8 evidence: final recommendation for the reviewer/merger.
   * Mirrors the ADR-0007 recommendation ladder: `approve`, `approve-with-nits`,
   * `request-changes`, `block-merge`, or `needs-human`.
   */
  recommendation: Recommendation;

  /**
   * One-line summary of what the agent did. Used in Linear write-back.
   */
  summary: string;

  /**
   * Pointers to PR, commit, and branch for correlation with the ICP runner.
   */
  prUrl?: string | null;
  prBranch?: string | null;
  commitSha?: string | null;

  /**
   * Free-form notes from the agent (sanitised of secrets).
   */
  notes?: ReadonlyArray<string>;
}

/* ------------------------------------------------------------------ */
/* Build result                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build status from the coding agent's output.
 * Maps directly to the exit code semantics.
 */
export type BuildStatus = {
  /** Overall status. */
  status: "passed" | "failed" | "not_run";
  /** Exit code from the build command (null if not_run). */
  exitCode: number | null;
  /** Stdout from the build command, sanitised (secrets redacted). */
  stdout: string;
  /** Stderr from the build command, sanitised (secrets redacted). */
  stderr: string;
  /** Duration in milliseconds. */
  durationMs: number;
};

/* ------------------------------------------------------------------ */
/* Test results                                                       */
/* ------------------------------------------------------------------ */

/**
 * Overall test outcome.
 */
export type TestOutcome = "passed" | "failed" | "skipped" | "not_run";

/**
 * Structured test results from the coding agent's output.
 * Mirrors LAT-8's "test results" evidence requirement.
 */
export interface TestResults {
  /** Overall outcome. */
  outcome: TestOutcome;
  /** Total test count (including passed, failed, skipped). */
  totalTests: number;
  /** Number of tests that passed. */
  passed: number;
  /** Number of tests that failed. */
  failed: number;
  /** Number of tests that were skipped. */
  skipped: number;
  /** Number of tests that errored (crashed during execution). */
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

/* ------------------------------------------------------------------ */
/* Lint results                                                       */
/* ------------------------------------------------------------------ */

/**
 * Lint result status.
 */
export type LintStatus = "passed" | "failed" | "not_run";

/**
 * Structured lint results from the coding agent's output.
 * Mirrors LAT-8's lint verification evidence.
 */
export interface LintResults {
  status: LintStatus;
  /** Total number of lint violations found. */
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
  /** File path where the violation was found. */
  file: string;
  /** Line number (1-based). */
  line: number;
  /** Column number (1-based). */
  column?: number;
  /** Severity level. */
  severity: "error" | "warning" | "info";
  /** Rule identifier. */
  rule: string;
  /** Human-readable message. */
  message: string;
}

/* ------------------------------------------------------------------ */
/* Coverage metrics                                                   */
/* ------------------------------------------------------------------ */

/**
 * Coverage metrics from the coding agent's output.
 * Mirrors LAT-8's coverage evidence requirement.
 */
export interface CoverageMetrics {
  /** Overall percentage of covered lines (0–100). Null if not computed. */
  totalPercentage: number | null;
  /** Percentage of covered branches (0–100). Null if not computed. */
  branchPercentage: number | null;
  /** Percentage of covered functions (0–100). Null if not computed. */
  functionPercentage: number | null;
  /** Percentage of covered statements (0–100). Null if not computed. */
  statementPercentage: number | null;
  /** Duration in milliseconds. */
  durationMs: number;
  /**
   * Per-file coverage summary. Ordered by file path.
   */
  files: ReadonlyArray<CoverageFileSummary>;
}

/**
 * Coverage for a single file.
 */
export interface CoverageFileSummary {
  /** File path. */
  file: string;
  /** Lines covered / total lines (percentage). Null if not available. */
  lineCoverage: number | null;
  /** Branches covered / total branches. Null if not available. */
  branchCoverage: number | null;
  /** Functions covered / total functions. Null if not available. */
  functionCoverage: number | null;
  /** Statements covered / total statements. Null if not available. */
  statementCoverage: number | null;
}

/* ------------------------------------------------------------------ */
/* Acceptance criterion result                                        */
/* ------------------------------------------------------------------ */

/**
 * Verification result for a single acceptance criterion.
 * Mirrors LAT-8's acceptance criteria verification requirement.
 */
export interface AcceptanceCriterionResult {
  /** The criterion text (verbatim from input). */
  criterion: string;
  /** Verification result. */
  status: "passed" | "failed" | "partial" | "skipped";
  /** Evidence or explanation. */
  evidence: string;
}

/* ------------------------------------------------------------------ */
/* Recommendation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Recommendation ladder from ADR-0007 (LAT-26 §6.2).
 * Used by LAT-8 evidence workflow and the review agent.
 */
export type Recommendation =
  | "approve"
  | "approve-with-nits"
  | "request-changes"
  | "block-merge"
  | "needs-human";

/* ------------------------------------------------------------------ */
/* Autonomy level                                                     */
/* ------------------------------------------------------------------ */

/**
 * Autonomy notation per ADR-0008 (L0–L5).
 * Re-exported for convenience so this module is self-contained.
 */
export type AutonomyLevel =
  | "L1-read-only"
  | "L2-propose"
  | "L3-with-approval"
  | "L4-autonomous";
