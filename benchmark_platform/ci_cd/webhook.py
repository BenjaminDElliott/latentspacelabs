"""
Webhook handler for API-based evaluation triggering.

Provides a FastAPI app that accepts webhook events to trigger benchmark runs,
check run status, and retrieve results.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query

from benchmark_platform.config import PlatformConfig, default_config
from benchmark_platform.models.schemas import (
    BenchmarkName,
    EvaluationRun,
    ReportData,
    RunStatus,
)

logger = logging.getLogger(__name__)


def create_app(config: Optional[PlatformConfig] = None) -> FastAPI:
    """Create a FastAPI application for the benchmark evaluation API.

    Endpoints:
        POST /api/v1/runs        — Trigger a new benchmark evaluation
        GET  /api/v1/runs/{id}   — Get run status/details
        GET  /api/v1/runs        — List all runs
        GET  /api/v1/results     — Get aggregated results
        POST /api/v1/regressions — Get regression alerts
    """
    cfg = config or default_config()
    app = FastAPI(
        title="Benchmark Evaluation Platform",
        description="Automated benchmark evaluation API for agent capabilities testing",
        version="0.1.0",
    )

    # In-memory store for runs (replace with DB in production)
    _runs: Dict[str, EvaluationRun] = {}

    @app.post("/api/v1/runs", status_code=202)
    async def trigger_run(
        benchmark: str = Query(..., description="Benchmark name"),
        agent: str = Query("default", description="Agent configuration name"),
        model: str = Query("gpt-4", description="Model to evaluate"),
        subset: str = Query("verified", description="Benchmark subset"),
    ) -> Dict[str, Any]:
        """Trigger a new benchmark evaluation run."""
        try:
            benchmark_enum = BenchmarkName(benchmark)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid benchmark: {benchmark}. "
                       f"Available: {[b.value for b in BenchmarkName]}",
            )

        run_id = f"run-{benchmark}-{agent}-{model}"
        run = EvaluationRun(
            run_id=run_id,
            benchmark=benchmark_enum,
            agent_name=agent,
            model=model,
            status=RunStatus.PENDING,
        )
        _runs[run_id] = run

        logger.info("Benchmark run triggered: %s", run_id)
        return {
            "run_id": run_id,
            "status": "accepted",
            "message": "Benchmark run queued",
        }

    @app.get("/api/v1/runs/{run_id}")
    async def get_run(run_id: str) -> Dict[str, Any]:
        """Get run details and status."""
        run = _runs.get(run_id)
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        return {
            "run_id": run.run_id,
            "benchmark": run.benchmark.value,
            "agent_name": run.agent_name,
            "model": run.model,
            "status": run.status.value,
            "aggregate_score": run.aggregate_score,
            "completion_pct": run.completion_pct,
            "cost": run.cost.model_dump(mode="json"),
            "total_instances": run.total_instances,
            "passed_instances": run.passed_instances,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        }

    @app.get("/api/v1/runs")
    async def list_runs(limit: int = 20) -> Dict[str, Any]:
        """List all runs."""
        runs = list(_runs.values())[-limit:]
        return {
            "total": len(runs),
            "runs": [
                {
                    "run_id": r.run_id,
                    "benchmark": r.benchmark.value,
                    "agent_name": r.agent_name,
                    "status": r.status.value,
                    "aggregate_score": r.aggregate_score,
                }
                for r in runs
            ],
        }

    @app.get("/api/v1/results")
    async def get_results(benchmark: Optional[str] = None) -> Dict[str, Any]:
        """Get aggregated results."""
        filtered = _runs.values()
        if benchmark:
            filtered = [r for r in filtered if r.benchmark.value == benchmark]

        if not filtered:
            return {"total": 0, "results": [], "summary": {}}

        scores = [r.aggregate_score for r in filtered if r.status.value == "completed"]
        costs = [r.cost.total_cost_usd for r in filtered]

        return {
            "total": len(filtered),
            "summary": {
                "avg_score": sum(scores) / max(1, len(scores)),
                "total_cost_usd": sum(costs),
                "completed_runs": sum(1 for r in filtered if r.status.value == "completed"),
            },
            "runs": [
                {
                    "run_id": r.run_id,
                    "benchmark": r.benchmark.value,
                    "agent_name": r.agent_name,
                    "score": r.aggregate_score,
                    "cost_usd": r.cost.total_cost_usd,
                }
                for r in filtered
            ],
        }

    @app.post("/api/v1/regressions")
    async def check_regressions() -> Dict[str, Any]:
        """Check for recent regressions."""
        completed_runs = [r for r in _runs.values() if r.status.value == "completed"]
        if len(completed_runs) < 2:
            return {"regressions": [], "message": "Not enough data"}

        # Simple regression check
        recent = completed_runs[-5:]
        scores = [r.aggregate_score for r in recent]
        baseline = sum(scores[:-1]) / max(1, len(scores) - 1)
        current = scores[-1] if scores else 0

        delta = baseline - current
        if delta > 0.05 * baseline:
            return {
                "regressions": [
                    {
                        "benchmark": recent[-1].benchmark.value,
                        "current_score": current,
                        "baseline_avg": baseline,
                        "drop_pct": (delta / max(0.001, baseline)) * 100,
                    }
                ],
            }
        return {"regressions": [], "message": "No regressions detected"}

    return app
