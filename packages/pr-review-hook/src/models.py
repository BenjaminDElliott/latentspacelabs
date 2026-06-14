"""
Data models for the PR review hook.

Pydantic models that define the review input envelope and output evidence.
All models use strict validation so the hook fails fast on bad input.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Severity(str, enum.Enum):
    """Severity ladder from ADR-0007 / qa-review-evidence.md."""

    NIT = "nit"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Recommendation(str, enum.Enum):
    """Final review recommendation values."""

    APPROVE = "approve"
    APPROVE_WITH_NITS = "approve-with-nits"
    REQUEST_CHANGES = "request-changes"
    BLOCK_MERGE = "block-merge"
    NEEDS_HUMAN = "needs-human"


class ReviewCategory(str, enum.Enum):
    """Categorisation for a finding."""

    ARCHITECTURE = "architecture"
    CODE_QUALITY = "code-quality"
    SECURITY = "security"
    TEST_COVERAGE = "test-coverage"
    DOCUMENTATION = "documentation"
    PERFORMANCE = "performance"
    CONFIGURATION = "configuration"
    ADR_ALIGNMENT = "adr-alignment"
    PREFLIGHT = "preflight"
    OTHER = "other"


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class Location(BaseModel):
    """File and line location within the PR diff."""

    file: str = Field(..., description="Relative file path in the repo")
    line: Optional[int] = Field(None, description="Line number (1-based), if applicable")
    diff_hunk: Optional[str] = Field(None, description="Diff hunk context, if applicable")


class Finding(BaseModel):
    """A single finding produced by the review."""

    id: str = Field(default_factory=lambda: f"finding-{uuid.uuid4().hex[:8]}")
    severity: Severity = Field(..., description="Severity from the ADR-0007 ladder")
    title: str = Field(..., description="Short title for the finding")
    description: str = Field(..., description="Detailed description of the finding")
    location: Optional[Location] = Field(None, description="File:line where the finding applies")
    category: ReviewCategory = Field(
        default=ReviewCategory.OTHER,
        description="Category for categorisation and filtering",
    )
    suggested_action: str = Field(
        default="",
        description="Recommended fix or action",
    )
    cites_adr: Optional[str] = Field(
        None,
        description="ADR number cited, if applicable (e.g. 'ADR-0011')",
    )

    @field_validator("severity")
    @classmethod
    def severity_must_be_valid(cls, v: Severity) -> Severity:
        valid = {s.value for s in Severity}
        if isinstance(v, str) and v not in valid:
            raise ValueError(f"Invalid severity: {v!r}. Must be one of {valid}")
        return v


class InlineComment(BaseModel):
    """A file/line inline comment to post on the PR."""

    finding_id: str = Field(..., description="ID of the finding this cites")
    file: str = Field(..., description="File path")
    line: Optional[int] = Field(None, description="Line number (1-based)")
    body: str = Field(..., description="Comment body as Markdown")


class PreflightResult(BaseModel):
    """Captured LAT-35 preflight results."""

    passed: bool
    failed_checks: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    run_id: Optional[str] = None
    timestamp: Optional[str] = None


class ReviewInput(BaseModel):
    """The input envelope collected before the review runs.

    Mirrors the input contract defined in docs/pr-review-hook.md § 3.
    """

    run_id: str = Field(
        default_factory=lambda: f"review-{uuid.uuid4().hex[:12]}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
        description="Unique run identifier for traceability",
    )
    pr_url: str = Field(..., description="Full GitHub PR URL")
    repo: str = Field(
        ...,
        description="Repo owner/name (e.g. 'BenjaminDElliott/latentspacelabs')",
    )
    pr_number: int = Field(..., description="GitHub PR number")
    base_ref: str = Field(..., description="Target branch (must be 'main')")
    head_ref: str = Field(..., description="Source branch name")
    head_commit: str = Field(..., description="HEAD commit SHA")
    linear_ticket: str = Field(
        ...,
        description="Linear ticket key (e.g. 'LAT-50')",
    )
    pr_title: str = Field(..., description="PR title")
    pr_body: str = Field(
        default="",
        description="PR description body",
    )
    is_draft: bool = Field(
        default=False,
        description="Whether the PR is in draft state",
    )
    changed_files: list[str] = Field(
        default_factory=list,
        description="List of file paths changed in the diff",
    )
    diff_text: str = Field(
        default="",
        description="Unified diff text of the PR",
    )
    preflight_results: Optional[PreflightResult] = Field(
        None,
        description="LAT-35 preflight results, if available",
    )
    fetched_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="When the inputs were collected",
    )
    dry_run: bool = Field(
        default=False,
        description="If True, skip comment posting",
    )

    @field_validator("linear_ticket")
    @classmethod
    def linear_ticket_must_start_with_lat(cls, v: str) -> str:
        if not v.startswith("LAT-"):
            raise ValueError("linear_ticket must start with 'LAT-' (e.g. 'LAT-50')")
        return v


# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------

class MergeReadiness(BaseModel):
    """Merge readiness derived from review findings.

    Feeds into LAT-47's ready-to-merge gate.
    """

    is_ready: bool = Field(
        default=True,
        description="Whether the PR is ready to merge based on review findings",
    )
    blocking_findings: list[str] = Field(
        default_factory=list,
        description="Finding IDs that block merge",
    )
    medium_findings_count: int = Field(
        default=0,
        description="Count of medium findings (3+ escalate readiness)",
    )
    low_findings_count: int = Field(
        default=0,
        description="Count of low findings (3+ escalate to medium impact)",
    )
    requires_ben_approval: bool = Field(
        default=False,
        description="True if a critical finding requires Ben approval",
    )
    notes: str = Field(
        default="",
        description="Human-readable explanation",
    )


class LinearWriteback(BaseModel):
    """Linear write-back following ADR-0003 contract + LAT-50 additions."""

    outcome: str
    evidence: str
    risks: str
    pr_url: str
    next_action: str
    open_questions: str
    merge_readiness: Optional[str] = Field(
        None,
        description="Merge readiness text, included when not ready",
    )
    run_id: str = Field(
        default="",
        description="Run ID for traceability",
    )

    def format(self) -> str:
        """Format as Markdown for posting as a Linear comment."""
        lines = [
            f"**Outcome:** {self.outcome}",
            f"**Evidence:** {self.evidence}",
            f"**Risks:** {self.risks}",
            f"**PR:** {self.pr_url}",
            f"**Next action:** {self.next_action}",
            f"**Open questions:** {self.open_questions}",
        ]
        if self.merge_readiness:
            lines.append(f"**Merge readiness:** {self.merge_readiness}")
        if self.run_id:
            lines.append(f"**Run ID:** {self.run_id}")
        return "\n".join(lines)


class ReviewOutput(BaseModel):
    """The complete output of the review hook."""

    run_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    pr_url: str
    summary: str = Field(
        ...,
        description="One-line summary of the review outcome",
    )
    recommendation: Recommendation
    findings: list[Finding] = Field(default_factory=list)
    inline_comments: list[InlineComment] = Field(default_factory=list)
    evidence_artifact: Optional[dict[str, str]] = Field(
        None,
        description="Path and URL of the evidence artifact",
    )
    linear_writeback: Optional[LinearWriteback] = None
    merge_readiness: MergeReadiness = Field(default_factory=MergeReadiness)

    @property
    def is_block_merge(self) -> bool:
        """Whether the recommendation blocks merge."""
        return self.recommendation in (
            Recommendation.BLOCK_MERGE,
            Recommendation.NEEDS_HUMAN,
            Recommendation.REQUEST_CHANGES,
        )

    @property
    def requires_ben_approval(self) -> bool:
        """Whether any critical finding requires Ben approval."""
        return any(f.severity == Severity.CRITICAL for f in self.findings)

    def compute_merge_readiness(self) -> MergeReadiness:
        """Compute merge readiness from findings.

        Implements the merge readiness policy from docs/pr-review-hook.md § 4.
        """
        severities = [f.severity for f in self.findings]
        blocking = [
            f.id for f in self.findings
            if f.severity in (Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL)
        ]
        medium_count = severities.count(Severity.MEDIUM)
        low_count = severities.count(Severity.LOW)

        # Three+ low findings escalate to medium impact
        if low_count >= 3:
            medium_count += (low_count - 2)  # extra low findings count as medium

        is_ready = not blocking and not self.requires_ben_approval
        requires_ben = any(
            f.severity == Severity.CRITICAL for f in self.findings
        )

        notes_parts = []
        if medium_count > 0:
            notes_parts.append(f"{medium_count} medium finding(s) require fix or acceptance")
        if low_count >= 3:
            notes_parts.append(f"{low_count} low findings escalated to medium impact")
        if requires_ben:
            notes_parts.append("critical finding requires Ben approval")
        if not blocking and not requires_ben:
            notes_parts.append("no blocking findings")

        return MergeReadiness(
            is_ready=is_ready,
            blocking_findings=blocking,
            medium_findings_count=medium_count,
            low_findings_count=low_count,
            requires_ben_approval=requires_ben,
            notes="; ".join(notes_parts) if notes_parts else "no findings",
        )

    def compute_linear_writeback(self) -> LinearWriteback:
        """Build the Linear write-back from this output."""
        severity_labels = {}
        for f in self.findings:
            severity_labels[f.severity.value] = severity_labels.get(f.severity.value, 0) + 1

        risk_parts = []
        for sev, count in severity_labels.items():
            if sev in ("high", "critical", "medium"):
                risk_parts.append(f"{sev} x{count}")
        risk_str = ", ".join(risk_parts) if risk_parts else "none"

        # Compute merge readiness if not already set
        if self.merge_readiness.is_ready is True and not self.merge_readiness.blocking_findings:
            self.merge_readiness = self.compute_merge_readiness()

        mr_text = None
        if not self.merge_readiness.is_ready:
            mr_text = f"NOT READY — {self.merge_readiness.notes}"

        evidence_parts = [self.pr_url]
        if self.evidence_artifact:
            evidence_parts.append(self.evidence_artifact.get("url", ""))
        evidence_parts.append(f"run_id={self.run_id}")

        return LinearWriteback(
            outcome=f"{self.recommendation.value} — {self.summary}",
            evidence=" · ".join(evidence_parts),
            risks=f"{risk_str}; cost band normal",
            pr_url=self.pr_url,
            next_action="author addresses findings, re-request review",
            open_questions="none",
            merge_readiness=mr_text,
            run_id=self.run_id,
        )

    def format_report(self) -> str:
        """Format as a Markdown PR review report (matches pr-review-report.md template)."""
        lines = [
            f"# PR Review Report: {self.run_id}",
            "",
            "## Metadata",
            "",
            f"- **Run ID:** {self.run_id}",
            f"- **PR:** {self.pr_url}",
            f"- **Timestamp:** {self.timestamp.isoformat()}",
            f"- **Recommendation:** {self.recommendation.value}",
            "",
            "## Summary",
            "",
            self.summary,
            "",
            "## Findings",
            "",
        ]

        if self.findings:
            lines.append("| Severity | Finding | Location | Suggested Action |")
            lines.append("|---|---|---|---|")
            for f in self.findings:
                if f.location:
                    loc = f"{f.location.file}"
                    if f.location.line:
                        loc += f":{f.location.line}"
                else:
                    loc = "n/a"
                lines.append(
                    f"| {f.severity.value} | {f.title} | {loc} | {f.suggested_action} |"
                )
        else:
            lines.append("*No findings.*")

        lines.extend([
            "",
            "## Merge Readiness",
            "",
            f"- **Ready:** {'Yes' if self.merge_readiness.is_ready else 'No'}",
            f"- **Blocking findings:** {', '.join(self.merge_readiness.blocking_findings) or 'none'}",
            f"- **Notes:** {self.merge_readiness.notes}",
            "",
            "## Inline Comments",
            "",
        ])

        if self.inline_comments:
            for ic in self.inline_comments:
                loc = ic.file
                if ic.line:
                    loc += f":{ic.line}"
                lines.append(f"- `{loc}` — cites finding #{ic.finding_id}")
        else:
            lines.append("*No inline comments.*")

        lines.extend([
            "",
            "## Linear Write-back",
            "",
            "```md",
            self.compute_linear_writeback().format(),
            "```",
            "",
            "## Merge posture reminder",
            "",
            "No agent in the pilot is authorized to merge. This recommendation authorizes "
            "*asking* Ben for merge, not merging. See "
            "`docs/process/operating-model.md` approval gates.",
            "",
        ])
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def generate_run_id(pr_number: int, repo: str) -> str:
    """Generate a deterministic run ID from PR metadata."""
    return f"review-{repo.replace('/', '-')}-pr{pr_number}-{uuid.uuid4().hex[:8]}"


def severity_sort_key(sev: Severity) -> int:
    """Sort key for severity (higher = more severe)."""
    order = {
        Severity.NIT: 0,
        Severity.LOW: 1,
        Severity.MEDIUM: 2,
        Severity.HIGH: 3,
        Severity.CRITICAL: 4,
    }
    return order.get(sev, -1)


def rule_based_recommendation(findings: list[Finding]) -> Recommendation:
    """Compute a recommendation from findings using the ADR-0007 rules.

    This is the fallback when the LLM is unavailable or when running
    the rule-based reviewer.
    """
    severities = [f.severity for f in findings]
    has_critical = Severity.CRITICAL in severities
    has_high = Severity.HIGH in severities

    if has_critical:
        return Recommendation.NEEDS_HUMAN
    if has_high:
        return Recommendation.BLOCK_MERGE

    medium_count = severities.count(Severity.MEDIUM)
    low_count = severities.count(Severity.LOW)

    # Three+ low findings escalate
    if low_count >= 3:
        medium_count += (low_count - 2)

    if medium_count > 0:
        return Recommendation.REQUEST_CHANGES
    if low_count > 0:
        return Recommendation.APPROVE_WITH_NITS
    return Recommendation.APPROVE


def count_by_severity(findings: list[Finding]) -> dict[str, int]:
    """Count findings by severity."""
    counts: dict[str, int] = {}
    for f in findings:
        counts[f.severity.value] = counts.get(f.severity.value, 0) + 1
    return counts


def find_evidence_path(run_id: str) -> Path:
    """Return the path where the evidence artifact should be written."""
    return Path(".agent-runs") / run_id
