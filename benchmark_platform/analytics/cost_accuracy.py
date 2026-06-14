"""
Cost and accuracy analytics module.

Tracks API costs, token usage, and accuracy metrics across evaluation runs.
Supports historical trend analysis and cost-per-benchmark breakdowns.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import numpy as np

from benchmark_platform.config import AnalyticsConfig
from benchmark_platform.models.schemas import (
    CostBreakdown,
    EvaluationRun,
    ReportData,
    RunStatus,
    TokenUsage,
)

logger = logging.getLogger(__name__)


class CostAccuracyAnalytics:
    """Tracks and analyzes cost/accuracy across benchmark evaluations.

    Stores run results locally as JSON and provides queryable analytics:
    - Cost per benchmark / agent / model
    - Accuracy trends over time
    - Cost-efficiency ratios
    - Report generation (JSON, CSV)
    """

    def __init__(
        self,
        config: Optional[AnalyticsConfig] = None,
        output_dir: str = "./benchmark_output",
    ) -> None:
        self.config = config or AnalyticsConfig()
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._results_db: List[Dict[str, Any]] = []
        self._load_results_db()

    # ------------------------------------------------------------------
    # Run ingestion
    # ------------------------------------------------------------------

    def record_run(self, run: EvaluationRun) -> None:
        """Record an evaluation run for analytics."""
        if run.status != RunStatus.COMPLETED:
            return  # Only record completed runs

        record = self._run_to_record(run)
        self._results_db.append(record)

        # Enforce retention policy
        self._enforce_retention()

        # Persist
        self._save_results_db()
        logger.info("Recorded analytics for run %s (%s)", run.run_id, run.benchmark.value)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_cost_summary(
        self,
        benchmark: Optional[str] = None,
        agent: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get cost summary filtered by benchmark/agent."""
        filtered = self._results_db
        if benchmark:
            filtered = [r for r in filtered if r.get("benchmark") == benchmark]
        if agent:
            filtered = [r for r in filtered if r.get("agent_name") == agent]

        if not filtered:
            return {"total_cost_usd": 0, "total_tokens": 0, "runs": 0}

        total_cost = sum(r.get("total_cost_usd", 0) for r in filtered)
        total_tokens = sum(r.get("total_tokens", 0) for r in filtered)
        total_accuracy = sum(r.get("pass_rate", 0) for r in filtered) / max(1, len(filtered))

        return {
            "total_cost_usd": round(total_cost, 4),
            "total_tokens": total_tokens,
            "cost_per_run": round(total_cost / max(1, len(filtered)), 4),
            "cost_per_accuracy_point": round(total_cost / max(0.001, total_accuracy), 4),
            "total_runs": len(filtered),
            "avg_accuracy": round(total_accuracy, 4),
        }

    def get_accuracy_trend(
        self, benchmark: str, agent: Optional[str] = None, n_points: int = 10
    ) -> List[Dict[str, Any]]:
        """Get accuracy trend over time for plotting."""
        filtered = self._results_db
        if benchmark:
            filtered = [r for r in filtered if r.get("benchmark") == benchmark]
        if agent:
            filtered = [r for r in filtered if r.get("agent_name") == agent]

        if not filtered:
            return []

        # Sort by completion time
        filtered = sorted(filtered, key=lambda r: r.get("completed_at", ""))
        # Sample evenly
        step = max(1, len(filtered) // n_points)
        sampled = filtered[::step][:n_points]

        return [
            {
                "timestamp": r.get("completed_at", ""),
                "accuracy": r.get("pass_rate", 0),
                "cost_usd": r.get("total_cost_usd", 0),
                "runs_completed": r.get("total_instances", 0),
            }
            for r in sampled
        ]

    def get_report_data(
        self, run: EvaluationRun
    ) -> ReportData:
        """Generate report-ready data for a single run."""
        return ReportData(
            run_id=run.run_id,
            benchmark=run.benchmark,
            agent_name=run.agent_name,
            model=run.model,
            total_instances=run.total_instances,
            pass_rate=run.aggregate_score,
            avg_score=run.aggregate_score,
            total_cost_usd=run.cost.total_cost_usd,
            total_tokens=run.cost.total_tokens,
            duration_seconds=run.duration_seconds,
            results_summary=[
                {
                    "instance_id": r.instance_id,
                    "score": r.score,
                    "status": r.status.value,
                }
                for r in run.results
            ],
        )

    def export_json(self, path: Optional[str] = None) -> str:
        """Export all analytics data as JSON."""
        p = path or str(self.output_dir / "analytics_export.json")
        data = {
            "exported_at": datetime.utcnow().isoformat(),
            "total_runs": len(self._results_db),
            "config": self.config.model_dump(mode="json"),
            "results": self._results_db,
        }
        Path(p).write_text(json.dumps(data, indent=2, default=str))
        logger.info("Exported analytics to %s", p)
        return p

    def export_csv(self, path: Optional[str] = None) -> str:
        """Export run-level summaries as CSV."""
        p = path or str(self.output_dir / "analytics_export.csv")
        records = []
        for r in self._results_db:
            records.append({
                "run_id": r.get("run_id", ""),
                "benchmark": r.get("benchmark", ""),
                "agent_name": r.get("agent_name", ""),
                "model": r.get("model", ""),
                "completed_at": r.get("completed_at", ""),
                "total_instances": r.get("total_instances", 0),
                "pass_rate": r.get("pass_rate", 0),
                "total_cost_usd": r.get("total_cost_usd", 0),
                "total_tokens": r.get("total_tokens", 0),
            })
        if records:
            df = pd.DataFrame(records)
            df.to_csv(p, index=False)
        else:
            Path(p).touch()
        logger.info("Exported CSV to %s", p)
        return p

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _run_to_record(self, run: EvaluationRun) -> Dict[str, Any]:
        return {
            "run_id": run.run_id,
            "benchmark": run.benchmark.value,
            "agent_name": run.agent_name,
            "model": run.model,
            "status": run.status.value,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "total_instances": run.total_instances,
            "passed_instances": run.passed_instances,
            "failed_instances": run.failed_instances,
            "error_instances": run.error_instances,
            "timeout_instances": run.timeout_instances,
            "pass_rate": run.aggregate_score,
            "total_cost_usd": run.cost.total_cost_usd,
            "total_tokens": run.cost.input_tokens + run.cost.output_tokens,
            "input_tokens": run.cost.input_tokens,
            "output_tokens": run.cost.output_tokens,
            "duration_seconds": run.duration_seconds,
            "metadata": run.metadata,
        }

    def _load_results_db(self) -> None:
        """Load persisted results from disk."""
        db_path = self.output_dir / "results_db.json"
        if db_path.exists():
            try:
                self._results_db = json.loads(db_path.read_text())
                logger.info("Loaded %d results from %s", len(self._results_db), db_path)
            except (json.JSONDecodeError, IOError):
                self._results_db = []

    def _save_results_db(self) -> None:
        """Persist results to disk."""
        db_path = self.output_dir / "results_db.json"
        db_path.write_text(json.dumps(self._results_db, indent=2, default=str))

    def _enforce_retention(self) -> None:
        """Remove results older than retention_days."""
        cutoff = datetime.utcnow() - timedelta(days=self.config.retention_days)
        before = len(self._results_db)
        self._results_db = [
            r
            for r in self._results_db
            if not r.get("completed_at")
            or datetime.fromisoformat(r["completed_at"]) > cutoff
        ]
        removed = before - len(self._results_db)
        if removed > 0:
            logger.info("Removed %d results older than %d days", removed, self.config.retention_days)
