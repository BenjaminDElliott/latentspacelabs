"""Abstract base class for benchmark runners."""

from __future__ import annotations

import abc
import logging
from datetime import datetime, timezone
from typing import Any

from agent_bench.models import BenchmarkConfig, BenchmarkResult, TaskResult

logger = logging.getLogger(__name__)


class TaskExecutor(abc.ABC):
    """Abstract base class that every benchmark runner implements.

    Each runner knows how to:
    1. Fetch a subset of tasks for its benchmark
    2. Execute tasks against an agent (or simulate execution)
    3. Score individual task results
    4. Report progress
    """

    benchmark_type: str

    def __init__(self, config: BenchmarkConfig) -> None:
        self.config = config
        self._total_tasks = 0
        self._completed_tasks = 0

    # ── Required by every runner ──────────────────────────────────────

    @abc.abstractmethod
    async def fetch_tasks(self, count: int) -> list[dict[str, Any]]:
        """Return a list of task dicts (task_id, prompt, solution, etc.)."""

    @abc.abstractmethod
    async def execute_task(self, task: dict[str, Any]) -> TaskResult:
        """Execute a single task and return its result."""

    @abc.abstractmethod
    async def score_task(self, task: dict[str, Any], result: TaskResult) -> None:
        """Score a task result (can modify result in-place)."""

    # ── Optional helpers ──────────────────────────────────────────────

    @property
    def is_ready(self) -> bool:
        """Whether the runner has all required configuration."""
        return True

    async def get_task_count(self) -> int:
        """Return the total number of available tasks for this benchmark."""
        tasks = await self.fetch_tasks(1)
        return max(len(tasks), 1)

    # ── Convenience: run a full benchmark ─────────────────────────────

    async def run(self, task_limit: int | None = None) -> BenchmarkResult:
        """Execute all tasks up to task_limit and return a BenchmarkResult.

        This is a convenience method used by the orchestrator.
        Subclasses may override for custom logic.
        """
        tasks = await self.fetch_tasks(task_limit or self.config.subset_size)
        self._total_tasks = len(tasks)

        completed = 0
        passed = 0
        failed = 0
        timeouts = 0
        errors = 0
        scores: list[float] = []
        total_tokens = 0
        total_cost = 0.0
        total_duration = 0.0
        task_results: list[TaskResult] = []

        for task in tasks:
            try:
                result = await self.execute_task(task)
                await self.score_task(task, result)

                total_tokens += result.tokens_used
                total_cost += result.cost_usd
                total_duration += result.duration_seconds
                task_results.append(result)
                scores.append(result.score)

                completed += 1
                self._completed_tasks = completed

                if result.status == "passed":
                    passed += 1
                elif result.status == "timeout":
                    timeouts += 1
                elif result.status == "error":
                    errors += 1
                else:
                    failed += 1

            except Exception as exc:
                logger.error(f"Task {task.get('task_id', '?')} failed: {exc}")
                errors += 1
                self._completed_tasks = completed + errors

        avg_score = sum(scores) / len(scores) if scores else 0.0

        return BenchmarkResult(
            benchmark_type=self.config.benchmark_type,
            total_tasks=self._total_tasks,
            completed_tasks=completed,
            passed_tasks=passed,
            failed_tasks=failed,
            timeout_tasks=timeouts,
            error_tasks=errors,
            average_score=avg_score,
            task_results=task_results,
            total_tokens=total_tokens,
            total_cost_usd=total_cost,
            total_duration_seconds=total_duration,
        )
