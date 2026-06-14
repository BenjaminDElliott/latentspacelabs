"""Data models for the benchmark evaluation platform."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class BenchmarkType(str, Enum):
    """Supported benchmark types."""

    SWE_BENCH = "swe_bench"
    AGENT_BENCH = "agent_bench"
    WEBARENA = "webarena"
    GAIA = "gaia"
    TOOLBENCH = "toolbench"


class AgentConfig(BaseModel):
    """Configuration for an agent under evaluation."""

    model: str = Field(description="LLM model name, e.g. claude-opus-4-20250514")
    temperature: float = Field(default=0.2, ge=0, le=1.0)
    system_prompt: str = Field(default="You are a helpful AI agent.")
    max_tokens: int = Field(default=4096, ge=1)


class BenchmarkConfig(BaseModel):
    """Configuration for a benchmark evaluation run."""

    benchmark_type: BenchmarkType
    agent_config: AgentConfig
    subset_size: int = Field(default=50, ge=1, description="Number of tasks to evaluate")
    max_concurrent: int = Field(default=5, ge=1, description="Max concurrent workers")
    cost_cap: float = Field(default=100.0, ge=0, description="Max cost per run in USD")
    tags: list[str] = Field(default_factory=list)


class TaskResult(BaseModel):
    """Result for a single benchmark task."""

    task_id: str
    benchmark_type: BenchmarkType
    status: str  # "passed", "failed", "timeout", "error"
    score: float = Field(ge=0, le=100, default=0.0)
    tokens_used: int = 0
    cost_usd: float = 0.0
    duration_seconds: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class BenchmarkResult(BaseModel):
    """Aggregated results for one benchmark type."""

    benchmark_type: BenchmarkType
    total_tasks: int = 0
    completed_tasks: int = 0
    passed_tasks: int = 0
    failed_tasks: int = 0
    timeout_tasks: int = 0
    error_tasks: int = 0
    average_score: float = 0.0
    task_results: list[TaskResult] = Field(default_factory=list)
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    total_duration_seconds: float = 0.0
    mqa_scores: dict[str, float] = Field(default_factory=dict)


class EvaluationRun(BaseModel):
    """A complete evaluation run across benchmarks."""

    run_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    benchmark_configs: list[BenchmarkConfig] = Field(default_factory=list)
    benchmark_results: dict[str, BenchmarkResult] = Field(default_factory=dict)
    status: str = Field(default="pending")  # pending, running, completed, failed
    total_cost_usd: float = 0.0
    total_tokens: int = 0
    progress: dict[str, float] = Field(default_factory=dict)  # benchmark -> 0-100
    error_message: str | None = None
    tags: list[str] = Field(default_factory=list)


class CostRecord(BaseModel):
    """A single cost entry for tracking."""

    run_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    benchmark_type: str
    tokens: int = 0
    cost_usd: float = 0.0
    compute_millis: int = 0
    description: str = ""


class MQAScore(BaseModel):
    """Multi-Quality Assessment score for a single facet."""

    facet: str
    score: float = Field(ge=0, le=100, description="Score 0-100")
    rationale: str = ""
    details: dict[str, Any] = Field(default_factory=dict)


class Scorecard(BaseModel):
    """Full scorecard for an evaluation run."""

    run_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    summary: dict[str, float] = Field(default_factory=dict)  # facet -> score
    mqa_scores: list[MQAScore] = Field(default_factory=list)
    benchmark_scores: dict[str, float] = Field(default_factory=dict)  # benchmark -> avg score
    cost_analysis: dict[str, float] = Field(default_factory=dict)
    trend_data: list[dict[str, Any]] = Field(default_factory=list)  # historical comparison
    recommendations: list[str] = Field(default_factory=list)
    overall_score: float = 0.0


class ProgressSnapshot(BaseModel):
    """Real-time progress snapshot."""

    run_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str
    progress: dict[str, float] = Field(default_factory=dict)  # benchmark -> 0-100
    current_task: str | None = None
    active_benchmarks: list[str] = Field(default_factory=list)


class RegressionAlert(BaseModel):
    """Alert when performance drops."""

    run_id: str
    benchmark_type: str
    metric: str
    old_score: float
    new_score: float
    drop_percent: float
    threshold: float = 5.0


# ── DTOs for FastAPI ──────────────────────────────────────────────────


class EvaluateRequest(BaseModel):
    """Request body for triggering an evaluation."""

    benchmark_configs: list[BenchmarkConfig]
    tags: list[str] = Field(default_factory=list)


class EvaluateResponse(BaseModel):
    """Response after triggering an evaluation."""

    run_id: str
    status: str
    message: str
    benchmark_configs: list[BenchmarkConfig] = Field(default_factory=list)


class StatusResponse(BaseModel):
    """Current status of an evaluation run."""

    run_id: str
    status: str
    progress: dict[str, float] = Field(default_factory=dict)
    total_cost_usd: float = 0.0
    total_tokens: int = 0
    created_at: datetime | None = None
    error_message: str | None = None


class ScorecardResponse(BaseModel):
    """Scorecard for an evaluation run."""

    run_id: str
    created_at: datetime
    overall_score: float
    summary: dict[str, float] = Field(default_factory=dict)
    mqa_scores: list[MQAScore] = Field(default_factory=list)
    benchmark_scores: dict[str, float] = Field(default_factory=dict)
    recommendations: list[str] = Field(default_factory=list)


class TrendEntry(BaseModel):
    """A single entry in the historical trend data."""

    run_id: str
    timestamp: datetime
    benchmark_type: str
    average_score: float
    total_cost_usd: float
    total_tasks: int
