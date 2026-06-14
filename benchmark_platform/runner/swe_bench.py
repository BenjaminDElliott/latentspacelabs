"""
SWE-bench runner.

SWE-bench evaluates agents on real-world GitHub issues by measuring whether
their code edits resolve the issue's tests. See https://github.com/swe-bench
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


class SWEBenchRunner(BaseBenchmarkRunner):
    """Runner for the SWE-bench benchmark suite.

    Each instance is a (repo, issue_id, test_patch) tuple. The agent receives
    the issue description and must produce code edits that pass the test suite.
    """

    benchmark = BenchmarkName.SWE_BENCH

    # ------------------------------------------------------------------
    # Instance discovery
    # ------------------------------------------------------------------

    def discover_instances(self) -> List[str]:
        """Discover SWE-bench instances to evaluate.

        In a production setup this would query the SWE-bench dataset API or
        load from a local JSONL file. For scaffolding, we return placeholder
        instance IDs.
        """
        subset = self.benchmark_config.subset
        max_instances = self.benchmark_config.max_instances

        if subset == "verified":
            # SWE-bench verified subset (recommended for MVP)
            instances = [
                f"swe-rex--{i:04d}" for i in range(1, max_instances + 1)
            ]
        elif subset == "lite":
            instances = [f"swe-lite-{i:03d}" for i in range(1, min(25, max_instances) + 1)]
        elif subset == "full":
            instances = [f"swe-full-{i:04d}" for i in range(1, max_instances + 1)]
        else:
            instances = [f"swe-unknown-{i:04d}" for i in range(1, max_instances + 1)]

        logger.info("Discovered %d SWE-bench instances (subset=%s)", len(instances), subset)
        return instances

    # ------------------------------------------------------------------
    # Instance execution
    # ------------------------------------------------------------------

    def _execute_instance(
        self, instance_id: str, **kwargs: Any
    ) -> BenchmarkResult:
        """Execute a single SWE-bench instance.

        Flow:
          1. Fetch issue description and test patch for instance_id.
          2. Prompt the agent with the issue description + test suite.
          3. Agent produces a patch (diff).
          4. Apply patch, run tests.
          5. Score based on test pass rate.
        """
        from benchmark_platform.models.schemas import TokenUsage

        # Step 1: Fetch instance data (placeholder)
        instance_data = self._fetch_instance_data(instance_id)

        # Step 2: Build prompt
        prompt = self._build_swe_prompt(instance_id, instance_data)

        # Step 3: Agent generates patch
        patch_output = self._call_agent(prompt)

        # Step 4: Apply and evaluate (placeholder scoring)
        test_results = self._apply_patch_and_test(instance_id, patch_output)
        score = self._compute_score(instance_data, test_results)

        # Step 5: Determine pass/fail
        status = (
            AgentStatus.PASS
            if score >= 1.0
            else AgentStatus.FAIL
        )

        tokens = TokenUsage(
            prompt_tokens=len(prompt.split()) * 2,  # rough estimate
            completion_tokens=len(patch_output.split()) * 2,
        )

        return BenchmarkResult(
            instance_id=instance_id,
            benchmark=self.benchmark,
            status=status,
            score=score,
            details={
                "test_results": test_results,
                "patch_length": len(patch_output),
                "agent_prompt_length": len(prompt),
            },
            tokens_used=tokens,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _fetch_instance_data(self, instance_id: str) -> Dict[str, Any]:
        """Fetch the issue description, repo, and test patch."""
        # Placeholder — in production this calls the SWE-bench dataset API
        return {
            "repo": "github.com/swe-bench/test-repo",
            "issue_description": f"Fix issue {instance_id} in test-repo",
            "test_patch": f"def test_{instance_id}(): assert True",
        }

    def _build_swe_prompt(self, instance_id: str, data: Dict) -> str:
        return (
            f"## Issue: {instance_id}\n\n"
            f"{data['issue_description']}\n\n"
            f"## Repository\n"
            f"Repository: {data['repo']}\n\n"
            f"## Test Suite\n"
            f"```\n{data['test_patch']}\n```\n\n"
            f"Produce a unified diff patch that fixes the issue."
        )

    def _call_agent(self, prompt: str) -> str:
        """Call the configured LLM agent with the prompt."""
        # Placeholder — in production this calls the LLM provider
        logger.info("Agent '%s' called with %d tokens", self.agent_config.name, len(prompt))
        return f"# Fix for {instance_id}\n---\n"  # type: ignore[unreachable]

    def _apply_patch_and_test(
        self, instance_id: str, patch: str
    ) -> Dict[str, Any]:
        """Apply the patch to the repo and run tests."""
        # Placeholder evaluation
        return {
            "tests_passed": 1,
            "tests_total": 1,
            "tests_failed": 0,
            "exit_code": 0,
        }

    def _compute_score(
        self, instance_data: Dict, test_results: Dict
    ) -> float:
        total = test_results.get("tests_total", 0)
        passed = test_results.get("tests_passed", 0)
        return passed / max(1, total)
