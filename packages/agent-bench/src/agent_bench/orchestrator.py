"""Central orchestrator with worker pool for concurrent benchmark evaluation.

The orchestrator manages:
- Launching benchmark runners in parallel via concurrent.futures
- Progress tracking across benchmarks
- Cost monitoring with per-run caps
- Result aggregation and error handling
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from agent_bench.models import (
    BenchmarkConfig,
    BenchmarkResult,
    EvaluationRun,
    ProgressSnapshot,
)
from agent_bench.runners.base import TaskExecutor
from agent_bench.runners import SWEBenchRunner, AgentBenchRunner, WebArenaRunner

logger = logging.getLogger(__name__)


# Registry mapping benchmark type string to runner class
_RUNNER_REGISTRY: dict[str, type[TaskExecutor]] = {
    "swe_bench": SWEBenchRunner,
    "agent_bench": AgentBenchRunner,
    "webarena": WebArenaRunner,
}


def get_runner_class(benchmark_type: str) -> type[TaskExecutor]:
    """Get the runner class for a benchmark type."""
    if benchmark_type in _RUNNER_REGISTRY:
        return _RUNNER_REGISTRY[benchmark_type]
    raise ValueError(f"Unknown benchmark type: {benchmark_type}. "
                     f"Supported: {list(_RUNNER_REGISTRY.keys())}")


class Orchestrator:
    """Orchestrates benchmark evaluation runs with a worker pool.

    Example:
        orch = Orchestrator()
        run = await orch.evaluate(benchmark_configs)
        await orch.wait(run.run_id)
        scorecard = orch.score(run.run_id)
    """

    def __init__(self, max_workers: int = 5) -> None:
        self._run_store: dict[str, EvaluationRun] = {}
        self._max_workers = max_workers
        self._executor: ThreadPoolExecutor | None = None

    def _get_executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=self._max_workers)
        return self._executor

    # ── Public API ────────────────────────────────────────────────────

    async def evaluate(self, benchmark_configs: list[BenchmarkConfig],
                       tags: list[str] | None = None) -> EvaluationRun:
        """Trigger evaluation across benchmarks.

        Returns an EvaluationRun with status 'running'.
        """
        run_id = uuid.uuid4().hex
        run = EvaluationRun(
            run_id=run_id,
            benchmark_configs=benchmark_configs,
            status="running",
            tags=tags or [],
        )
        self._run_store[run_id] = run
        logger.info(f"Started evaluation run {run_id} with {len(benchmark_configs)} benchmarks")

        # Run benchmarks concurrently in the thread pool
        loop = asyncio.get_event_loop()

        def _run_benchmark(cfg: BenchmarkConfig) -> tuple[str, BenchmarkResult, Exception | None]:
            try:
                runner_class = get_runner_class(cfg.benchmark_type.value)
                runner = runner_class(cfg)
                result = asyncio.get_event_loop().run_until_complete(runner.run())
                return cfg.benchmark_type.value, result, None
            except Exception as exc:
                return cfg.benchmark_type.value, None, exc

        # Launch all benchmarks concurrently
        futures = []
        for cfg in benchmark_configs:
            future = self._get_executor().submit(_run_benchmark, cfg)
            futures.append((cfg.benchmark_type.value, future))

        # Collect results
        for bench_type, future in futures:
            try:
                bt, result, exc = future.result(timeout=3600)  # 1h timeout per benchmark
                if exc:
                    raise exc
                run.benchmark_results[bt] = result
                run.total_cost_usd += result.total_cost_usd
                run.total_tokens += result.total_tokens
                run.progress[bt] = 100.0
                logger.info(f"Benchmark {bt} completed: {result.average_score:.1f} avg score")
            except Exception as exc:
                logger.error(f"Benchmark {bench_type} failed: {exc}")
                run.progress[bench_type] = 0.0

        # Update run status
        if run.error_message is None:
            run.status = "completed"
        run.updated_at = datetime.now(timezone.utc)

        return run

    async def wait(self, run_id: str, timeout: float = 3600) -> EvaluationRun:
        """Wait for a run to complete (non-blocking with timeout)."""
        if run_id not in self._run_store:
            raise ValueError(f"Unknown run ID: {run_id}")

        run = self._run_store[run_id]
        if run.status != "running":
            return run

        deadline = datetime.now(timezone.utc).timestamp() + timeout
        while run.status == "running" and datetime.now(timezone.utc).timestamp() < deadline:
            await asyncio.sleep(0.1)
            # Re-check: in a real system, this would poll a server or check futures
            if not run.benchmark_results:
                run.status = "pending"
            else:
                all_done = all(p >= 100.0 for p in run.progress.values())
                if all_done:
                    run.status = "completed"
                    run.updated_at = datetime.now(timezone.utc)
            await asyncio.sleep(0.5)

        return self._run_store[run_id]

    def get_run(self, run_id: str) -> EvaluationRun:
        """Get an evaluation run by ID."""
        return self._run_store[run_id]

    def get_status(self, run_id: str) -> EvaluationRun:
        """Get lightweight status for a run."""
        return self._run_store[run_id]

    def list_runs(self) -> list[EvaluationRun]:
        """List all evaluation runs."""
        return list(self._run_store.values())

    def get_progress(self, run_id: str) -> ProgressSnapshot:
        """Get a progress snapshot for a run."""
        run = self._run_store.get(run_id)
        if not run:
            raise ValueError(f"Unknown run ID: {run_id}")
        return ProgressSnapshot(
            run_id=run_id,
            status=run.status,
            progress=dict(run.progress),
            active_benchmarks=[k for k, v in run.progress.items() if v > 0 and v < 100],
        )

    def get_benchmarks(self) -> list[str]:
        """Return list of supported benchmark types."""
        return list(_RUNNER_REGISTRY.keys())

    def shutdown(self) -> None:
        """Clean up resources."""
        if self._executor:
            self._executor.shutdown(wait=False)
            self._executor = None
