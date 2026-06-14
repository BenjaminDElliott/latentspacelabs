"""
GAIA runner.

GAIA evaluates agents on generalist AI tasks across three difficulty levels.
Tasks include answering questions, finding information, and multi-step reasoning.
See https://github.com/gaia-benchmark/GAIA
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


class GAIARunner(BaseBenchmarkRunner):
    """Runner for the GAIA benchmark suite.

    Each instance is a general question/task with a gold answer. The agent
    must reason and produce the correct answer. Difficulty levels: easy,
    medium, hard.
    """

    benchmark = BenchmarkName.GAIA

    # ------------------------------------------------------------------
    # Instance discovery
    # ------------------------------------------------------------------

    def discover_instances(self) -> List[str]:
        subset = self.benchmark_config.subset
        max_instances = self.benchmark_config.max_instances

        if subset == "default":
            instances = [
                f"gaia-{level}-{i:03d}"
                for level in ("easy", "medium", "hard")
                for i in range(1, min(20, max_instances // 3 + 1))
            ]
        elif subset == "easy":
            instances = [
                f"gaia-easy-{i:03d}" for i in range(1, min(20, max_instances) + 1)
            ]
        elif subset == "medium":
            instances = [
                f"gaia-medium-{i:03d}" for i in range(1, min(20, max_instances) + 1)
            ]
        elif subset == "hard":
            instances = [
                f"gaia-hard-{i:03d}" for i in range(1, min(20, max_instances) + 1)
            ]
        else:
            instances = [
                f"gaia-{i:04d}" for i in range(1, max_instances + 1)
            ]

        logger.info(
            "Discovered %d GAIA instances (subset=%s)",
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
        """Execute a single GAIA task."""
        from benchmark_platform.models.schemas import TokenUsage

        task_data = self._fetch_task_data(instance_id)
        question = task_data["question"]
        gold_answer = task_data["gold_answer"]

        # Agent generates answer
        prompt = f"Question: {question}\n\nAnswer the question concisely."
        agent_answer = self._call_agent(prompt)

        # Score against gold answer
        score = self._compare_answers(agent_answer, gold_answer)
        status = (
            AgentStatus.PASS if score >= 1.0
            else AgentStatus.FAIL
        )

        tokens = TokenUsage(
            prompt_tokens=len(prompt) * 2,
            completion_tokens=len(agent_answer) * 2,
        )

        return BenchmarkResult(
            instance_id=instance_id,
            benchmark=self.benchmark,
            status=status,
            score=score,
            details={
                "question": question,
                "gold_answer": gold_answer,
                "agent_answer": agent_answer[:500],  # truncate for storage
                "difficulty": task_data.get("difficulty", "unknown"),
            },
            tokens_used=tokens,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _fetch_task_data(self, instance_id: str) -> Dict[str, Any]:
        difficulty = instance_id.split("-")[1] if "-" in instance_id else "medium"
        return {
            "question": f"What is the answer to question {instance_id}?",
            "gold_answer": f"answer-for-{instance_id}",
            "difficulty": difficulty,
            "category": "reasoning",
        }

    def _call_agent(self, prompt: str) -> str:
        logger.info("Agent '%s' called with %d tokens", self.agent_config.name, len(prompt))
        # Placeholder answer
        return f"This is the answer based on analysis."

    def _compare_answers(self, agent_answer: str, gold_answer: str) -> float:
        """Compare agent answer to gold answer.

        In production this uses exact match, fuzzy match, or an LLM-as-judge.
        """
        a_lower = agent_answer.strip().lower()
        g_lower = gold_answer.strip().lower()
        if a_lower == g_lower:
            return 1.0
        # Fuzzy match: check if gold answer appears in agent answer
        if g_lower in a_lower or a_lower in g_lower:
            return 0.5
        return 0.0
