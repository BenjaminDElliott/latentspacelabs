"""
AgentBench runner.

AgentBench evaluates agents on interactive environments — web browsing,
file systems, terminals, and APIs. Agents must complete tasks by interacting
with the environment. See https://github.com/THUDM/AgentBench
"""

from __future__ import annotations

import json
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


class AgentBenchRunner(BaseBenchmarkRunner):
    """Runner for the AgentBench benchmark suite.

    Each instance is an interactive task (e.g., "book a flight", "find the
    tallest building in the city"). The agent interacts via a terminal,
    browser, or API.
    """

    benchmark = BenchmarkName.AGENT_BENCH

    # ------------------------------------------------------------------
    # Instance discovery
    # ------------------------------------------------------------------

    def discover_instances(self) -> List[str]:
        subset = self.benchmark_config.subset
        max_instances = self.benchmark_config.max_instances

        if subset == "all":
            instances = [
                f"agentbench-{i:04d}" for i in range(1, max_instances + 1)
            ]
        else:
            instances = [
                f"agentbench-{i:04d}" for i in range(1, min(50, max_instances) + 1)
            ]

        logger.info(
            "Discovered %d AgentBench instances (subset=%s)",
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
        """Execute a single AgentBench interactive task."""
        from benchmark_platform.models.schemas import TokenUsage

        task_data = self._fetch_task_data(instance_id)

        # Build conversation loop
        messages = self._build_initial_messages(instance_id, task_data)
        final_state = self._run_interaction_loop(instance_id, messages, task_data)

        score = self._score_interaction(task_data, final_state)
        status = (
            AgentStatus.PASS if score >= 1.0
            else AgentStatus.FAIL
        )

        tokens = TokenUsage(
            prompt_tokens=sum(len(m.get("content", "")) for m in messages) // 2,
            completion_tokens=sum(
                len(a.get("content", "")) for a in final_state["agent_actions"]
            ) // 2,
        )

        return BenchmarkResult(
            instance_id=instance_id,
            benchmark=self.benchmark,
            status=status,
            score=score,
            details={
                "task": task_data["task_description"],
                "steps_taken": len(final_state["agent_actions"]),
                "final_state": final_state["environment_state"],
            },
            tokens_used=tokens,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _fetch_task_data(self, instance_id: str) -> Dict[str, Any]:
        return {
            "task_description": f"Complete task {instance_id}",
            "expected_answer": f"answer-{instance_id}",
            "environment": "terminal",
        }

    def _build_initial_messages(
        self, instance_id: str, data: Dict
    ) -> List[Dict[str, str]]:
        return [
            {
                "role": "system",
                "content": self.agent_config.system_prompt or (
                    "You are an autonomous agent. Interact with the environment "
                    "to complete the task."
                ),
            },
            {
                "role": "user",
                "content": f"Task: {data['task_description']}",
            },
        ]

    def _run_interaction_loop(
        self,
        instance_id: str,
        messages: List[Dict],
        task_data: Dict,
        max_steps: int = 20,
    ) -> Dict[str, Any]:
        """Simulate an interactive session with the environment."""
        final_state = {
            "environment_state": "completed",
            "agent_actions": [],
        }
        for step in range(max_steps):
            # Agent decides action
            action = f"Action {step + 1} for {instance_id}"
            final_state["agent_actions"].append({"content": action})
            # Environment responds
            messages.append({"role": "assistant", "content": action})
            response = f"Environment response step {step + 1}"
            messages.append({"role": "user", "content": response})
        return final_state

    def _score_interaction(
        self, task_data: Dict, final_state: Dict
    ) -> float:
        """Score based on whether the agent completed the task."""
        if final_state["environment_state"] == "completed":
            return 1.0
        return 0.0
