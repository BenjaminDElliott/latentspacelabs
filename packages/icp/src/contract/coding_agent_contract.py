"""
Coding agent input/output contract (LAT-174) — Python types.

Defines the canonical shape of the coding agent's contract: what the agent
receives as input (repo, branch, target_branch, code diff, build command,
test command) and what it produces as output (diff, build_status, test_results,
lint_results, coverage).

Evidence requirements are drawn from LAT-8 (Define QA/review evidence
workflow), which mandates that every coding-agent run produces structured
evidence for:
  - Acceptance criteria verification
  - Test results
  - Files changed
  - Risks
  - Regressions
  - Security/architecture concerns
  - Final recommendation

This module is a pure type layer — no I/O, no side effects.

LAT-174 non-goals: agent-specific output formats (adapters normalise).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


# ------------------------------------------------------------------ #
# Schema version                                                     #
# ------------------------------------------------------------------ #

CODING_AGENT_CONTRACT_SCHEMA_VERSION = "1.0.0"


# ------------------------------------------------------------------ #
# Enums                                                              #
# ------------------------------------------------------------------ #


class AutonomyLevel(str, Enum):
    """ADR-0008 autonomy notation (L1–L4)."""

    L1_READ_ONLY = "L1-read-only"
    L2_PROPOSE = "L2-propose"
    L3_WITH_APPROVAL = "L3-with-approval"
    L4_AUTONOMOUS = "L4-autonomous"


class BuildStatusValue(str, Enum):
    """Build status outcome."""

    PASSED = "passed"
    FAILED = "failed"
    NOT_RUN = "not_run"


class TestOutcome(str, Enum):
    """Overall test outcome."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    NOT_RUN = "not_run"


class TestCaseStatus(str, Enum):
    """Result for a single test case."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERRORED = "errored"


class LintStatusValue(str, Enum):
    """Lint result status."""

    PASSED = "passed"
    FAILED = "failed"
    NOT_RUN = "not_run"


class LintSeverity(str, Enum):
    """Lint violation severity."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class AcceptanceCriterionStatus(str, Enum):
    """Verification result for a single acceptance criterion."""

    PASSED = "passed"
    FAILED = "failed"
    PARTIAL = "partial"
    SKIPPED = "skipped"


class Recommendation(str, Enum):
    """ADR-0007 recommendation ladder (LAT-26 §6.2)."""

    APPROVE = "approve"
    APPROVE_WITH_NITS = "approve-with-nits"
    REQUEST_CHANGES = "request-changes"
    BLOCK_MERGE = "block-merge"
    NEEDS_HUMAN = "needs-human"


# ------------------------------------------------------------------ #
# Input types                                                        #
# ------------------------------------------------------------------ #


@dataclass
class CodingAgentInput:
    """
    The canonical input a coding agent receives before it starts work.

    LAT-174 input fields:
      - repo:            target repository (owner/name)
      - branch:          source branch the agent will work on
      - target_branch:   base branch for the PR (typically main)
      - code_diff:       code diff/patch the agent should produce
      - build_command:   command to build the project
      - test_command:    command to run tests
      - lint_command:    optional command to run linting
      - coverage_command: optional command to measure coverage
      - acceptance_criteria: testable statements to verify
      - files_in_scope:   files the agent should touch
      - files_forbidden:  files explicitly excluded
      - non_goals:        out-of-scope notes
      - guardrails:       rules the agent must follow
      - budget_cap_usd:   ADR-0009 budget cap
      - autonomy_level:   ADR-0008 autonomy level (L1–L4)
      - run_id:           stable run identifier
      - ticket_title:     ticket title for PR title prefix
    """

    repo: str
    branch: str
    target_branch: str
    code_diff: str = ""
    build_command: str = ""
    test_command: str = ""
    lint_command: str = ""
    coverage_command: str = ""
    acceptance_criteria: list[str] = field(default_factory=list)
    files_in_scope: list[str] = field(default_factory=list)
    files_forbidden: list[str] = field(default_factory=list)
    non_goals: list[str] = field(default_factory=list)
    guardrails: list[str] = field(default_factory=list)
    budget_cap_usd: float | None = None
    autonomy_level: AutonomyLevel | None = None
    run_id: str = ""
    ticket_title: str = ""


# ------------------------------------------------------------------ #
# Build result                                                       #
# ------------------------------------------------------------------ #


@dataclass
class BuildStatus:
    """Build result from the coding agent's output."""

    status: BuildStatusValue = BuildStatusValue.NOT_RUN
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0


# ------------------------------------------------------------------ #
# Test results                                                       #
# ------------------------------------------------------------------ #


@dataclass
class TestCaseResult:
    """Result for a single test case."""

    name: str
    suite: str = ""
    status: TestCaseStatus = TestCaseStatus.PASSED
    duration_ms: int = 0
    error_message: str = ""
    stack_trace: str = ""


@dataclass
class TestResults:
    """Structured test results."""

    outcome: TestOutcome = TestOutcome.NOT_RUN
    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: int = 0
    duration_ms: int = 0
    tests: list[TestCaseResult] = field(default_factory=list)


