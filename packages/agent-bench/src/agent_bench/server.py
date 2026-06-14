"""FastAPI server for CI/CD integration.

Endpoints:
- POST /v1/evaluate       — Trigger evaluation
- GET  /v1/evaluate/{id}/status     — Get evaluation status
- GET  /v1/evaluate/{id}/scorecard  — Get scorecard
- GET  /v1/evaluate/{id}/report     — Download report (JSON/CSV)
- GET  /v1/benchmarks                — List supported benchmarks
- GET  /v1/history                   — Historical trends
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings

from agent_bench.cost_tracker import CostTracker
from agent_bench.models import (
    AgentConfig,
    BenchmarkConfig,
    BenchmarkResult,
    BenchmarkType,
    EvaluationRun,
    Scorecard,
)
from agent_bench.orchestrator import Orchestrator, get_runner_class
from agent_bench.reports import ReportGenerator
from agent_bench.runners import SWEBenchRunner, AgentBenchRunner, WebArenaRunner
from agent_bench.scoring import ScoringEngine

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Server settings from environment."""

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"
    max_workers: int = 5

    model_config = {"env_prefix": "AGENT_BENCH_"}


# ── Application state ────────────────────────────────────────────────────

class AppState:
    """Shared application state."""

    def __init__(self) -> None:
        self.orchestrator = Orchestrator()
        self.scoring = ScoringEngine()
        self.cost_tracker = CostTracker()


# ── App creation ──────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle hooks."""
    logger.info("Agent Bench Evaluation Platform starting")
    yield
    logger.info("Agent Bench Evaluation Platform shutting down")


app = FastAPI(
    title="Agent Benchmark Evaluation Platform",
    description="Runs agent tests across benchmarks with cost tracking and scoring.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

state = AppState()


# ── Helpers ───────────────────────────────────────────────────────────────

def _get_run(run_id: str) -> EvaluationRun:
    """Get run or raise 404."""
    try:
        return state.orchestrator.get_run(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")


# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/v1/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "benchmarks_supported": state.orchestrator.get_benchmarks()}


@app.get("/v1/benchmarks")
async def list_benchmarks():
    """List supported benchmark types."""
    return {
        "benchmarks": state.orchestrator.get_benchmarks(),
        "runners": {
            "swe_bench": "SWEBenchRunner",
            "agent_bench": "AgentBenchRunner",
            "webarena": "WebArenaRunner",
        },
    }


@app.post("/v1/evaluate", status_code=202)
async def trigger_evaluation(req: dict[str, Any]):
    """Trigger a benchmark evaluation.

    Request body:
        benchmark_configs: list of BenchmarkConfig objects
        tags: optional tags
    """
    configs_raw = req.get("benchmark_configs", [])
    tags = req.get("tags", [])

    configs = [BenchmarkConfig(**c) for c in configs_raw]
    if not configs:
        raise HTTPException(status_code=400, detail="At least one benchmark_config required")

    run = await state.orchestrator.evaluate(configs, tags=tags)

    # Record initial costs
    for cfg in configs:
        state.cost_tracker.record(
            run.run_id,
            cfg.benchmark_type.value,
            tokens=0,
            cost_usd=0.0,
            description="Initial cost record",
        )

    return {
        "run_id": run.run_id,
        "status": run.status,
        "message": f"Started {len(configs)} benchmarks",
        "benchmark_configs": [c.model_dump() for c in configs],
    }


@app.get("/v1/evaluate/{run_id}/status")
async def get_status(run_id: str):
    """Get evaluation run status."""
    run = _get_run(run_id)

    progress = {}
    for bt, result in run.benchmark_results.items():
        if result.total_tasks > 0:
            progress[bt] = round(result.completed_tasks / result.total_tasks * 100, 1)
        else:
            progress[bt] = 0.0

    return {
        "run_id": run.run_id,
        "status": run.status,
        "progress": progress,
        "total_cost_usd": run.total_cost_usd,
        "total_tokens": run.total_tokens,
        "created_at": run.created_at.isoformat(),
        "error_message": run.error_message,
    }


@app.get("/v1/evaluate/{run_id}/scorecard")
async def get_scorecard(run_id: str):
    """Get the scorecard for an evaluation run."""
    run = _get_run(run_id)
    if run.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Run not ready for scoring (status: {run.status})",
        )

    # Store history for trend analysis
    state.scoring.add_history(run)

    scorecard = await state.scoring.compute_scorecard(run)
    return scorecard.model_dump()


@app.get("/v1/evaluate/{run_id}/report")
async def get_report(run_id: str, format: str = "json"):
    """Download an evaluation report.

    format: 'json' or 'csv'
    """
    run = _get_run(run_id)
    if not run.benchmark_results:
        raise HTTPException(status_code=400, detail="No results to report")

    # Generate scorecard for full report
    state.scoring.add_history(run)
    scorecard = await state.scoring.compute_scorecard(run)

    fmt = format.lower()
    if fmt == "csv":
        content = ReportGenerator.benchmark_results_to_csv(run.benchmark_results)
        return content
    elif fmt == "json":
        content = ReportGenerator.benchmark_results_to_json(run.benchmark_results)
        return content
    else:
        raise HTTPException(status_code=400, detail="Format must be 'json' or 'csv'")


@app.get("/v1/history")
async def get_history():
    """Get historical evaluation data for trend analysis."""
    runs = state.orchestrator.list_runs()
    history = []
    for run in runs:
        if not run.benchmark_results:
            continue
        entry = {
            "run_id": run.run_id,
            "created_at": run.created_at.isoformat(),
            "status": run.status,
            "total_cost_usd": run.total_cost_usd,
            "total_tokens": run.total_tokens,
            "benchmarks": {},
        }
        for bt, result in run.benchmark_results.items():
            entry["benchmarks"][bt] = {
                "average_score": result.average_score,
                "total_tasks": result.total_tasks,
                "passed_tasks": result.passed_tasks,
                "cost_usd": result.total_cost_usd,
            }
        history.append(entry)
    return {"runs": history}


@app.post("/v1/demo/run")
async def demo_run():
    """Run a demo evaluation with sample benchmarks.

    Useful for quick testing without configuring benchmarks.
    """
    configs = [
        BenchmarkConfig(
            benchmark_type=BenchmarkType.SWE_BENCH,
            agent_config=AgentConfig(
                model="claude-opus-4-20250514",
                temperature=0.2,
                system_prompt="You are an AI software engineer.",
                max_tokens=4096,
            ),
            subset_size=20,
            max_concurrent=3,
        ),
        BenchmarkConfig(
            benchmark_type=BenchmarkType.AGENT_BENCH,
            agent_config=AgentConfig(
                model="gpt-4o",
                temperature=0.3,
                system_prompt="You are an AI assistant.",
                max_tokens=4096,
            ),
            subset_size=15,
            max_concurrent=2,
        ),
        BenchmarkConfig(
            benchmark_type=BenchmarkType.WEBARENA,
            agent_config=AgentConfig(
                model="claude-sonnet-4-20250514",
                temperature=0.1,
                system_prompt="You are a web navigation agent.",
                max_tokens=4096,
            ),
            subset_size=10,
            max_concurrent=1,
        ),
    ]
    run = await state.orchestrator.evaluate(configs, tags=["demo"])
    return {
        "run_id": run.run_id,
        "status": run.status,
        "message": "Demo run completed",
        "scores": {bt: r.average_score for bt, r in run.benchmark_results.items()},
    }


# ── CLI entry point ──────────────────────────────────────────────────────

def main() -> None:
    """CLI entry point — start the server."""
    settings = Settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    uvicorn.run(
        "agent_bench.server:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
