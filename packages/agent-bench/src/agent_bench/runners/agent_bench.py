"""AgentBench runner — AI agent capability evaluation benchmark.

AgentBench evaluates agents on general AI tasks including:
- Web browsing
- File system operations
- Code execution
- Tool usage
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


class AgentBenchRunner(TaskExecutor):
    """Runner for AgentBench tasks."""

    benchmark_type = "agent_bench"

    def __init__(self, config: BenchmarkConfig) -> None:
        super().__init__(config)
        self._task_pool: list[dict[str, Any]] = []
        self._init_task_pool()

    def _init_task_pool(self) -> None:
        """Build a pool of simulated AgentBench tasks."""
        categories = [
            "web_browsing",
            "filesystem",
            "code_execution",
            "tool_use",
            "multi_turn_conversation",
        ]
        tasks = [
            {
                "task_id": f"agent-bench-{cat}-task-{i}",
                "category": cat,
                "instructions": f"Perform a {cat.replace('_', ' ')} task.",
                "expected_output": f"Expected {cat} result",
            }
            for cat in categories
            for i in range(40)
        ]
        self._task_pool = tasks

    async def fetch_tasks(self, count: int) -> list[dict[str, Any]]:
        """Return up to `count` tasks from the pool."""
        return self._task_pool[: min(count, len(self._task_pool))]

    async def execute_task(self, task: dict[str, Any]) -> TaskResult:
        """Execute a single AgentBench task (simulated)."""
        start = datetime.now(timezone.utc)
        tokens = random.randint(200, 3000)
        cost = tokens * 0.000002  # GPT-4 estimate
        duration = random.uniform(1.0, 20.0)
        await asyncio.sleep(duration * 0.01)

        # Simulate pass/fail — AgentBench is harder
        pass_rate = 0.4
        status = "passed" if random.random() < pass_rate else "failed"

        return TaskResult(
            task_id=task["task_id"],
            benchmark_type=self.config.benchmark_type,
            status=status,
            score=random.uniform(50, 100) if status == "passed" else random.uniform(0, 35),
            tokens_used=tokens,
            cost_usd=cost,
            duration_seconds=duration,
            metadata={
                "category": task["category"],
            },
        )

    async def score_task(self, task: dict[str, Any], result: TaskResult) -> None:
        """Score based on output correctness and completeness."""
        if result.status == "passed":
            result.metadata["verified"] = True
            result.metadata["category_score"] = "high" if result.score > 80 else "medium"
        logger.debug(f"AgentBench task {result.task_id}: status={result.status}, score={result.score:.1f}")