# ------------------------------------------------------------------ #
# Lint results                                                       #
# ------------------------------------------------------------------ #


@dataclass
class LintViolation:
    """A single lint violation."""

    file: str
    line: int
    column: int = 1
    severity: LintSeverity = LintSeverity.WARNING
    rule: str = ""
    message: str = ""


@dataclass
class LintResults:
    """Structured lint results."""

    status: LintStatusValue = LintStatusValue.NOT_RUN
    total_violations: int = 0
    errors: int = 0
    warnings: int = 0
    infos: int = 0
    duration_ms: int = 0
    violations: list[LintViolation] = field(default_factory=list)


# ------------------------------------------------------------------ #
# Coverage metrics                                                   #
# ------------------------------------------------------------------ #


@dataclass
class CoverageFileSummary:
    """Coverage for a single file."""

    file: str
    line_coverage: float | None = None
    branch_coverage: float | None = None
    function_coverage: float | None = None
    statement_coverage: float | None = None


@dataclass
class CoverageMetrics:
    """Coverage metrics."""

    total_percentage: float | None = None
    branch_percentage: float | None = None
    function_percentage: float | None = None
    statement_percentage: float | None = None
    duration_ms: int = 0
    files: list[CoverageFileSummary] = field(default_factory=list)


# ------------------------------------------------------------------ #
# Acceptance criterion result                                        #
# ------------------------------------------------------------------ #


@dataclass
class AcceptanceCriterionResult:
    """Verification result for a single acceptance criterion."""

    criterion: str
    status: AcceptanceCriterionStatus
    evidence: str = ""


# ------------------------------------------------------------------ #
# Output types                                                       #
# ------------------------------------------------------------------ #


@dataclass
class CodingAgentOutput:
    """
    The canonical output a coding agent produces after completing its task.

    LAT-174 output fields:
      - diff:                 code diff/patch produced
      - build_status:         build result
      - test_results:         structured test results
      - lint_results:         lint results
      - coverage:             coverage metrics (nullable)
      - acceptance_criteria_verified: LAT-8 evidence
      - risks:                LAT-8 evidence
      - regressions:          LAT-8 evidence
      - security_or_architecture_concerns: LAT-8 evidence
      - recommendation:       LAT-8 evidence (ADR-0007)
      - summary:              one-line summary
      - pr_url:               PR URL
      - pr_branch:            PR branch
      - commit_sha:           commit SHA
      - notes:                free-form agent notes
    """

    schema_version: str = CODING_AGENT_CONTRACT_SCHEMA_VERSION
    diff: str = ""
    build_status: BuildStatus = field(default_factory=BuildStatus)
    test_results: TestResults = field(default_factory=TestResults)
    lint_results: LintResults = field(default_factory=LintResults)
    coverage: CoverageMetrics | None = None
    acceptance_criteria_verified: list[AcceptanceCriterionResult] = field(
        default_factory=list
    )
    risks: list[str] = field(default_factory=list)
    regressions: list[str] = field(default_factory=list)
    security_or_architecture_concerns: list[str] = field(default_factory=list)
    recommendation: Recommendation = Recommendation.NEEDS_HUMAN
    summary: str = ""
    pr_url: str | None = None
    pr_branch: str | None = None
    commit_sha: str | None = None
    notes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.schema_version != CODING_AGENT_CONTRACT_SCHEMA_VERSION:
            raise ValueError(
                f"schema_version must be {CODING_AGENT_CONTRACT_SCHEMA_VERSION!r}, "
                f"got {self.schema_version!r}"
            )


# ------------------------------------------------------------------ #
# Validation helpers                                                 #
# ------------------------------------------------------------------ #


def validate_coding_agent_input(input_data: dict) -> CodingAgentInput:
    """
    Validate and construct a CodingAgentInput from a dictionary.

    Raises ValueError if required fields are missing.
    """
    required = {"repo", "branch", "target_branch", "build_command", "test_command"}
    missing = required - set(input_data.keys())
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(sorted(missing))}")

    autonomy_level = input_data.get("autonomy_level")
    if autonomy_level is not None:
        try:
            autonomy_level = AutonomyLevel(autonomy_level)
        except ValueError:
            raise ValueError(
                f"Invalid autonomy_level: {autonomy_level!r}. "
                f"Must be one of: {[a.value for a in AutonomyLevel]}"
            )

    return CodingAgentInput(**input_data)  # type: ignore[arg-type]


def validate_coding_agent_output(output_data: dict) -> CodingAgentOutput:
    """
    Validate and construct a CodingAgentOutput from a dictionary.

    Raises ValueError if required fields are missing.
    """
    required = {"diff", "build_status", "test_results", "lint_results", "recommendation"}
    missing = required - set(output_data.keys())
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(sorted(missing))}")

    recommendation = output_data.get("recommendation")
    if recommendation is not None:
        try:
            recommendation = Recommendation(recommendation)
        except ValueError:
            raise ValueError(
                f"Invalid recommendation: {recommendation!r}. "
                f"Must be one of: {[r.value for r in Recommendation]}"
            )

    return CodingAgentOutput(**output_data)  # type: ignore[arg-type]
