"""WebArena runner — web navigation benchmark.

WebArena evaluates agents on navigating and interacting with realistic
web applications to complete tasks.
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


class WebArenaRunner(TaskExecutor):
    """Runner for WebArena tasks."""

    benchmark_type = "webarena"

    def __init__(self, config: BenchmarkConfig) -> None:
        super().__init__(config)
        self._task_pool: list[dict[str, Any]] = []
        self._init_task_pool()

    def _init_task_pool(self) -> None:
        """Build a pool of simulated WebArena tasks."""
        apps = ["reddit", "wikipedia", "gitlab", "postgres_admin", "map"]
        task_templates = [
            "Find information about {topic} on the web.",
            "Navigate to {app} and complete a task.",
            "Search and extract data from {app}.",
            "Perform an action in {app} and verify the result.",
            "Multi-step task in {app}: {action}.",
        ]
        topics = ["machine learning", "open source", "climate data", "API docs", "tutorials"]
        actions = ["create a repository", "upload a file", "edit a page", "run a query"]
        for i in range(150):
            app = apps[i % len(apps)]
            tmpl = task_templates[i % len(task_templates)]
            task = {
                "task_id": f"webarena-task-{i}",
                "app": app,
                "instructions": tmpl.format(topic=topics[i % len(topics)], action=actions[i % len(actions)]),
                "max_steps": random.randint(3, 15),
                "reward_type": "binary",  # binary or continuous
            }
            self._task_pool.append(task)

    async def fetch_tasks(self, count: int) -> list[dict[str, Any]]:
        """Return up to `count` tasks from the pool."""
        return self._task_pool[: min(count, len(self._task_pool))]

    async def execute_task(self, task: dict[str, Any]) -> TaskResult:
        """Execute a single WebArena task (simulated)."""
        tokens = random.randint(300, 4000)
        cost = tokens * 0.000003
        duration = random.uniform(3.0, 45.0)
        await asyncio.sleep(duration * 0.01)

        # WebArena is very hard — lower pass rate
        max_steps = task.get("max_steps", 10)
        pass_rate = max(0.1, 0.5 - (max_steps - 3) * 0.04)
        status = "passed" if random.random() < pass_rate else random.choice(["failed", "timeout"])

        return TaskResult(
            task_id=task["task_id"],
            benchmark_type=self.config.benchmark_type,
            status=status,
            score=random.uniform(40, 100) if status == "passed" else random.uniform(0, 30),
            tokens_used=tokens,
            cost_usd=cost,
            duration_seconds=duration,
            metadata={
                "app": task["app"],
                "steps_used": random.randint(1, max_steps),
                "max_steps": max_steps,
            },
        )

    async def score_task(self, task: dict[str, Any], result: TaskResult) -> None:
        """Score based on task completion reward."""
        if result.status == "passed":
            result.metadata["reward"] = 1.0
        elif result.status == "timeout":
            result.metadata["reward"] = 0.0
            result.metadata["timeout"] = True
        logger.debug(f"WebArena task {result.task_id}: status={result.status}, score={result.score:.1f}")
