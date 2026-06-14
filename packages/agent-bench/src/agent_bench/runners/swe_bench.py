"""SWE-bench runner — software engineering task resolution benchmark.

SWE-bench evaluates agents on resolving real GitHub issues by generating
patch diffs against repositories.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Any

from agent_bench.models import BenchmarkConfig, TaskResult
from agent_bench.runners.base import TaskExecutor

logger = logging.getLogger(__name__)


class SWEBenchRunner(TaskExecutor):
    """Runner for SWE-bench tasks."""

    benchmark_type = "swe_bench"

    def __init__(self, config: BenchmarkConfig) -> None:
        super().__init__(config)
        # Simulated task pool (in production this would fetch from SWE-bench dataset)
        self._task_pool: list[dict[str, Any]] = []
        self._init_task_pool()

    def _init_task_pool(self) -> None:
        """Build a pool of simulated SWE-bench tasks."""
        repos = ["django/django", "scikit-learn/scikit-learn", "pandas-dev/pandas"]
        issue_types = [
            "Bug fix: handle edge case in parser",
            "Feature: add new API endpoint",
            "Refactor: simplify complex function",
            "Test: add coverage for missing paths",
            "Documentation: fix broken examples",
            "Performance: optimize query pipeline",
        ]
        for i in range(200):
            repo = repos[i % len(repos)]
            issue = issue_types[i % len(issue_types)]
            self._task_pool.append({
                "task_id": f"swe-bench-{repo.replace('/', '-')}-issue-{i}",
                "repo": repo,
                "issue_title": f"{issue} (#{i})",
                "difficulty": random.choice(["easy", "medium", "hard"]),
                "language": "python" if "django" in repo else "python",
                "instructions": f"Resolve the issue in {repo}. Generate a patch diff.",
                "solution": f"@@ -1,0 +1,5 @@\n+ # Fix applied\n",
            })

    async def fetch_tasks(self, count: int) -> list[dict[str, Any]]:
        """Return up to `count` tasks from the pool."""
        return self._task_pool[: min(count, len(self._task_pool))]

    async def execute_task(self, task: dict[str, Any]) -> TaskResult:
        """Execute a single SWE-bench task (simulated)."""
        start = datetime.now(timezone.utc)
        # Simulate API call to agent
        tokens = random.randint(500, 5000)
        cost = tokens * 0.000003  # ~$3 per M tokens (Claude Opus estimate)
        duration = random.uniform(2.0, 30.0)
        await asyncio.sleep(duration * 0.01)  # Simulate latency

        # Simulate pass/fail based on difficulty
        difficulty = task.get("difficulty", "medium")
        pass_rate = {"easy": 0.7, "medium": 0.45, "hard": 0.25}.get(difficulty, 0.4)
        status = "passed" if random.random() < pass_rate else "failed"

        return TaskResult(
            task_id=task["task_id"],
            benchmark_type=self.config.benchmark_type,
            status=status,
            score=random.uniform(60, 100) if status == "passed" else random.uniform(0, 40),
            tokens_used=tokens,
            cost_usd=cost,
            duration_seconds=duration,
            metadata={
                "repo": task["repo"],
                "issue_title": task.get("issue_title", ""),
                "patch_length": random.randint(1, 50),
            },
        )

    async def score_task(self, task: dict[str, Any], result: TaskResult) -> None:
        """Score a SWE-bench task result based on patch quality."""
        if result.status == "passed":
            result.score = min(100.0, result.score + random.uniform(0, 10))
        result.metadata["verified"] = result.status == "passed"
        logger.debug(f"SWE-bench task {result.task_id}: status={result.status}, score={result.score:.1f}")
