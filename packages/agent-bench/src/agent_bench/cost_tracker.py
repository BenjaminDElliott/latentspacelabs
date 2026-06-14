"""Cost tracking module for evaluation runs.

Tracks tokens, API costs, and compute usage per benchmark.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from typing import Any

from agent_bench.models import BenchmarkResult, CostRecord, EvaluationRun

logger = logging.getLogger(__name__)


class CostTracker:
    """Tracks and summarizes evaluation costs.

    Example:
        tracker = CostTracker()
        tracker.record(run_id, "swe_bench", tokens=10000, cost_usd=0.03)
        summary = tracker.get_summary(run_id)
    """

    def __init__(self) -> None:
        self._records: dict[str, list[CostRecord]] = {}

    def record(self, run_id: str, benchmark_type: str, *, tokens: int = 0,
               cost_usd: float = 0.0, compute_millis: int = 0,
               description: str = "") -> CostRecord:
        """Record a cost entry."""
        record = CostRecord(
            run_id=run_id,
            benchmark_type=benchmark_type,
            tokens=tokens,
            cost_usd=cost_usd,
            compute_millis=compute_millis,
            description=description,
        )
        self._records.setdefault(run_id, []).append(record)
        logger.debug(f"Cost recorded: {benchmark_type} tokens={tokens} cost=${cost_usd:.4f}")
        return record

    def aggregate(self, run_id: str) -> dict[str, Any]:
        """Aggregate costs for a run by benchmark type."""
        records = self._records.get(run_id, [])
        summary: dict[str, Any] = {
            "total_cost_usd": 0.0,
            "total_tokens": 0,
            "total_compute_millis": 0,
        }
        by_benchmark: dict[str, dict[str, float]] = {}

        for r in records:
            summary["total_cost_usd"] += r.cost_usd
            summary["total_tokens"] += r.tokens
            summary["total_compute_millis"] += r.compute_millis

            bt = r.benchmark_type
            if bt not in by_benchmark:
                by_benchmark[bt] = {"cost_usd": 0.0, "tokens": 0}
            by_benchmark[bt]["cost_usd"] += r.cost_usd
            by_benchmark[bt]["tokens"] += r.tokens

        summary["by_benchmark"] = by_benchmark
        return summary

    def check_cap(self, run_id: str, cap: float) -> bool:
        """Check if total cost is within cap."""
        agg = self.aggregate(run_id)
        return agg["total_cost_usd"] <= cap

    def get_records(self, run_id: str) -> list[CostRecord]:
        """Get all cost records for a run."""
        return list(self._records.get(run_id, []))

    @staticmethod
    def estimate_cost(tokens: int, model: str = "claude-opus") -> float:
        """Estimate API cost for a given number of tokens.

        Pricing is approximate and based on public LLM provider rates.
        """
        rates = {
            "claude-opus": 0.000003,
            "claude-sonnet": 0.0000015,
            "gpt-4": 0.000003,
            "gpt-4o": 0.0000025,
            "llama-3": 0.000001,
            "default": 0.000002,
        }
        rate = rates.get(model, rates["default"])
        return round(tokens * rate, 6)

    @staticmethod
    def estimate_compute_cost(millis: int, instance_type: str = "standard") -> float:
        """Estimate compute cost based on usage time."""
        rates = {"standard": 0.0005, "gpu": 0.002, "cpu": 0.0001}
        rate = rates.get(instance_type, rates["standard"])
        return round(millis * rate / 1000, 6)
