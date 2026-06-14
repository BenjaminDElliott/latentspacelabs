"""
WebArena runner.

WebArena evaluates agents on realistic web environments. Agents must navigate
websites (e.g., e-commerce, maps, wikis) and complete tasks using a browser
interface. See https://github.com/web-arena-x/webarena
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from benchmark_platform.config import AgentConfig, BenchmarkConfig
from benchmark_platform.models.schemas import (
    AgentStatus,
    BenchmarkName,
    BenchmarkResult,
    TokenUsage,
)
from benchmark_platform.runner.base import BaseBenchmarkRunner

logger = logging.getLogger(__name__)


class WebArenaRunner(BaseBenchmarkRunner):
    """Runner for the WebArena benchmark suite.

    Each instance is a web task (e.g., "Find the cheapest flight from SFO to JFK")
    that requires the agent to interact with real websites via a browser.
    """

    benchmark = BenchmarkName.WEBARENA

    # ------------------------------------------------------------------
    # Instance discovery
    # ------------------------------------------------------------------

    def discover_instances(self) -> List[str]:
        subset = self.benchmark_config.subset
        max_instances = self.benchmark_config.max_instances

        # WebArena categories: reddit, gitlab, map, shopping, wiki, etc.
        categories = [
            "reddit", "gitlab", "map", "shopping", "wiki",
            "stack-overflow", "huggingface", "chrome",
        ]
        if subset == "default":
            instances = []
            for cat in categories:
                for i in range(1, min(10, max_instances // len(categories) + 1)):
                    instances.append(f"webarena-{cat}-{i:03d}")
        elif subset == "reddit":
            instances = [
                f"webarena-reddit-{i:03d}" for i in range(1, min(10, max_instances) + 1)
            ]
        elif subset == "shopping":
            instances = [
                f"webarena-shopping-{i:03d}" for i in range(1, min(10, max_instances) + 1)
            ]
        else:
            instances = [
                f"webarena-{i:04d}" for i in range(1, max_instances + 1)
            ]

        logger.info(
            "Discovered %d WebArena instances (subset=%s)",
            len(instances),
            subset,
        )
        return instances

    # ------------------------------------------------------------------
    # Instance execution
    # ------------------------------------------------------------------

    def _execute_instance(
        self, instance_id: str, **kwargs: Any
    ) -> BenchmarkResult:
        """Execute a single WebArena task."""
        from benchmark_platform.models.schemas import TokenUsage

        task_data = self._fetch_task_data(instance_id)

        # Simulate browser interaction loop
        browser_state = self._run_browser_session(instance_id, task_data)
        score = self._score_web_task(task_data, browser_state)
        status = (
            AgentStatus.PASS if score >= 1.0
            else AgentStatus.FAIL
        )

        tokens = TokenUsage(
            prompt_tokens=len(task_data["instruction"]) * 2,
            completion_tokens=browser_state.get("total_steps", 0) * 500,
        )

        return BenchmarkResult(
            instance_id=instance_id,
            benchmark=self.benchmark,
            status=status,
            score=score,
            details={
                "instruction": task_data["instruction"],
                "steps": browser_state.get("total_steps", 0),
                "url_visited": browser_state.get("final_url", "unknown"),
            },
            tokens_used=tokens,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _fetch_task_data(self, instance_id: str) -> Dict[str, Any]:
        return {
            "instruction": f"Complete the WebArena task: {instance_id}",
            "start_url": "https://webarena.dev",
            "expected_reward": 1.0,
        }

    def _run_browser_session(
        self, instance_id: str, task_data: Dict
    ) -> Dict[str, Any]:
        """Simulate a browser session (click, type, navigate)."""
        steps = []
        for step_num in range(1, 6):
            steps.append({
                "action": "click" if step_num % 2 == 0 else "type",
                "element": f"element-{step_num}",
                "value": f"value-{step_num}" if step_num % 2 == 0 else "",
            })
        return {
            "total_steps": len(steps),
            "final_url": "https://webarena.dev/task-complete",
            "steps": steps,
        }

    def _score_web_task(
        self, task_data: Dict, browser_state: Dict
    ) -> float:
        reward = browser_state.get("total_steps", 0)
        max_steps = 20
        # Normalize: complete tasks get full score, partial gets proportional
        if reward >= max_steps:
            return task_data.get("expected_reward", 1.0)
        return reward / max_steps
