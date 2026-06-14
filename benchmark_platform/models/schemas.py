"""
Data models and schemas for the benchmark evaluation platform.

Defines the core types used across runners, analytics, regression detection,
and CI/CD integration.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class BenchmarkName(str, Enum):
    SWE_BENCH = "swe-bench"
    AGENT_BENCH = "agent-bench"
    WEBARENA = "webarena"
    GAIA = "gaia"
    TOOLBENCH = "toolbench"


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    ERROR = "error"
    TIMEOUT = "timeout"


# ---------------------------------------------------------------------------
# Core types
# ---------------------------------------------------------------------------

class TokenUsage(BaseModel):
    """Token usage for a single API call."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class CostBreakdown(BaseModel):
    """Cost breakdown for an evaluation run."""
    input_tokens: int = 0
    output_tokens: int = 0
    input_cost_usd: float = 0.0
    output_cost_usd: float = 0.0
    total_cost_usd: float = 0.0
    currency: str = "USD"


class BenchmarkResult(BaseModel):
    """Result of a single instance evaluation."""
    instance_id: str
    benchmark: BenchmarkName
    status: AgentStatus = AgentStatus.ERROR
    score: float = 0.0
    details: Dict[str, Any] = Field(default_factory=dict)
    tokens_used: TokenUsage = Field(default_factory=TokenUsage)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class EvaluationRun(BaseModel):
    """A single evaluation run — one benchmark against one agent config."""

    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    benchmark: BenchmarkName
    agent_name: str
    model: str
    status: RunStatus = RunStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    results: List[BenchmarkResult] = Field(default_factory=list)
    total_instances: int = 0
    passed_instances: int = 0
    failed_instances: int = 0
    error_instances: int = 0
    timeout_instances: int = 0
    aggregate_score: float = 0.0
    cost: CostBreakdown = Field(default_factory=CostBreakdown)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @property
    def completion_pct(self) -> float:
        if self.total_instances == 0:
            return 0.0
        completed = self.passed_instances + self.failed_instances + self.error_instances + self.timeout_instances
        return min(100.0, (completed / self.total_instances) * 100.0)

    @property
    def duration_seconds(self) -> Optional[float]:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


class AgentComparison(BaseModel):
    """A/B comparison between two agent configurations."""
    run_a: EvaluationRun
    run_b: EvaluationRun
    benchmark: BenchmarkName

    @property
    def delta_score(self) -> float:
        return self.run_b.aggregate_score - self.run_a.aggregate_score

    @property
    def delta_cost(self) -> float:
        return self.run_b.cost.total_cost_usd - self.run_a.cost.total_cost_usd


class RegressionAlert(BaseModel):
    """A regression alert triggered by the detector."""
    benchmark: BenchmarkName
    agent_name: str
    current_score: float
    previous_avg_score: float
    score_delta_pct: float
    detected_at: datetime = Field(default_factory=datetime.now)
    threshold_pct: float = 5.0
    message: str = ""

    def __str__(self) -> str:
        return (
            f"Regression Alert: {self.benchmark.value} / {self.agent_name} "
            f"score dropped {self.score_delta_pct:.1f}% "
            f"({self.current_score:.3f} vs avg {self.previous_avg_score:.3f})"
        )


class ReportData(BaseModel):
    """Aggregated data for report generation."""
    run_id: str
    benchmark: BenchmarkName
    agent_name: str
    model: str
    total_instances: int
    pass_rate: float
    avg_score: float
    total_cost_usd: float
    total_tokens: int
    duration_seconds: Optional[float]
    results_summary: List[Dict[str, Any]] = Field(default_factory=list)
